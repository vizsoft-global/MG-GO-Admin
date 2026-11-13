/**
 * Periodic reconcile of the Bites mirrors.
 *
 * The admin panel writes restaurants, store links and driver identities straight to
 * Firestore from its own server actions. Those writes never reach an admin RPC, so
 * the inline pushes in `catalogs.ts` and `drivers-admin.ts` do not see them, and a
 * Firestore trigger cannot cover the gap: the live database is in me-central2, where
 * this project's agreement blocks compute (`LOCATION_POLICY_VIOLATED`).
 *
 * So the sweep is the net. It runs `reconcileBitesMirrorCore` — the same routine
 * `adminBackfillBitesMirror` exposes — on a fixed interval, which means a panel edit
 * reaches Bites within one interval rather than never.
 *
 * The cost is bounded and predictable: one pass per interval, one instance at a time
 * so two sweeps cannot race on the same rows, and the catalogue cap the core already
 * enforces. A pass that hits the cap still pushes; it just skips the orphan delete.
 */
import "../core/init";
import { logger } from "firebase-functions";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { getFirestore } from "../core/fs";
import { FUNCTIONS_REGION } from "../router/lanes";
import { reconcileBitesMirrorCore } from "./bites-backfill";

/** Every five minutes: fast enough for an operator, cheap enough to leave running. */
export const BITES_SWEEP_SCHEDULE = "every 5 minutes";

export const bitesMirrorSweep = onSchedule(
  {
    schedule: BITES_SWEEP_SCHEDULE,
    region: FUNCTIONS_REGION,
    timeoutSeconds: 300,
    memory: "1GiB",
    cpu: 1,
    concurrency: 1,
    maxInstances: 1,
    // A failed sweep is retried by the next interval, not by an immediate re-run
    // that would race the one already in flight.
    retryCount: 0,
  },
  async () => {
    const startedAt = Date.now();
    try {
      const counts = await reconcileBitesMirrorCore(getFirestore());
      logger.info("bites mirror sweep", {
        ...counts,
        ms: Date.now() - startedAt,
      });
    } catch (err) {
      // Swallowed on purpose: the mirror is a copy of the delivery side's own rows,
      // and the next interval is the retry. Throwing here only fills the error log
      // with the same Bites outage once per interval.
      logger.error("bites mirror sweep failed", { err, ms: Date.now() - startedAt });
    }
  },
);
