import { FieldValue, getFirestore, Timestamp } from "../core/fs";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { COLLECTIONS, FIELDS } from "../core/collections";
import { parseId } from "../core/query";
import { requireStaff } from "../core/staff";

const APP_SETTINGS_DOC_ID = "1";

/** Not yet in `core/collections.ts`, which this file does not own. */
const DRIVER_IMPORT_BATCHES = "driver_import_batches";
/** SQL column is `last_seen_at`; not in `FIELDS.driverLocations`. */
const LAST_SEEN_AT = "last_seen_at";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
const MONTH_MS = 30 * DAY_MS;
const YEAR_MS = 365 * DAY_MS;

/** Firestore caps one commit at 500 writes. */
const COMMIT_CHUNK = 500;
/** `getAll` fan-out ceiling. */
const LOOKUP_CHUNK = 300;

/** `LIMIT GREATEST(COALESCE(p_batch, 50000), 1)` in the SQL. */
const DEFAULT_CLEANUP_BATCH = 50_000;
/** The SQL had no batch parameter here; a Firestore query must still be bounded. */
const DEFAULT_STALE_LOCATION_BATCH = 500;
const DEFAULT_MAX_AGE_MINUTES = 10;

const UNIT_MS: Record<string, number> = {
  ms: 1,
  s: 1_000,
  m: MINUTE_MS,
  h: HOUR_MS,
  d: DAY_MS,
  w: WEEK_MS,
  mon: MONTH_MS,
  y: YEAR_MS,
};

const INTERVAL_TOKEN_RE =
  /(\d+(?:\.\d+)?)\s*(milliseconds?|msecs?|months?|mons?|minutes?|mins?|seconds?|secs?|years?|yrs?|weeks?|wks?|hours?|hrs?|days?|ms|mon|min|sec|yr|wk|hr|s|m|h|d|w|y)/gi;

type RetentionStream =
  | "driver_operation_events"
  | "driver_location_events"
  | "driver_telemetry_events";

type RetentionSettingKey =
  | "driver_ops_log_retention_days"
  | "driver_location_events_retention_days"
  | "driver_telemetry_retention_days";

type StreamConfig = {
  collection: string;
  atField: string;
  settingsKey: RetentionSettingKey;
  defaultDays: number;
};

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function firstPresent(data: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    const value = data[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function normaliseUnit(token: string): keyof typeof UNIT_MS | null {
  const unit = token.toLowerCase();
  if (unit.startsWith("ms") || unit.startsWith("msec") || unit.startsWith("milli")) return "ms";
  if (unit.startsWith("mon")) return "mon";
  if (unit.startsWith("m")) return "m";
  if (unit.startsWith("h")) return "h";
  if (unit.startsWith("d")) return "d";
  if (unit.startsWith("w")) return "w";
  if (unit.startsWith("s")) return "s";
  if (unit.startsWith("y")) return "y";
  return null;
}

/**
 * A Postgres `interval` on the wire or a plain number. A bare number is read in
 * the RPC's own unit: days for a retention window, minutes for `max_age`.
 */
function parseIntervalMs(value: unknown, bareUnit: "days" | "minutes"): number | null {
  if (value === null || value === undefined || value === "") return null;
  const scale = bareUnit === "days" ? DAY_MS : MINUTE_MS;

  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) {
      throw new HttpsError("invalid-argument", "invalid_keep");
    }
    return value * scale;
  }
  if (typeof value !== "string") {
    throw new HttpsError("invalid-argument", "invalid_keep");
  }

  const text = value.trim();
  if (!text) return null;
  const bare = Number(text);
  if (Number.isFinite(bare)) {
    if (bare < 0) throw new HttpsError("invalid-argument", "invalid_keep");
    return bare * scale;
  }

  let total = 0;
  let matched = false;
  for (const token of text.matchAll(INTERVAL_TOKEN_RE)) {
    const unit = normaliseUnit(token[2]);
    if (!unit) continue;
    total += Number(token[1]) * UNIT_MS[unit];
    matched = true;
  }
  if (!matched) throw new HttpsError("invalid-argument", "invalid_keep");
  return total;
}

