import { setGlobalOptions } from "firebase-functions/v2";
import { getApps, initializeApp } from "firebase-admin/app";

/**
 * Must load before any `onCall()` module. `export { fn } from "./rpcs/..."`
 * evaluates those files first unless this module is imported above them —
 * without that, v2 defaults every callable to us-central1.
 */
/**
 * Cloud Functions gen2 rejects uploads to me-central2 on this project
 * (`PERMISSION_DENIED` on generateUploadUrl). me-central1 (Doha) is the
 * nearest region that accepts a source upload; Firestore stays on the named
 * `default` database in me-central2.
 */
export const FUNCTIONS_REGION = "me-central1";

/**
 * Global options for the legacy callables.
 *
 * `concurrency` stays at 1 on purpose. Cloud Functions rejects a callable that
 * allows concurrent execution with less than one full CPU — the deploy fails
 * outright with "The following functions are configured to allow concurrent
 * execution and less than one full CPU. This is not supported" for every one of
 * these exports. Raising `cpu` to 1 instead would multiply the per-instance
 * rate for ~250 callables, which is the opposite of the goal, so the honest
 * shape is: keep cpu 0.08 + concurrency 1 here, and give read-only callables
 * their own `cpu: 1, concurrency: N` options when they are moved off the
 * legacy set. The lane exports (`adminApi` / `adminApiScan` / `adminApiHeavy`)
 * already do exactly that.
 */
setGlobalOptions({
  region: FUNCTIONS_REGION,
  maxInstances: 2,
  memory: "256MiB",
  cpu: 0.08,
  concurrency: 1,
});

if (getApps().length === 0) {
  initializeApp();
}
