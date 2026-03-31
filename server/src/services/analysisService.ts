const safeNumber = (val: any, fallback = 0): number => {
  if (typeof val !== "number" || isNaN(val) || !isFinite(val)) {
    return fallback;
  }
  return val;
};

const safeDivide = (a: number, b: number): number => {
  if (!b || b === 0) return 0;
  return safeNumber(a / b);
};

function mean(arr: number[]) {
  return arr.reduce((a, b) => a + b, 0) / (arr.length || 1);
}

function stdDev(arr: number[]) {
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length || 1));
}

function skewness(arr: number[]) {
  const m = mean(arr);
  const sd = stdDev(arr);
  if (sd === 0) return 0;
  return arr.reduce((sum, x) => sum + ((x - m) / sd) ** 3, 0) / arr.length;
}

function sigmoid(x: number) {
  return 1 / (1 + Math.exp(-x));
}

const toStringArray = (value: unknown): string[] => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      return toStringArray(JSON.parse(trimmed));
    } catch {
      return [trimmed];
    }
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      if (typeof item === "string") {
        const trimmed = item.trim();
        return trimmed ? [trimmed] : [];
      }
      if (item && typeof item === "object" && "anomalyFlags" in item) {
        return toStringArray((item as { anomalyFlags?: unknown }).anomalyFlags);
      }
      return [];
    });
  }
  return [];
};
import type { Keystroke, SessionAnalytics } from "../shared/index.js";
import { analyzeText } from "./textAnalysisService.js";
import { calculateAuthenticityScore } from "./scoringService.js";
import { detectAnomalies } from "./anomalyService.js";
import { computeDeviationScore } from "./baselineService.js";

const CHARS_PER_WORD = 5;
const PAUSE_THRESHOLD_MS = 2_000;
const ANALYTICS_VERSION = 1;

const roundTo = (value: number, decimals: number) => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

const getNumericValue = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

const getPreferredTimestamp = (event: Keystroke): number | undefined => {
  // Prefer rawTimestamp (original Date.now()) over smoothed timestamp
  // to avoid normalizeKeystrokeTiming compression distorting WPM/pause calc
  if (typeof event.rawTimestamp === "number" && Number.isFinite(event.rawTimestamp)) {
    return event.rawTimestamp;
  }
  if (typeof event.timestamp === "number" && Number.isFinite(event.timestamp)) {
    return event.timestamp;
  }
  return undefined;
};

const getSortedEvents = (keystrokes: Keystroke[]) =>
  [...keystrokes].sort(
    (a, b) => (getPreferredTimestamp(a) ?? 0) - (getPreferredTimestamp(b) ?? 0),
  );

