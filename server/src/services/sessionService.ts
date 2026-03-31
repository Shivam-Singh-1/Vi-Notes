import { Types } from "mongoose";
import type {
  CloseSessionResponse,
  CreateSessionInput,
  SessionUpsertInput,
  SessionListItem,
  SessionDerivedStats,
} from "../shared/session.js";
import type { Keystroke } from "../shared/keystroke.js";
import Session from "../models/Session.js";
import Document from "../models/Document.js";
import { NotFoundError, UnauthorizedError, ValidationError } from "./errors.js";
import { computeSessionAnalytics } from "./analysisService.js";
import { updateBaseline } from "./baselineService.js";

const ROLLING_WINDOW_SIZE = 5;

// Helper function to compute derived stats from keystroke array
const computeDerivedStats = (keystrokes: Keystroke[]): SessionDerivedStats => {
  let charCount = 0;
  let editCount = 0;
  let pasteCount = 0;

  for (const keystroke of keystrokes) {
    if (keystroke.action === "edit") {
      editCount++;
      charCount +=
        (keystroke.insertedLength ?? 0) - (keystroke.removedLength ?? 0);
    } else if (keystroke.action === "paste") {
      pasteCount++;
      charCount += keystroke.pasteLength ?? 0;
    }
  }

  // Word count estimation: assume average 5 chars per word
  const wordCount = Math.max(0, Math.round(charCount / 5));

  return {
    wordCount,
    charCount: Math.max(0, charCount),
    edits: editCount,
    keystrokes: keystrokes.length,
    pastes: pasteCount,
  };
};

type SessionWithLifecycle = {
  _id: Types.ObjectId;
  documentId?: Types.ObjectId;
  status?: "active" | "closed";
  closedAt?: Date;
  analytics?: import("../shared/session.js").SessionAnalytics;
  keystrokes: import("../shared/keystroke.js").Keystroke[];
  save: () => Promise<unknown>;
};

