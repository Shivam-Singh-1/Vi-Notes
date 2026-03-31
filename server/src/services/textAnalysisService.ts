interface TextMetrics {
  sentenceLengthVariance: number;
  avgSentenceLength: number;
  vocabularyDiversity: number;
  totalWords: number;
  uniqueWordRatio: number;
  punctuationDensity: number;
  avgWordLength: number;
  entropy: number;
  repetitionScore: number;
}

export const analyzeText = (content: string): TextMetrics => {
  const text = content.replace(/<[^>]*>/g, ' ').trim();
  
  if (!text) {
    return {
      sentenceLengthVariance: 0,
      avgSentenceLength: 0,
      vocabularyDiversity: 0,
      totalWords: 0,
      uniqueWordRatio: 0,
      punctuationDensity: 0,
      avgWordLength: 0,
    };
  }

  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const words = text.toLowerCase().match(/\b[a-z]+\b/gi) || [];
  const uniqueWords = new Set(words);

  const sentenceLengths = sentences.map(s => (s.match(/\b\w+\b/g) || []).length);
  const avgSentenceLength = sentenceLengths.length > 0
    ? sentenceLengths.reduce((a, b) => a + b, 0) / sentenceLengths.length
    : 0;

  const mean = avgSentenceLength;
  const variance = sentenceLengths.length > 1
    ? sentenceLengths.reduce((sum, len) => sum + (len - mean) ** 2, 0) / sentenceLengths.length
    : 0;

  const punctuationCount = (text.match(/[.,;:!?]/g) || []).length;
  const totalChars = text.replace(/\s/g, '').length;

  const entropy = (() => {
    const freq: Record<string, number> = {};
    words.forEach(w => freq[w] = (freq[w] || 0) + 1);

    return Object.values(freq).reduce((sum, f) => {
      const p = f / words.length;
      return sum - p * Math.log2(p);
    }, 0);
  })();

  const repetitionScore = words.length > 0
    ? words.filter((w, i) => words.indexOf(w) !== i).length / words.length
    : 0;

  return {
    sentenceLengthVariance: Math.round(variance * 100) / 100,
    avgSentenceLength: Math.round(avgSentenceLength * 100) / 100,
    vocabularyDiversity: uniqueWords.size,
    totalWords: words.length,
    uniqueWordRatio: words.length > 0 ? Math.round((uniqueWords.size / words.length) * 10000) / 10000 : 0,
    punctuationDensity: totalChars > 0 ? Math.round((punctuationCount / totalChars) * 10000) / 10000 : 0,
    avgWordLength: words.length > 0 ? Math.round((words.join('').length / words.length) * 100) / 100 : 0,
    entropy: Math.round(entropy * 100) / 100,
    repetitionScore: Math.round(repetitionScore * 10000) / 10000,
  };
};
