/** Usable function budget: 70% of maxDuration 60s. */
export const FUNCTION_BUDGET_MS = 42_000;

/** Plan estimate until render-bench replaces these. */
export const ESTIMATED_COLD_MS = 5_000;
export const ESTIMATED_PER_ROW_MS = 1_300;

export const CHUNK_SIZE = 25;
export const CHUNK_ROUNDS = 20;
export const BATCH_CAP = CHUNK_SIZE * CHUNK_ROUNDS;

export function computeChunkSize(coldMs: number, perRowMs: number): number {
  if (perRowMs <= 0) return CHUNK_SIZE;
  const raw = Math.floor((FUNCTION_BUDGET_MS - coldMs) / perRowMs);
  return Math.max(5, Math.min(50, raw));
}

export function computeBatchCap(chunkSize: number): number {
  return chunkSize * CHUNK_ROUNDS;
}
