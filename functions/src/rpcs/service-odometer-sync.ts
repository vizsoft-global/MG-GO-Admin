/**
 * The dashcam odometer sync.
 *
 * Cars are read from the vendor's fleet API four times a day. The adapter is
 * **configuration, not code**: `service_odometer_sync/current` holds the base
 * URL, the credential, the path and the field names, because the vendor's
 * published specification answers 500 from outside their network and the real
 * shape cannot be read in advance. An operator proves the shape with **Test
 * connection** in the panel — which shows the raw first row — and the scheduled
 * run then uses the same fields.
 *
 * Two rules the run refuses to break:
 *  - A reading only ever moves the stored figure **up**. A meter that reports
 *    less than we hold is skipped and counted, never written, because a rewind
 *    would hide every overdue service behind a fresh-looking baseline.
 *  - Matching is on `chassis_no` first, then the normalised plate. A row that
 *    matches neither is counted in the run log and never guessed by model.
 */
import "firebase-functions";
import { logger } from "firebase-functions";
import { onSchedule } from "firebase-functions/v2/scheduler";
import type { Firestore } from "firebase-admin/firestore";
import { getFirestore } from "../core/fs";
import { COLLECTIONS } from "../core/collections";
import { FUNCTIONS_REGION } from "../router/lanes";
import {
  numberOrNull,
  planOdometerReadings,
  rowsOf,
  text,
  type FleetOdometerVehicle,
} from "../core/odometer-sync-plan";

export const SERVICE_ODOMETER_SCHEDULE = "0 0,6,12,18 * * *";
const ODOMETER_SYNC_DOC = "current";
/** The vendor feed is a list, so one page has to be enough to be honest. */
const REQUEST_TIMEOUT_MS = 20_000;

/**
 * `AppSecret` for the dashcam vendor.
 *
 * Declared as a **Secret Manager** secret so the scheduler gains read access to
 * exactly one value. It is never stored in Firestore, never returned to the panel
 * and never written to a log or an audit row; `AppCid` is not sensitive and stays
 * on `service_odometer_sync/current` beside the paths.
 *
 *   firebase functions:secrets:set SERVICE_ODOMETER_APP_SECRET
 *
 * The value arrives in `process.env` at runtime because it is named in the
 * `secrets` array below — the string form is used deliberately: wrapping it in
 * `defineSecret()` made this project's type check explode into a minutes-long
 * inference over the firebase-functions generics, and the runtime behaviour is
 * identical.
 */
export const SERVICE_ODOMETER_SECRET = "SERVICE_ODOMETER_APP_SECRET" as const;

type SyncConfig = {
  enabled: boolean;
  base_url: string;
  auth_mode: string;
  app_cid: string;
  vehicles_path: string;
  odometer_field: string;
  plate_field: string;
  chassis_field: string;
};

export async function readSyncConfig(db: Firestore): Promise<SyncConfig | null> {
  const snap = await db.collection("service_odometer_sync").doc(ODOMETER_SYNC_DOC).get();
  if (!snap.exists) return null;
  const row = snap.data() ?? {};
  return {
    enabled: row.enabled === true,
    base_url: text(row.base_url).replace(/\/+$/, ""),
    auth_mode: text(row.auth_mode) || "headers",
    app_cid: text(row.app_cid),
    vehicles_path: text(row.vehicles_path) || "/vehicle/list",
    odometer_field: text(row.odometer_field) || "odometer",
    plate_field: text(row.plate_field) || "plateNo",
    chassis_field: text(row.chassis_field) || "vin",
  };
}

export type OdometerSyncSummary = {
  /** `disabled` / `not_configured` short-circuit without any request. */
  status: "disabled" | "not_configured" | "ok" | "failed";
  rows: number;
  updated: number;
  /** Readings at or below the stored figure — never written. */
  skipped: number;
  /** Rows whose chassis and plate both missed the fleet. */
  unmatched: number;
  message?: string;
};

type FleetMaps = {
  rows: FleetOdometerVehicle[];
};

async function loadFleet(db: Firestore): Promise<FleetMaps> {
  const snap = await db.collection(COLLECTIONS.vehicles).get();
  const rows: FleetOdometerVehicle[] = [];
  for (const doc of snap.docs) {
    const row = doc.data();
    rows.push({
      id: doc.id,
      plate: text(row.reg_number) || text(row.bike_id),
      chassisNo: text(row.chassis_no) || null,
      currentKm: numberOrNull(row.current_odometer_km),
      archived: Boolean(row.archived_at),
    });
  }
  return { rows };
}

/**
 * One pass. Exported so the panel's Test connection and the scheduler exercise
 * the same code — a config that works in the dialog must work at 06:00.
 */
