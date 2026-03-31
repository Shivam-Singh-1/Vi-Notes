import type { SessionTextAnalysis } from "../shared/session.js";

const safeNumber = (val: any, fallback = 0): number => {
  if (typeof val !== "number" || isNaN(val) || !isFinite(val)) {
    return fallback;
  }
  return val;
};

type BehavioralMetrics = {
  approximateWpmVariance: number;
  pauseFrequency: number;
  editRatio: number;
  pasteRatio: number;
  deviationScore?: number;
  rhythmScore?: number;
  pauseEntropy?: number;
  wpmStability?: number;
};

function sigmoid(x: number) {
  return 1 / (1 + Math.exp(-x));
}

export const calculateAuthenticityScore = (
  behavioral: BehavioralMetrics,
  textAnalysis: SessionTextAnalysis,
): { score: number; label: string; behavioralScore: number; textualScore: number; crossCheckScore: number } => {
  const {
    editRatio,
    pasteRatio,
    pauseFrequency,
    approximateWpmVariance,
    deviationScore = 0,
    rhythmScore = 0,
    pauseEntropy = 0,
    wpmStability = 0,
  } = behavioral;

  const editPenalty = Math.min(editRatio * 100, 30);
  const pastePenalty = Math.min(pasteRatio * 120, 40);
  const deviationPenalty = Math.min(deviationScore * 10, 30);

  const rhythmBonus = Math.max(0, 20 - rhythmScore * 10);
  const pauseBonus = pauseEntropy * 10;
  const wpmBonus = Math.max(0, 20 - wpmStability * 20);

  const rawScore =
    100 -
    (editPenalty + pastePenalty + deviationPenalty) +
    (rhythmBonus + pauseBonus + wpmBonus);

  const safeRaw = safeNumber(rawScore, 0);
  const score = Math.round(sigmoid(safeRaw / 20) * 100);

  let label = "uncertain";
  if (score > 80) label = "human";
  else if (score > 60) label = "likely human";
  else if (score < 40) label = "likely ai";

  return {
    score: safeNumber(score),
    label,
    behavioralScore: safeNumber(rawScore),
    textualScore: safeNumber(textAnalysis.lexicalDiversity, 50),
    crossCheckScore: safeNumber(100 - deviationPenalty),
  };
};
