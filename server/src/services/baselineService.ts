const safeNumber = (val: any, fallback = 0): number => {
  if (typeof val !== "number" || isNaN(val) || !isFinite(val)) {
    return fallback;
  }
  return val;
};

type Baseline = {
  avgWpm: number;
  wpmVariance: number;
  pauseRate: number;
  editRatio: number;
  pasteRatio: number;
  rhythmCV: number;
  samples: number;
};

export const updateBaseline = (oldBaseline: Baseline | null, current: any): Baseline => {
  if (!oldBaseline) {
    return {
      avgWpm: safeNumber(current.wpm),
      wpmVariance: safeNumber(current.wpmVariance),
      pauseRate: safeNumber(current.pauseCount),
      editRatio: safeNumber(current.editRatio),
      pasteRatio: safeNumber(current.pasteRatio),
      rhythmCV: safeNumber(current.coefficientOfVariation),
      samples: 1,
    };
  }

  const n = safeNumber(oldBaseline.samples, 1);

  const smooth = (oldVal: number, newVal: number) => {
    const safeOld = safeNumber(oldVal);
    const safeNew = safeNumber(newVal);
    return safeNumber((safeOld * n + safeNew) / (n + 1));
  };

  return {
    avgWpm: smooth(oldBaseline.avgWpm, current.wpm),
    wpmVariance: smooth(oldBaseline.wpmVariance, current.wpmVariance),
    pauseRate: smooth(oldBaseline.pauseRate, current.pauseCount),
    editRatio: smooth(oldBaseline.editRatio, current.editRatio),
    pasteRatio: smooth(oldBaseline.pasteRatio, current.pasteRatio),
    rhythmCV: smooth(oldBaseline.rhythmCV, current.coefficientOfVariation),
    samples: safeNumber(n + 1, 1),
  };
};

export const zScore = (value: number, mean: number, std: number) => {
  if (std === 0) return 0;
  return (value - mean) / std;
};

export const computeAdvancedDeviation = (baseline: any, current: any) => {
  const zWpm = zScore(current.wpm, baseline.avgWpm, baseline.wpmVariance);
  const zPause = zScore(current.pauseCount, baseline.pauseRate, 1);
  const zEdit = zScore(current.editRatio, baseline.editRatio, 0.1);
  const zPaste = zScore(current.pasteRatio, baseline.pasteRatio, 0.1);

  return Math.abs(zWpm) + Math.abs(zPause) + Math.abs(zEdit) + Math.abs(zPaste);
};

export const computeDeviationScore = (baseline: Baseline, current: any) => {
  const diff = (a: number, b: number) => Math.abs(a - b) / (b || 1);

  const score =
    diff(current.wpm, baseline.avgWpm) +
    diff(current.pauseCount, baseline.pauseRate) +
    diff(current.editRatio, baseline.editRatio) +
    diff(current.pasteRatio, baseline.pasteRatio) +
    diff(current.coefficientOfVariation, baseline.rhythmCV);

  return score / 5;
};