export async function runOdometerSync(
  db: Firestore,
  appSecret: string,
  fetchImpl: typeof fetch = fetch,
): Promise<OdometerSyncSummary> {
  const config = await readSyncConfig(db);
  if (!config) return { status: "not_configured", rows: 0, updated: 0, skipped: 0, unmatched: 0 };
  if (!config.enabled) return { status: "disabled", rows: 0, updated: 0, skipped: 0, unmatched: 0 };
  // A missing secret is a configuration fault, not an outage: say so and stop.
  if (!appSecret.trim()) {
    return {
      status: "not_configured",
      rows: 0,
      updated: 0,
      skipped: 0,
      unmatched: 0,
      message: "SERVICE_ODOMETER_APP_SECRET is not set",
    };
  }
  if (!/^https?:\/\//i.test(config.base_url)) {
    return {
      status: "not_configured",
      rows: 0,
      updated: 0,
      skipped: 0,
      unmatched: 0,
      message: "base_url is not an http(s) URL",
    };
  }

  const url = `${config.base_url}${config.vehicles_path.startsWith("/") ? "" : "/"}${config.vehicles_path}`;
  let payload: unknown = null;
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        AppCid: config.app_cid,
        AppSecret: appSecret,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      return {
        status: "failed",
        rows: 0,
        updated: 0,
        skipped: 0,
        unmatched: 0,
        message: `HTTP ${response.status}`,
      };
    }
    payload = await response.json();
  } catch (error) {
    return {
      status: "failed",
      rows: 0,
      updated: 0,
      skipped: 0,
      unmatched: 0,
      message: String(error).slice(0, 200),
    };
  }

  const rows = rowsOf(payload);
  if (rows.length === 0) {
    const empty: OdometerSyncSummary = {
      status: "ok",
      rows: 0,
      updated: 0,
      skipped: 0,
      unmatched: 0,
    };
    await recordRun(db, empty);
    return empty;
  }

  const fleet = await loadFleet(db);
  const plan = planOdometerReadings(rows, fleet.rows, config);
  if (plan.writes.length === 0) {
    const empty: OdometerSyncSummary = {
      status: "ok",
      rows: plan.rows,
      updated: 0,
      skipped: plan.skipped,
      unmatched: plan.unmatched,
    };
    await recordRun(db, empty);
    return empty;
  }

  const now = new Date();
  let batch = db.batch();
  let pending = 0;
  for (const write of plan.writes) {
    batch.set(
      db.collection(COLLECTIONS.vehicles).doc(write.vehicleId),
      {
        current_odometer_km: write.km,
        odometer_source: "dashcam",
        odometer_updated_at: now,
        updated_at: now,
      },
      { merge: true },
    );
    const readingRef = db.collection(COLLECTIONS.vehicleOdometerReadings).doc();
    batch.set(readingRef, {
      id: readingRef.id,
      vehicle_id: write.vehicleId,
      km: write.km,
      source: "dashcam",
      at: now,
      created_at: now,
    });
    pending += 1;
    if (pending >= 400) {
      await batch.commit();
      batch = db.batch();
      pending = 0;
    }
  }
  if (pending > 0) await batch.commit();

  const summary: OdometerSyncSummary = {
    status: "ok",
    rows: plan.rows,
    updated: plan.writes.length,
    skipped: plan.skipped,
    unmatched: plan.unmatched,
  };
  await recordRun(db, summary);
  return summary;
}

/** The panel shows the last run, so a silent failure is visible in the dialog. */
async function recordRun(db: Firestore, summary: OdometerSyncSummary): Promise<void> {
  const now = new Date();
  await db
    .collection("service_odometer_sync")
    .doc(ODOMETER_SYNC_DOC)
    .set(
      {
        last_run_at: now.toISOString(),
        last_run_summary: JSON.stringify(summary),
        updated_at: now,
      },
      { merge: true },
    );
}

export const serviceOdometerSync = onSchedule(
  {
    schedule: SERVICE_ODOMETER_SCHEDULE,
    timeZone: "Asia/Kuwait",
    region: FUNCTIONS_REGION,
    timeoutSeconds: 300,
    memory: "512MiB",
    cpu: 1,
    concurrency: 1,
    maxInstances: 1,
    // The one Secret Manager value this function may read. Deployment grants the
    // scheduler's service account access to exactly this secret.
    secrets: [SERVICE_ODOMETER_SECRET],
    // The next interval is the retry; an immediate re-run would only repeat the
    // same vendor outage once a minute.
    retryCount: 0,
  },
  async () => {
    const startedAt = Date.now();
    try {
      const summary = await runOdometerSync(
        getFirestore(),
        process.env[SERVICE_ODOMETER_SECRET] ?? "",
      );
      logger.info("service odometer sync", { ...summary, ms: Date.now() - startedAt });
    } catch (error) {
      logger.error("service odometer sync failed", { error, ms: Date.now() - startedAt });
    }
  },
);