export const computeSessionAnalytics = (
  keystrokes: Keystroke[],
  documentContent: string = "",
  userBaseline?: any,
): SessionAnalytics => {

  const safeKeystrokes = Array.isArray(keystrokes) ? keystrokes : [];

  if (safeKeystrokes.length === 0) {
    return {
      version: ANALYTICS_VERSION,
      approximateWpmVariance: 0,
      pauseFrequency: 0,
      editRatio: 0,
      pasteRatio: 0,
      totalInsertedChars: 0,
      totalDeletedChars: 0,
      finalChars: 0,
      totalPastedChars: 0,
      pauseCount: 0,
      durationMs: 0,
      microPauseCount: 0,
      wpm: 0,
      wpmVariance: 0,
      coefficientOfVariation: 0,
      textAnalysis: {
        avgSentenceLength: 0,
        sentenceVariance: 0,
        lexicalDiversity: 0,
        totalWords: 0,
        totalSentences: 0,
      },
      authenticity: {
        score: 0,
        label: "unknown",
        behavioralScore: 0,
        textualScore: 0,
        crossCheckScore: 0,
      },
      flags: [],
    };
  }

  const orderedEvents = getSortedEvents(safeKeystrokes);

  const downEvents = orderedEvents.filter(e => e.action === "down");

  // =========================
  // 🔥 ADVANCED INTERVAL ANALYSIS
  // =========================
  const intervals: number[] = [];
  for (let i = 1; i < downEvents.length; i++) {
    const gap =
      (getPreferredTimestamp(downEvents[i]!) ?? 0) -
      (getPreferredTimestamp(downEvents[i - 1]!) ?? 0);

    if (gap > 0) intervals.push(gap);
  }

  const intervalMean = mean(intervals);
  const intervalStd = stdDev(intervals);
  const intervalSkew = skewness(intervals);
  const coefficientOfVariation = safeDivide(intervalStd, intervalMean);

  const rhythmScore = intervalStd > 0 ? Math.min(intervalStd / intervalMean, 2) : 0;

  // =========================
  // 🔥 WPM PROFILE (window-based)
  // =========================
  const wpmSamples: number[] = [];
  const windowSize = 10;

  for (let i = 0; i < intervals.length - windowSize; i++) {
    const slice = intervals.slice(i, i + windowSize);
    const avg = slice.reduce((a, b) => a + b, 0) / slice.length;
    const wpm = avg > 0 ? safeNumber(60000 / (avg * CHARS_PER_WORD)) : 0;
    if (wpm > 0) wpmSamples.push(wpm);
  }

  const wpm =
    wpmSamples.length > 0
      ? safeNumber(wpmSamples.reduce((a, b) => a + b, 0) / wpmSamples.length)
      : 0;

  const wpmVariance =
    wpmSamples.length > 1
      ? safeNumber(
          Math.sqrt(
            wpmSamples.reduce((s, v) => s + (v - wpm) ** 2, 0) /
              wpmSamples.length,
          ),
        )
      : 0;

  const wpmStability = safeDivide(wpmVariance, wpm);

  // =========================
  // 🔥 PAUSE MODELING (micro/macro)
  // =========================
  let pauseCount = 0;
  let microPauseCount = 0;
  let macroPauseCount = 0;

  for (const gap of intervals) {
    if (gap >= 2000) {
      pauseCount++;
      macroPauseCount++;
    } else if (gap > 300) {
      microPauseCount++;
    }
  }

  // entropy-like distribution score (human ≈ mixed pauses)
  const totalPauses = microPauseCount + macroPauseCount;
  const p1 = safeDivide(microPauseCount, totalPauses || 1);
  const p2 = safeDivide(macroPauseCount, totalPauses || 1);

  const safeLog = (x: number) => (x > 0 ? Math.log2(x) : 0);
  const pauseEntropy = safeNumber(-(p1 * safeLog(p1) + p2 * safeLog(p2)));

  // =========================
  // 🔥 INSERT / DELETE / PASTE
  // =========================
  let totalInsertedChars = 0;
  let totalDeletedChars = 0;
  let totalPastedChars = 0;

  for (const event of orderedEvents) {
    if (event.action === "edit") {
      totalInsertedChars += getNumericValue(event.insertedLength);
      totalDeletedChars += getNumericValue(event.removedLength);
    }
    if (event.action === "paste") {
      totalPastedChars += getNumericValue(event.pasteLength);
    }
  }

  const finalChars = Math.max(totalInsertedChars - totalDeletedChars, 0);

  const editRatio = safeDivide(totalDeletedChars, finalChars);

  const pasteRatio = safeDivide(totalPastedChars, totalInsertedChars);

  // =========================
  // 🔥 DURATION
  // =========================
  const first = getPreferredTimestamp(orderedEvents[0]) ?? 0;
  const last =
    getPreferredTimestamp(orderedEvents[orderedEvents.length - 1]) ??
    first;

  const durationMs = Math.max(0, last - first);

  // =========================
  // 🔥 TEXT ANALYSIS (unchanged shape)
  // =========================
  const rawTextStats = analyzeText(documentContent) as any;

  const textAnalysis = {
    avgSentenceLength: rawTextStats.avgSentenceLength ?? 0,
    sentenceVariance:
      rawTextStats.sentenceVariance ??
      rawTextStats.sentenceLengthVariance ??
      0,
    lexicalDiversity:
      rawTextStats.lexicalDiversity ??
      rawTextStats.vocabularyDiversity ??
      0,
    totalWords: rawTextStats.totalWords ?? 0,
    totalSentences:
      rawTextStats.totalSentences ??
      Math.max(1, Math.round((rawTextStats.totalWords || 0) / 15)),
  };

  // =========================
  // 🔥 BEHAVIORAL METRICS (ENHANCED)
  // =========================
  let deviationScore = 0;

  if (userBaseline) {
    deviationScore = computeDeviationScore(userBaseline, {
      wpm,
      pauseCount,
      editRatio,
      pasteRatio,
      coefficientOfVariation,
    });
  }

  const behavioralMetrics = {
    approximateWpmVariance: roundTo(wpm, 1),
    pauseFrequency: pauseCount + pauseEntropy,
    editRatio: roundTo(editRatio, 4),
    pasteRatio: roundTo(pasteRatio, 4),
    deviationScore,
    rhythmScore: roundTo(rhythmScore, 4),
    pauseEntropy: roundTo(pauseEntropy, 4),
    wpmStability: roundTo(wpmStability, 4),
  };

  const authenticity = calculateAuthenticityScore(
    behavioralMetrics,
    textAnalysis,
  );

  const anomalyReport = detectAnomalies(safeKeystrokes);

  const flags = Array.isArray(anomalyReport?.anomalyFlags)
    ? anomalyReport.anomalyFlags.filter(
        (f) => typeof f === "string" && f.trim().length > 0,
      )
    : [];

  const sanitize = (obj: any): any => {
    if (typeof obj === "number") return safeNumber(obj);
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

  return sanitize({
    version: ANALYTICS_VERSION,
    approximateWpmVariance: roundTo(wpm, 1),
    pauseFrequency: pauseCount,
    editRatio: roundTo(editRatio, 4),
    pasteRatio: roundTo(pasteRatio, 4),
    totalInsertedChars,
    totalDeletedChars,
    finalChars,
    totalPastedChars,
    pauseCount,
    durationMs,
    microPauseCount,
    wpm: roundTo(wpm, 1),
    wpmVariance: roundTo(wpmVariance, 2),
    coefficientOfVariation: roundTo(coefficientOfVariation, 4),
    textAnalysis,
    authenticity,
    flags,
  });
};
