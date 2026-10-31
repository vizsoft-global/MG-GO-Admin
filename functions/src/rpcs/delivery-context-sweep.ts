/**
 * Ten-minute rebuild of the shared delivery context.
 *
 * This is the backstop, not the only writer. Every admin write that changes the
 * rider's gate inputs rebuilds inline (see `delivery-context-build.ts`), so a
 * settings or zone edit is live on the next poll. The sweep exists because
 * writes leak — console edits, purges and bulk imports never call an RPC — and
 * because a document that stops being refreshed has to age out.
 *
 * A failed pass is retried by the next interval rather than an immediate re-run,
 * and the callable falls back to a live read once the document is stale, so a
 * broken sweep costs reads, never a wrong gate.
 */
import "../core/init";
import { logger } from "firebase-functions";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { FUNCTIONS_REGION } from "../router/lanes";
import { buildDeliveryContextCore } from "./delivery-context-build";

/** The rider app polls every minute; ten keeps a settings change prompt and the sweep trivial. */
export const DELIVERY_CONTEXT_SCHEDULE = "every 10 minutes";

export const deliveryProximitySweep = onSchedule(
  {
    schedule: DELIVERY_CONTEXT_SCHEDULE,
    region: FUNCTIONS_REGION,
    timeoutSeconds: 120,
    memory: "512MiB",
    cpu: 1,
    concurrency: 1,
    maxInstances: 1,
    retryCount: 0,
  },
  async () => {
    const startedAt = Date.now();
    try {
      const counts = await buildDeliveryContextCore();
      logger.info("delivery context sweep", { ...counts, ms: Date.now() - startedAt });
    } catch (err) {
      // Swallowed on purpose: the previous snapshot keeps serving until it goes
      // stale, and the next interval is the retry.
      logger.error("delivery context sweep failed", { err, ms: Date.now() - startedAt });
    }
  },
);