type DocumentForSession = {
  _id: Types.ObjectId;
  lastOpenedSessionId?: Types.ObjectId;
  save: () => Promise<unknown>;
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const clampNonNegative = (value: number) => (value < 0 ? 0 : value);

const average = (values: number[]) => {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const toChronological = (keystrokes: Keystroke[]) =>
  [...keystrokes].sort((a, b) => {
    const aTimestamp = isFiniteNumber(a.timestamp) ? a.timestamp : 0;
    const bTimestamp = isFiniteNumber(b.timestamp) ? b.timestamp : 0;
    return aTimestamp - bTimestamp;
  });

const getRawTimestamp = (event: Keystroke): number => {
  if (isFiniteNumber(event.rawTimestamp)) {
    return event.rawTimestamp;
  }

  return isFiniteNumber(event.timestamp) ? event.timestamp : 0;
};

const getRawDuration = (event: Keystroke): number | undefined => {
  if (isFiniteNumber(event.rawDuration)) {
    return event.rawDuration;
  }

  if (isFiniteNumber(event.duration)) {
    return event.duration;
  }

  return undefined;
};

const getSmoothedTimestamp = (event: Keystroke): number => {
  if (isFiniteNumber(event.timestamp)) {
    return event.timestamp;
  }

  return getRawTimestamp(event);
};

const getSeedRawDeltas = (history: Keystroke[]): number[] => {
  const tail = history.slice(-ROLLING_WINDOW_SIZE);
  const deltas: number[] = [];

  for (let index = 1; index < tail.length; index += 1) {
    const current = tail[index];
    const previous = tail[index - 1];

    if (!current || !previous) {
      continue;
    }

    const delta = clampNonNegative(
      getRawTimestamp(current) - getRawTimestamp(previous),
    );
    deltas.push(delta);
  }

  return deltas.slice(-(ROLLING_WINDOW_SIZE - 1));
};

const getSeedRawDurations = (history: Keystroke[]): number[] => {
  const rawDurations = history
    .slice(-ROLLING_WINDOW_SIZE)
    .map(getRawDuration)
    .filter((value): value is number => isFiniteNumber(value));

  return rawDurations.slice(-(ROLLING_WINDOW_SIZE - 1));
};

const normalizeKeystrokeTiming = (
  input: Keystroke[],
  previousPersisted: Keystroke[] = [],
): Keystroke[] => {
  if (input.length === 0) {
    return [];
  }

  const orderedInput = toChronological(input);
  const rawDeltaWindow = getSeedRawDeltas(previousPersisted);
  const rawDurationWindow = getSeedRawDurations(previousPersisted);

  const previousPersistedLast =
    previousPersisted.length > 0
      ? previousPersisted[previousPersisted.length - 1]
      : undefined;

  let previousRawTimestamp = previousPersistedLast
    ? getRawTimestamp(previousPersistedLast)
    : undefined;
  let previousSmoothedTimestamp = previousPersistedLast
    ? getSmoothedTimestamp(previousPersistedLast)
    : undefined;

  const normalized: Keystroke[] = [];

  for (const event of orderedInput) {
    const rawTimestamp = getRawTimestamp(event);

    if (
      !isFiniteNumber(previousRawTimestamp) ||
      !isFiniteNumber(previousSmoothedTimestamp)
    ) {
      previousRawTimestamp = rawTimestamp;
      previousSmoothedTimestamp = rawTimestamp;

      const rawDuration = getRawDuration(event);
      const smoothedDuration = isFiniteNumber(rawDuration)
        ? clampNonNegative(rawDuration)
        : undefined;

      if (isFiniteNumber(rawDuration)) {
        rawDurationWindow.push(rawDuration);
        if (rawDurationWindow.length > ROLLING_WINDOW_SIZE) {
          rawDurationWindow.shift();
        }
      }

      normalized.push({
        ...event,
        rawTimestamp,
        timestamp: rawTimestamp,
        ...(isFiniteNumber(rawDuration) && { rawDuration }),
        ...(isFiniteNumber(smoothedDuration) && { duration: smoothedDuration }),
      });
      continue;
    }

    const rawDelta = clampNonNegative(rawTimestamp - previousRawTimestamp);
    rawDeltaWindow.push(rawDelta);
    if (rawDeltaWindow.length > ROLLING_WINDOW_SIZE) {
      rawDeltaWindow.shift();
    }

    const smoothedDelta = clampNonNegative(average(rawDeltaWindow));
    const candidateTimestamp = previousSmoothedTimestamp + smoothedDelta;
    const smoothedTimestamp = Math.max(
      previousSmoothedTimestamp,
      candidateTimestamp,
    );

    const rawDuration = getRawDuration(event);
    let smoothedDuration: number | undefined;

    if (isFiniteNumber(rawDuration)) {
      rawDurationWindow.push(rawDuration);
      if (rawDurationWindow.length > ROLLING_WINDOW_SIZE) {
        rawDurationWindow.shift();
      }

      smoothedDuration = clampNonNegative(average(rawDurationWindow));
    }

    normalized.push({
      ...event,
      rawTimestamp,
      timestamp: smoothedTimestamp,
      ...(isFiniteNumber(rawDuration) && { rawDuration }),
      ...(isFiniteNumber(smoothedDuration) && { duration: smoothedDuration }),
    });

    previousRawTimestamp = rawTimestamp;
    previousSmoothedTimestamp = smoothedTimestamp;
  }

  return normalized;
};

const assertValidRange = (
  start: unknown,
  end: unknown,
  label: string,
  index: number,
) => {
  if (!isFiniteNumber(start) || !isFiniteNumber(end)) {
    throw new ValidationError(
      `keystrokes[${index}] ${label} must have numeric start/end`,
    );
  }

  if (start < 0 || end < 0 || start > end) {
    throw new ValidationError(`keystrokes[${index}] ${label} range is invalid`);
  }
};

// Generate unique session code
const generateSessionCode = (): string => {
  return `sess_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
};

const validateKeystrokes = (keystrokes: unknown[]) => {
  for (let index = 0; index < keystrokes.length; index += 1) {
    const item = keystrokes[index];

    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new ValidationError(`keystrokes[${index}] must be an object`);
    }

    const keystroke = item as Record<string, unknown>;
    const action = keystroke.action;

    if (
      action !== "down" &&
      action !== "up" &&
      action !== "paste" &&
      action !== "edit"
    ) {
      throw new ValidationError(`keystrokes[${index}] action is invalid`);
    }

    if (!isFiniteNumber(keystroke.timestamp)) {
      throw new ValidationError(
        `keystrokes[${index}] timestamp must be a number`,
      );
    }

    if (action === "paste") {
      if (!isFiniteNumber(keystroke.pasteLength) || keystroke.pasteLength < 0) {
        throw new ValidationError(
          `keystrokes[${index}] pasteLength must be a non-negative number`,
        );
      }

      const hasSelectionStart =
        typeof keystroke.pasteSelectionStart !== "undefined";
      const hasSelectionEnd =
        typeof keystroke.pasteSelectionEnd !== "undefined";

      if (hasSelectionStart || hasSelectionEnd) {
        assertValidRange(
          keystroke.pasteSelectionStart,
          keystroke.pasteSelectionEnd,
          "paste selection",
          index,
        );
      }

      if (
        typeof keystroke.editedLater !== "undefined" &&
        typeof keystroke.editedLater !== "boolean"
      ) {
        throw new ValidationError(
          `keystrokes[${index}] editedLater must be a boolean`,
        );
      }
    }

    if (action === "edit") {
      assertValidRange(keystroke.editStart, keystroke.editEnd, "edit", index);

      if (
        !isFiniteNumber(keystroke.insertedLength) ||
        !isFiniteNumber(keystroke.removedLength)
      ) {
        throw new ValidationError(
          `keystrokes[${index}] edit lengths must be numbers`,
        );
      }

      if (keystroke.insertedLength < 0 || keystroke.removedLength < 0) {
        throw new ValidationError(
          `keystrokes[${index}] edit lengths must be non-negative`,
        );
      }
    }
  }
};

const assertUserId = (userId?: string): string => {
  if (!userId) {
    throw new UnauthorizedError("Unauthorized");
  }

  return userId;
};

const assertValidObjectId = (value: string, label: string) => {
  if (!Types.ObjectId.isValid(value)) {
    throw new ValidationError(`Invalid ${label}`);
  }
};

const getOwnedDocument = async (
  ownerId: string,
  documentId: string,
): Promise<DocumentForSession> => {
  assertValidObjectId(documentId, "document id");

  const document = (await Document.findOne({
    _id: new Types.ObjectId(documentId),
    user: new Types.ObjectId(ownerId),
  })) as DocumentForSession | null;

  if (!document) {
    throw new NotFoundError("File not found");
  }

  return document;
};

const setLastOpenedSession = async (
  document: DocumentForSession,
  sessionId: Types.ObjectId,
) => {
  document.lastOpenedSessionId = sessionId;
  await document.save();
};

export const startOrResumeSession = async (
  userId: string | undefined,
  input: Partial<CreateSessionInput>,
) => {
  const ownerId = assertUserId(userId);

  if (typeof input.documentId !== "string" || input.documentId.trim() === "") {
    throw new ValidationError("documentId is required");
  }

  const document = await getOwnedDocument(ownerId, input.documentId);
  const initialKeystrokes = Array.isArray(input.keystrokes)
    ? input.keystrokes
    : [];

  validateKeystrokes(initialKeystrokes);

  if (document.lastOpenedSessionId) {
    const existingSession = (await Session.findOne({
      _id: document.lastOpenedSessionId,
      user: new Types.ObjectId(ownerId),
      documentId: new Types.ObjectId(input.documentId),
      status: "active",
    })) as SessionWithLifecycle | null;

    if (existingSession) {
      if (initialKeystrokes.length > 0) {
        const normalizedKeystrokes = normalizeKeystrokeTiming(
          initialKeystrokes as Keystroke[],
          existingSession.keystrokes as Keystroke[],
        );
        existingSession.keystrokes.push(...normalizedKeystrokes);
        await existingSession.save();
      }

      return { sessionId: existingSession._id.toString(), resumed: true };
    }
  }

  const normalizedKeystrokes = normalizeKeystrokeTiming(
    initialKeystrokes as Keystroke[],
  );

  const session = new Session({
    user: new Types.ObjectId(ownerId),
    documentId: new Types.ObjectId(input.documentId),
    code: generateSessionCode(), // Generate unique session code
    keystrokes: normalizedKeystrokes,
  });

  await session.save();
  await setLastOpenedSession(document, session._id);

  return { sessionId: session._id.toString(), resumed: false };
};

export const createSession = async (
  userId: string | undefined,
  input: Partial<CreateSessionInput>,
) => {
  return startOrResumeSession(userId, input);
};

export const appendToSession = async (
  userId: string | undefined,
  sessionId: string,
  input: Partial<SessionUpsertInput>,
): Promise<void> => {
  const ownerId = assertUserId(userId);

  assertValidObjectId(sessionId, "session id");

  const { keystrokes } = input;

  if (typeof keystrokes !== "undefined" && !Array.isArray(keystrokes)) {
    throw new ValidationError("keystrokes must be an array");
  }

  if (Array.isArray(keystrokes)) {
    validateKeystrokes(keystrokes);
  }

  const session = (await Session.findOne({
    _id: new Types.ObjectId(sessionId),
    user: new Types.ObjectId(ownerId),
  })) as SessionWithLifecycle | null;

  if (!session) {
    throw new NotFoundError("Session not found");
  }

  if (session.status === "closed") {
    throw new ValidationError("Session is closed");
  }

  if (Array.isArray(keystrokes) && keystrokes.length > 0) {
    const normalizedKeystrokes = normalizeKeystrokeTiming(
      keystrokes as Keystroke[],
      session.keystrokes as Keystroke[],
    );
    session.keystrokes.push(...normalizedKeystrokes);
    await session.save();
  }
};

export const closeSession = async (
  userId: string | undefined,
  sessionId: string,
  clientWpm?: number,
): Promise<CloseSessionResponse> => {
  const ownerId = assertUserId(userId);

  assertValidObjectId(sessionId, "session id");

  const session = (await Session.findOne({
    _id: new Types.ObjectId(sessionId),
    user: new Types.ObjectId(ownerId),
  })) as SessionWithLifecycle | null;

  if (!session) {
    throw new NotFoundError("Session not found");
  }

  if (session.status === "closed" && session.analytics && session.closedAt) {
    return {
      message: "Session already closed",
      sessionId: session._id.toString(),
      ...(session.documentId && { documentId: session.documentId.toString() }),
      analytics: session.analytics,
      closedAt: session.closedAt.toISOString(),
      alreadyClosed: true,
    };
  }

  const document = await Document.findById(session.documentId);
  const content = document?.content || "";

  let baseline = session.userBaseline || null;

  const analytics = computeSessionAnalytics(session.keystrokes, content, baseline);

  baseline = updateBaseline(baseline, analytics);

  const sanitize = (obj: any): any => {
    if (typeof obj === "number") return isNaN(obj) || !isFinite(obj) ? 0 : obj;
    if (Array.isArray(obj)) return obj.map(sanitize);
    if (typeof obj === "object" && obj !== null) {
      const newObj: any = {};
      for (const key in obj) {
        newObj[key] = sanitize(obj[key]);
      }
      return newObj;
    }
    return obj;
  };

  session.userBaseline = sanitize(baseline);
  session.baselineSnapshot = sanitize(baseline);

  if (clientWpm !== undefined) {
    analytics.approximateWpmVariance = typeof clientWpm === "number" && Number.isFinite(clientWpm) ? clientWpm : 0;
  }
  const closedAt = session.closedAt ?? new Date();

  session.status = "closed";
  session.closedAt = closedAt;
  session.analytics = sanitize({
    ...analytics,
    flags: Array.isArray(analytics.flags)
      ? analytics.flags.filter(
          (flag) => typeof flag === "string" && flag.trim().length > 0,
        )
      : [],
  });
  await session.save();

  return {
    message: "Session closed",
    sessionId: session._id.toString(),
    ...(session.documentId && { documentId: session.documentId.toString() }),
    analytics,
    closedAt: closedAt.toISOString(),
    alreadyClosed: false,
  };
};

export const listSessions = async (
  userId: string | undefined,
  documentId?: string,
): Promise<SessionListItem[]> => {
  const ownerId = assertUserId(userId);

  const filter: any = {
    user: new Types.ObjectId(ownerId),
  };

  // Add documentId filter if provided
  if (documentId) {
    filter.documentId = new Types.ObjectId(documentId);
  }

  const sessions = await Session.find(filter)
    .sort({ createdAt: -1 })
    .select("-__v");

  // Transform raw sessions to SessionListItem format with computed stats
  return sessions.map((session: any) => {
    const stats = computeDerivedStats(session.keystrokes || []);
    return {
      _id: session._id.toString(),
      documentId: session.documentId
        ? session.documentId.toString()
        : undefined,
      status: session.status,
      createdAt: session.createdAt.toISOString(),
      closedAt: session.closedAt ? session.closedAt.toISOString() : undefined,
      stats,
      analytics: session.analytics ?? null,
    };
  });
};

export const getSessionById = async (
  userId: string | undefined,
  sessionId: string,
) => {
  const ownerId = assertUserId(userId);
  assertValidObjectId(sessionId, "session id");

  const session = await Session.findOne({
    _id: new Types.ObjectId(sessionId),
    user: new Types.ObjectId(ownerId),
  }).select("-__v");

  if (!session) {
    throw new NotFoundError("Session not found");
  }

  return session;
};
