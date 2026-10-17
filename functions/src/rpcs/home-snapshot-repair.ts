/**
 * Hourly repair sweep for `driver_home_daily`.
 *
 * The RPC already fills a missing or stale snapshot on a cache miss, so this is
 * the net for the riders who never open Home: without it, one missed writer
 * would leave a snapshot wrong until the rider happened to look at the screen.
 *
 * The sweep only walks **on-duty** riders. A rider who is not working has no
 * live Home to be wrong, and their next call pays the miss path anyway. The
 * rebuild itself is throttled, so a rider whose snapshot is already fresh costs
 * one document read and stops there.
 */
import "../core/init";
import { logger } from "firebase-functions";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { getFirestore } from "../core/fs";
import { COLLECTIONS } from "../core/collections";
import { kuwaitDayString } from "../core/kuwait";
import { readConfigEpochs } from "../core/config-cache";
import { loadHomeSnapshotFlags } from "../core/settings";
import { FUNCTIONS_REGION } from "../router/lanes";
import { rebuildDriverHomeDaily } from "./driver-home";

/** One pass an hour: the staleness window the read path tolerates is 30 min. */
export const HOME_SNAPSHOT_REPAIR_SCHEDULE = "every 60 minutes";

/** A shift-start herd is under 500; 100 keeps one pass short and the rest wait. */
const REPAIR_LIMIT = 100;

export const homeSnapshotRepair = onSchedule(
  {
    schedule: HOME_SNAPSHOT_REPAIR_SCHEDULE,
    region: FUNCTIONS_REGION,
    timeoutSeconds: 540,
    memory: "512MiB",
    cpu: 1,
    concurrency: 1,
    maxInstances: 1,
    // The next interval is the retry; an immediate re-run would race itself.
    retryCount: 0,
  },
  async () => {
    const startedAt = Date.now();
    const today = kuwaitDayString(new Date());
    const epochs = await readConfigEpochs();
    const flags = await loadHomeSnapshotFlags(epochs.config);
    if (!flags.enabled) {
      logger.info({ perf: "home", name: "homeSnapshotRepair", skipped: "disabled" });
      return;
    }

    const onDuty = await getFirestore()
      .collection(COLLECTIONS.drivers)
      .where("is_on_duty", "==", true)
      .limit(REPAIR_LIMIT)
      .get();

    let rebuilt = 0;
    let skipped = 0;
    let failed = 0;
    for (const doc of onDuty.docs) {
      try {
        const result = await rebuildDriverHomeDaily(doc.id, today, "repair");
        if (result === "rebuilt") rebuilt += 1;
        else skipped += 1;
      } catch {
        failed += 1;
      }
    }

    logger.info({
      perf: "home",
      name: "homeSnapshotRepair",
      on_duty: onDuty.size,
      rebuilt,
      skipped,
      failed,
      ms: Date.now() - startedAt,
    });
  },
);
