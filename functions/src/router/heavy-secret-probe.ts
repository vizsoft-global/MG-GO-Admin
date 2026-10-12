/**
 * Test-only heavy-lane variant of adminPerfPing.
 *
 * Declares WORKER_SHARED_SECRET on the heavy options and returns only
 * `{ secretResolved: true | false }`. The secret value is never returned or logged.
 *
 * Not exported from index.ts, so a later deploy of the entrypoint cannot publish
 * it. The live `firebase functions:delete` step is NOT done: this run forbids
 * deploys, and this variant was never deployed.
 */
import "../core/init";
import { onCall, type CallableOptions } from "firebase-functions/v2/https";
import { workerSharedSecret } from "../rpcs/fleet-worker-http";
import { callableOptionsForLane } from "./lanes";

export const ADMIN_PERF_PING_HEAVY_SECRET = "adminPerfPingHeavySecret";

export const adminPerfPingHeavySecret = onCall(
  {
    ...callableOptionsForLane("heavy"),
    secrets: [workerSharedSecret],
  } as CallableOptions,
  () => ({ secretResolved: workerSharedSecret.value().length > 0 }),
);