function readBatchSize(data: Record<string, unknown>, fallback: number): number {
  const raw = firstPresent(data, ["batchSize", "batch", "p_batch"]);
  if (raw === null) return fallback;
  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(value)) throw new HttpsError("invalid-argument", "invalid_batch");
  return Math.max(1, Math.floor(value));
}

/** The retention window floor at one day lives in the SQL; it lives here too. */
async function loadRetentionDays(key: RetentionSettingKey, fallback: number): Promise<number> {
  const snap = await getFirestore()
    .collection(COLLECTIONS.appSettings)
    .doc(APP_SETTINGS_DOC_ID)
    .get();
  const stored = snap.get(key);
  const value = typeof stored === "number" && Number.isFinite(stored) ? stored : fallback;
  return Math.max(1, Math.floor(value));
}

function retentionStreamConfig(stream: RetentionStream): StreamConfig {
  switch (stream) {
    case "driver_operation_events":
      return {
        collection: COLLECTIONS.driverOperationEvents,
        atField: "occurred_at",
        settingsKey: "driver_ops_log_retention_days",
        defaultDays: 90,
      };
    case "driver_location_events":
      // SQL column is `recorded_at`; the ported stream stores it as `at`.
      return {
        collection: COLLECTIONS.driverLocationEvents,
        atField: FIELDS.driverLocations.at,
        settingsKey: "driver_location_events_retention_days",
        defaultDays: 180,
      };
    case "driver_telemetry_events":
      return {
        collection: COLLECTIONS.driverTelemetryEvents,
        atField: "server_received_at",
        settingsKey: "driver_telemetry_retention_days",
        defaultDays: 14,
      };
    default: {
      const unhandled: never = stream;
      throw new HttpsError("internal", `unhandled_stream:${String(unhandled)}`);
    }
  }
}

async function resolveKeepMs(
  data: Record<string, unknown>,
  settingsKey: RetentionSettingKey,
  defaultDays: number,
): Promise<number> {
  const override = parseIntervalMs(firstPresent(data, ["keepDays", "keep", "p_keep"]), "days");
  if (override !== null) return override;
  return (await loadRetentionDays(settingsKey, defaultDays)) * DAY_MS;
}

/** One bounded batch, committed in Firestore-sized chunks, so a cron can loop. */
async function deleteOlderThan(
  collection: string,
  atField: string,
  cutoff: Date,
  batchSize: number,
): Promise<number> {
  const db = getFirestore();
  const snap = await db
    .collection(collection)
    .where(atField, "<", Timestamp.fromDate(cutoff))
    .orderBy(atField, "asc")
    .limit(batchSize)
    .get();
  const docs = snap.docs;

  let deleted = 0;
  for (let index = 0; index < docs.length; index += COMMIT_CHUNK) {
    const slice = docs.slice(index, index + COMMIT_CHUNK);
    const batch = db.batch();
    for (const doc of slice) batch.delete(doc.ref);
    await batch.commit();
    deleted += slice.length;
  }
  return deleted;
}

async function runRetentionCleanup(
  stream: RetentionStream,
  data: Record<string, unknown>,
): Promise<number> {
  const config = retentionStreamConfig(stream);
  const keepMs = await resolveKeepMs(data, config.settingsKey, config.defaultDays);
  const batchSize = readBatchSize(data, DEFAULT_CLEANUP_BATCH);
  return deleteOlderThan(
    config.collection,
    config.atField,
    new Date(Date.now() - keepMs),
    batchSize,
  );
}

/**
 * `cleanup_driver_location_events` — service-role only in the SQL (`REVOKE ALL`
 * from PUBLIC / anon / authenticated; only the cron can call it).
 */
export const cleanupDriverLocationEvents = onCall(async (request) => {
  await requireStaff(request);
  return runRetentionCleanup("driver_location_events", asRecord(request.data));
});

