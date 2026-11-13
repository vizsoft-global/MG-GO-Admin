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

/**
 * The three single-purpose doors once `workerApi` carries their traffic.
 *
 * Each of them kept one whole-CPU instance alive day and night
 * (`minInstances: 1`): three always-on instances for about two requests a
 * second between them, more than half of the project's compute. They stay
 * deployed so the tracking server can be pointed back at them, and they still
 * take a burst, but with no traffic they now cost nothing.
 */
export const WORKER_HTTP_STANDBY_CAPACITY = {
  ...WORKER_HTTP_CAPACITY,
  minInstances: 0,
} as const;
