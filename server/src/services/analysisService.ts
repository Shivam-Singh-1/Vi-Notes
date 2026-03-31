// Strict normalizer: only real strings, arrays of strings, or arrays with anomalyFlags; all else collapses to []
const toStringArray = (value: unknown): string[] => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    // Handles accidental JSON-stringified arrays/objects
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

  const mean = intervals.reduce((a, b) => a + b, 0) / (intervals.length || 1);
  const variance = intervals.reduce((s, v) => s + (v - mean) ** 2, 0) / (intervals.length || 1);
  const std = Math.sqrt(variance);
  const coefficientOfVariation = mean > 0 ? std / mean : 0;

  // =========================
  // 🔥 WPM PROFILE (window-based)
  // =========================
  const wpmSamples: number[] = [];
  const windowSize = 10;

  for (let i = 0; i < intervals.length - windowSize; i++) {
    const slice = intervals.slice(i, i + windowSize);
    const avg = slice.reduce((a, b) => a + b, 0) / slice.length;
    const wpm = 60000 / (avg * CHARS_PER_WORD);
    if (Number.isFinite(wpm)) wpmSamples.push(wpm);
  }

  const wpm =
    wpmSamples.length > 0
      ? wpmSamples.reduce((a, b) => a + b, 0) / wpmSamples.length
      : 0;

  const wpmVariance =
    wpmSamples.length > 1
      ? Math.sqrt(
          wpmSamples.reduce((s, v) => s + (v - wpm) ** 2, 0) /
            wpmSamples.length,
        )
      : 0;

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
  const p1 = microPauseCount / (totalPauses || 1);
  const p2 = macroPauseCount / (totalPauses || 1);

  const pauseEntropy =
    -(p1 * Math.log2(p1 || 1) + p2 * Math.log2(p2 || 1));

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

  const editRatio =
    finalChars > 0 ? totalDeletedChars / finalChars : 0;

  const pasteRatio =
    totalInsertedChars > 0
      ? totalPastedChars / totalInsertedChars
      : 0;

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
  const behavioralMetrics = {
    approximateWpmVariance: roundTo(wpm, 1),
    pauseFrequency: pauseCount + pauseEntropy, // 🔥 smarter pause signal
    editRatio: roundTo(editRatio, 4),
    pasteRatio: roundTo(pasteRatio, 4),
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

  return {
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
  };
};
