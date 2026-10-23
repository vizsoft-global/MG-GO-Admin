/**
 * GPS doors override the global 0.08 CPU / concurrency 1 shape.
 * A reconnect wave that 429s falls back to Firestore (~40 documents per fix).
 */
export const WORKER_HTTP_CAPACITY = {
  timeoutSeconds: 120,
  cpu: 1,
  concurrency: 40,
  maxInstances: 20,
  minInstances: 1,
} as const;