/** `cleanup_driver_operation_events` — service-role only in the SQL. */
export const cleanupDriverOperationEvents = onCall(async (request) => {
  await requireStaff(request);
  return runRetentionCleanup("driver_operation_events", asRecord(request.data));
});

/** `cleanup_driver_telemetry_events` — service-role only in the SQL. */
export const cleanupDriverTelemetryEvents = onCall(async (request) => {
  await requireStaff(request);
  return runRetentionCleanup("driver_telemetry_events", asRecord(request.data));
});

/**
 * `cleanup_stale_driver_locations`.
 *
 * The latest definition (`20260907180000_keep_offline_live_locations.sql`) deletes
 * a stale `driver_locations` row only when the driver is missing or archived, so
 * every live rider keeps their last-known pin past the live window — the earlier
 * on-duty-only version (`20260907150000`) was superseded.
 */
export const cleanupStaleDriverLocations = onCall(async (request) => {
  await requireStaff(request);

  const data = asRecord(request.data);
  const maxAgeMs =
    parseIntervalMs(firstPresent(data, ["maxAgeMinutes", "maxAge", "p_max_age"]), "minutes") ??
    DEFAULT_MAX_AGE_MINUTES * MINUTE_MS;
  const batchSize = readBatchSize(data, DEFAULT_STALE_LOCATION_BATCH);

  const db = getFirestore();
  const cutoff = Timestamp.fromDate(new Date(Date.now() - maxAgeMs));
  const stale = await db
    .collection(COLLECTIONS.driverLocations)
    .where(LAST_SEEN_AT, "<", cutoff)
    .orderBy(LAST_SEEN_AT, "asc")
    .limit(batchSize)
    .get();
  if (stale.empty) return 0;

  const driverIds = stale.docs.map((doc) => doc.id);
  const keep = new Set<string>();
  for (let index = 0; index < driverIds.length; index += LOOKUP_CHUNK) {
    const slug = driverIds.slice(index, index + LOOKUP_CHUNK);
    const snaps = await db.getAll(
      ...slug.map((id) => db.collection(COLLECTIONS.drivers).doc(id)),
    );
    for (const snap of snaps) {
      if (snap.exists && snap.get(FIELDS.drivers.archivedAt) == null) keep.add(snap.id);
    }
  }

  const removable = stale.docs.filter((doc) => !keep.has(doc.id));
  let deleted = 0;
  for (let index = 0; index < removable.length; index += COMMIT_CHUNK) {
    const slice = removable.slice(index, index + COMMIT_CHUNK);
    const batch = db.batch();
    for (const doc of slice) batch.delete(doc.ref);
    await batch.commit();
    deleted += slice.length;
  }
  return deleted;
});

/**
 * `claim_driver_import_chunk` — one transactional claim so two workers cannot
 * take the same chunk. Returns the claimed rows, or `null` when the batch is
 * missing / not running (the SQL's `NOT FOUND` branch).
 */
export const claimDriverImportChunk = onCall(async (request) => {
  await requireStaff(request);

  const data = asRecord(request.data);
  const jobId = parseId(firstPresent(data, ["id", "jobId", "pId", "p_id"]));
  const rawSize = firstPresent(data, ["size", "chunkSize", "p_size"]);
  const size = typeof rawSize === "number" ? rawSize : Number(rawSize);
  if (!jobId || !Number.isFinite(size) || size < 1 || size > 50) {
    throw new HttpsError("invalid-argument", "invalid_chunk");
  }
  const chunkSize = Math.floor(size);

  const db = getFirestore();
  const ref = db.collection(DRIVER_IMPORT_BATCHES).doc(jobId);
  const claimed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const batch = snap.data() ?? {};
    if (batch["status"] !== "running") return null;

    const rows = Array.isArray(batch["remaining_rows"])
      ? (batch["remaining_rows"] as unknown[])
      : [];
    const taken = rows.slice(0, chunkSize);
    const rest = rows.slice(chunkSize);
    tx.update(ref, {
      remaining_rows: rest,
      remaining_count: rest.length,
      heartbeat_at: FieldValue.serverTimestamp(),
    });
    return taken;
  });

  return claimed;
});
