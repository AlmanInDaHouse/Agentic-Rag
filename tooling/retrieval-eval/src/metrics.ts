export function precisionAtK(results: string[], expected: string[], k: number): number {
  if (k <= 0) {
    return 0;
  }
  const topResults = topK(results, k);
  const expectedSet = new Set(expected);
  const matches = topResults.filter((result) => expectedSet.has(result)).length;
  return matches / k;
}

export function recallAtK(results: string[], expected: string[], k: number): number {
  if (expected.length === 0) {
    return 0;
  }
  const expectedSet = new Set(expected);
  const matches = new Set(topK(results, k).filter((result) => expectedSet.has(result)));
  return matches.size / expectedSet.size;
}

export function hitAtK(results: string[], expected: string[], k: number): number {
  const expectedSet = new Set(expected);
  return topK(results, k).some((result) => expectedSet.has(result)) ? 1 : 0;
}

export function meanReciprocalRank(results: string[], expected: string[], k = results.length): number {
  const expectedSet = new Set(expected);
  const boundedResults = topK(results, k);
  const firstMatchIndex = boundedResults.findIndex((result) => expectedSet.has(result));
  return firstMatchIndex === -1 ? 0 : 1 / (firstMatchIndex + 1);
}

function topK(results: string[], k: number): string[] {
  return results.slice(0, Math.max(0, k));
}
