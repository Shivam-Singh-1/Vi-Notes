import mongoose from "mongoose";

const KeystrokeSchema = new mongoose.Schema({
  action: {
    type: String,
    enum: ["down", "up", "paste", "edit"],
    required: true,
  },
  rawTimestamp: Number,
  timestamp: { type: Number, required: true },
  rawDuration: Number,
  duration: Number,
  pasteLength: Number,
  pasteSelectionStart: Number,
  pasteSelectionEnd: Number,
  editedLater: Boolean,
  editStart: Number,
  editEnd: Number,
  insertedLength: Number,
  removedLength: Number,
});

const SessionAnalyticsSchema = new mongoose.Schema(
  {
    version: { type: Number, required: true, default: 0 },
    approximateWpmVariance: { type: Number, required: true, default: 0 },
    pauseFrequency: { type: Number, required: true, default: 0 },
    editRatio: { type: Number, required: true, default: 0 },
    pasteRatio: { type: Number, required: true, default: 0 },
    totalInsertedChars: { type: Number, required: true, default: 0 },
    totalDeletedChars: { type: Number, required: true, default: 0 },
    finalChars: { type: Number, required: true, default: 0 },
    totalPastedChars: { type: Number, required: true, default: 0 },
    pauseCount: { type: Number, required: true, default: 0 },
    durationMs: { type: Number, required: true, default: 0 },
    microPauseCount: { type: Number, default: 0 },
    wpm: { type: Number, default: 0 },
    wpmVariance: { type: Number, default: 0 },
    coefficientOfVariation: { type: Number, default: 0 },
    textAnalysis: {
      avgSentenceLength: { type: Number, default: 0 },
      sentenceVariance: { type: Number, default: 0 },
      lexicalDiversity: { type: Number, default: 0 },
      totalWords: { type: Number, default: 0 },
      totalSentences: { type: Number, default: 0 },
    },
    authenticity: {
      score: { type: Number, default: 0 },
      label: { type: String, default: "unknown" },
      behavioralScore: { type: Number, default: 0 },
      textualScore: { type: Number, default: 0 },
      crossCheckScore: { type: Number, default: 0 },
    },
    flags: {
      type: [String],
      default: [],
    },
  },
  { _id: false },
);

const SessionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  documentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Document",
    required: false,
  },
  code: {
    type: String,
    required: false,
    unique: true,
    sparse: true, // Allow multiple null values
  },
  keystrokes: [KeystrokeSchema],
  status: {
    type: String,
    enum: ["active", "closed"],
    default: "active",
    required: true,
  },
  closedAt: Date,
  analytics: SessionAnalyticsSchema,
  baselineSnapshot: {
    avgWpm: { type: Number, default: 0 },
    wpmVariance: { type: Number, default: 0 },
    pauseRate: { type: Number, default: 0 },
    editRatio: { type: Number, default: 0 },
    pasteRatio: { type: Number, default: 0 },
    rhythmCV: { type: Number, default: 0 },
  },
  userBaseline: {
    avgWpm: { type: Number, default: 0 },
    wpmVariance: { type: Number, default: 0 },
    pauseRate: { type: Number, default: 0 },
    editRatio: { type: Number, default: 0 },
    pasteRatio: { type: Number, default: 0 },
    rhythmCV: { type: Number, default: 0 },
    samples: { type: Number, default: 0 },
  },
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.model("Session", SessionSchema);
