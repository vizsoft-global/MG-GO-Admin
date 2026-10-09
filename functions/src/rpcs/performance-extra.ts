import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { COLLECTIONS } from "../core/collections";
import { kuwaitDayEnd, kuwaitDayStart, kuwaitDayString } from "../core/kuwait";
import { parseId } from "../core/query";
import { loadAppSettings, type AppSettings } from "../core/settings";
import { requireStaff, type StaffContext } from "../core/staff";

const PERFORMANCE_RATING_TEAMS = "performance_rating_teams";
const DELIVERY_SLA_OVERRIDES = "delivery_sla_overrides";

const APP_SETTINGS_DOC_ID = "1";
const DAY_MS = 24 * 60 * 60 * 1000;
const GET_ALL_CHUNK = 300;
const WRITE_CHUNK = 400;

/**
 * The SQL computed the whole window to answer one call. A 400-day window is the
 * largest the rollup accepts, so this ceiling is deliberately above any window
 * the guards let through and only ever fires on a runaway read.
 */
const SCAN_CAP = 60_000;

const MAX_ROLLUP_DAYS = 400;
const MAX_DAY_VIEW_DAYS = 92;

const DEFAULT_SLA_MINUTES = 45;
const DEFAULT_SPEED_ALLOWANCE = 2;
const DEFAULT_CONDUCT_ALLOWANCE = 0.25;

const EXCLUDED_DELIVERY_STATUSES = new Set(["cancelled", "rejected", "in_transit"]);

const COMPONENT_KEYS = [
  "punctuality",
  "duty_ratio",
  "on_time",
  "speed",
  "zone",
  "gps",
  "conduct",
] as const;

const ZONE_EVENT_KEYS = new Set(["zone.exit", "zone.entry"]);
const RANGE_EVENT_KEYS = new Set(["range.exit", "range.entry"]);
const PAIRED_EVENT_KEYS = new Set([
  "zone.exit",
  "zone.entry",
  "range.exit",
  "range.entry",
  "gps.offline",
  "gps.restored",
]);
const OPEN_EVENT_KEYS = new Set(["zone.exit", "range.exit", "gps.offline"]);

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;

type Json = Record<string, unknown>;

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length ? value : null;
}

function numberOf(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asDate(value: unknown): Date | null {
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value);
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (isRecord(value) && "seconds" in value) {
    const seconds = Number(value.seconds);
    if (Number.isFinite(seconds)) return new Date(seconds * 1000);
  }
  return null;
}

function pick(data: Json, camel: string, snake: string): unknown {
  const value = data[camel];
  return value === undefined ? data[snake] : value;
}

function dayKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (DAY_RE.test(trimmed)) return trimmed;
  if (MONTH_RE.test(trimmed)) return `${trimmed}-01`;
  return null;
}

function monthFirstDay(value: unknown): string | null {
  const day = dayKey(value);
  return day ? `${day.slice(0, 7)}-01` : null;
}

function addDays(day: string, delta: number): string {
  return kuwaitDayString(kuwaitDayStart(day).getTime() + delta * DAY_MS);
}

function dayDiff(from: string, to: string): number {
  return Math.round((kuwaitDayStart(to).getTime() - kuwaitDayStart(from).getTime()) / DAY_MS);
}

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

function round4(value: number | null): number | null {
  return value === null ? null : Number(value.toFixed(4));
}

function round1(value: number): number {
  return Number(value.toFixed(1));
}

function currentKuwaitMonth(): string {
  return `${kuwaitDayString(new Date()).slice(0, 7)}-01`;
}

async function requireEither(
  request: CallableRequest<unknown>,
  slugs: readonly string[],
): Promise<StaffContext> {
  let denied: unknown = null;
  for (const slug of slugs) {
    try {
      return await requireStaff(request, slug);
    } catch (error) {
      if (denied === null) denied = error;
    }
  }
  throw denied instanceof HttpsError
    ? denied
    : new HttpsError("permission-denied", "not_authorized");
}

// ---------------------------------------------------------------------------
// The per-driver-day source
//
// `v_attendance_daily` is reconstructed from the attendance document alone.
// Three of the view's five branches reduce exactly: `attendance_status` is one of
// three values, `live_status = 'absent'` requires no check-in, and both `worked`
// and `absent` therefore depend only on the stored status and the check-in — so
// the GPS row and the geofence join the view carried are not read here.
// ---------------------------------------------------------------------------

type DailySourceRow = {
  driver_id: string;
  log_date: string;
  worked: boolean;
  on_leave: boolean;
  absent: boolean;
  lost_minutes: number | null;
  scheduled_minutes: number | null;
  online_seconds: number | null;
  duty_seconds: number | null;
  out_of_zone_minutes: number | null;
  gps_offline_minutes: number | null;
  deliveries_completed: number | null;
  deliveries_within_sla: number | null;
  overspeed_events: number | null;
  /** Null on a live (today) day: the ledger is authored, not derived. */
  conduct_weighted: number | null;
  sources_complete: string[];
};

type Bucket = { completed: number; within: number };

function bucketKey(driverId: string, day: string): string {
  return `${driverId}|${day}`;
}

async function loadSlaOverrides(): Promise<Map<string, number>> {
  const snap = await getFirestore().collection(DELIVERY_SLA_OVERRIDES).get();
  const out = new Map<string, number>();
  for (const doc of snap.docs) {
    const scopeType = asString(doc.get("scope_type"));
    const scopeId = asString(doc.get("scope_id"));
    const minutes = numberOf(doc.get("minutes"));
    if (scopeType && scopeId && minutes !== null) out.set(`${scopeType}|${scopeId}`, minutes);
  }
  return out;
}

/** Zone beats partner beats the global setting, then 45 — as the SQL resolved it. */
function resolveSlaMinutes(
  zoneId: string | null,
  partnerId: string | null,
  overrides: Map<string, number>,
  settings: AppSettings,
): number {
  if (zoneId) {
    const zone = overrides.get(`zone|${zoneId}`);
    if (zone !== undefined) return zone;
  }
  if (partnerId) {
    const partner = overrides.get(`partner|${partnerId}`);
    if (partner !== undefined) return partner;
  }
  return settings.delivery_ontime_minutes ?? DEFAULT_SLA_MINUTES;
}

async function loadOpenSessions(): Promise<Map<string, Date>> {
  const snap = await getFirestore()
    .collection(COLLECTIONS.driverSessions)
    .where("is_online", "==", true)
    .get();
  const out = new Map<string, Date>();
  for (const doc of snap.docs) {
    const driverId = asString(doc.get("driver_id"));
    const wentOnline = asDate(doc.get("went_online_at"));
    if (driverId && wentOnline) out.set(driverId, wentOnline);
  }
  return out;
}

async function performanceDailySource(
  from: string,
  to: string,
  driverId: string | null,
  settings: AppSettings,
): Promise<DailySourceRow[]> {
  const db = getFirestore();
  const fromTs = kuwaitDayStart(from);
  const toTs = kuwaitDayEnd(to);

  let attendanceQuery = db
    .collection(COLLECTIONS.attendanceLogs)
    .where("log_date", ">=", from)
    .where("log_date", "<=", to);
  if (driverId) attendanceQuery = attendanceQuery.where("driver_id", "==", driverId);

  let deliveryQuery = db
    .collection(COLLECTIONS.deliveries)
    .where("delivered_at", ">=", fromTs)
    .where("delivered_at", "<", toTs);
  if (driverId) deliveryQuery = deliveryQuery.where("driver_id", "==", driverId);

  let wrongQuery = db
    .collection(COLLECTIONS.wrongActions)
    .where("occurred_at", ">=", fromTs)
    .where("occurred_at", "<", toTs);
  if (driverId) wrongQuery = wrongQuery.where("driver_id", "==", driverId);

  // Fleet-wide on purpose: if nobody produced an event that day the source is
  // marked unavailable, because a quiet fleet and a pruned one look the same.
  const fleetQuery = db
    .collection(COLLECTIONS.fleetEvents)
    .where("detected_at", ">=", fromTs)
    .where("detected_at", "<", toTs);

  const [attendanceSnap, deliverySnap, wrongSnap, fleetSnap, overrides, openSessions] =
    await Promise.all([
      attendanceQuery.limit(SCAN_CAP + 1).get(),
      deliveryQuery.limit(SCAN_CAP + 1).get(),
      wrongQuery.limit(SCAN_CAP + 1).get(),
      fleetQuery.limit(SCAN_CAP + 1).get(),
      loadSlaOverrides(),
      loadOpenSessions(),
    ]);

  for (const snap of [attendanceSnap, deliverySnap, wrongSnap, fleetSnap]) {
    if (snap.size > SCAN_CAP) throw new HttpsError("failed-precondition", "range_too_large");
  }

  const today = kuwaitDayString(new Date());

  const deliveries = new Map<string, Bucket>();
  for (const doc of deliverySnap.docs) {
    const raw = doc.data();
    const status = asString(raw["status"]);
    const deliveredAt = asDate(raw["delivered_at"]);
    const pickupAt = asDate(raw["pickup_at"]);
    const rowDriverId = asString(raw["driver_id"]);
    if (!deliveredAt || !pickupAt || !rowDriverId) continue;
    if (status && EXCLUDED_DELIVERY_STATUSES.has(status)) continue;

    const minutes = resolveSlaMinutes(
      asString(raw["zone_id"]),
      asString(raw["partner_id"]),
      overrides,
      settings,
    );
    const key = bucketKey(rowDriverId, kuwaitDayString(deliveredAt));
    const bucket = deliveries.get(key) ?? { completed: 0, within: 0 };
    bucket.completed += 1;
    if (deliveredAt.getTime() - pickupAt.getTime() <= minutes * 60_000) bucket.within += 1;
    deliveries.set(key, bucket);
  }

  const fleetDays = new Set<string>();
  const overspeed = new Map<string, number>();
  const paired = new Map<string, Array<{ key: string; at: Date }>>();
  for (const doc of fleetSnap.docs) {
    const raw = doc.data();
    const detectedAt = asDate(raw["detected_at"]);
    const eventKey = asString(raw["event_key"]);
    const rowDriverId = asString(raw["driver_id"]);
    if (!detectedAt || !eventKey || !rowDriverId) continue;

    const day = kuwaitDayString(detectedAt);
    fleetDays.add(day);
    if (driverId && rowDriverId !== driverId) continue;

    if (eventKey === "overspeed.start") {
      const key = bucketKey(rowDriverId, day);
      overspeed.set(key, (overspeed.get(key) ?? 0) + 1);
    }

    if (PAIRED_EVENT_KEYS.has(eventKey)) {
      const category = ZONE_EVENT_KEYS.has(eventKey)
        ? "zone"
        : RANGE_EVENT_KEYS.has(eventKey)
          ? "range"
          : "gps";
      const key = `${rowDriverId}|${day}|${category}`;
      const list = paired.get(key) ?? [];
      list.push({ key: eventKey, at: detectedAt });
      paired.set(key, list);
    }
  }

  const outside = new Map<string, number>();
  const gpsOffline = new Map<string, number>();
  for (const [groupKey, events] of paired) {
    const [rowDriverId, day, category] = groupKey.split("|");
    const nextDayMidnight = kuwaitDayEnd(day).getTime();
    const ordered = [...events].sort((a, b) => a.at.getTime() - b.at.getTime());
    for (let index = 0; index < ordered.length; index += 1) {
      const event = ordered[index];
      if (!OPEN_EVENT_KEYS.has(event.key)) continue;
      const nextAt = ordered[index + 1]?.at.getTime() ?? nextDayMidnight;
      const closeAt = Math.min(nextAt, nextDayMidnight);
      const minutes = Math.max(0, (closeAt - event.at.getTime()) / 60_000);
      const key = bucketKey(rowDriverId, day);
      if (category === "gps") {
        gpsOffline.set(key, (gpsOffline.get(key) ?? 0) + minutes);
      } else {
        outside.set(key, (outside.get(key) ?? 0) + minutes);
      }
    }
  }

  const conduct = new Map<string, number>();
  for (const doc of wrongSnap.docs) {
    const raw = doc.data();
    const occurredAt = asDate(raw["occurred_at"]);
    const rowDriverId = asString(raw["driver_id"]);
    if (!occurredAt || !rowDriverId) continue;
    const severity = asString(raw["severity"]);
    const weight = severity === "high" ? 3 : severity === "medium" ? 2 : 1;
    const key = bucketKey(rowDriverId, kuwaitDayString(occurredAt));
    conduct.set(key, (conduct.get(key) ?? 0) + weight);
  }

  const rows: DailySourceRow[] = [];
  for (const doc of attendanceSnap.docs) {
    const raw = doc.data();
    const rowDriverId = asString(raw["driver_id"]) ?? doc.id;
    const logDate = asString(raw["log_date"]) ?? today;

    const checkIn = asDate(raw["check_in_at"]);
    const checkOut = asDate(raw["check_out_at"]);
    const scheduledStart = asDate(raw["scheduled_start_at"]);
    const scheduledEnd = asDate(raw["scheduled_end_at"]);
    const storedStatus = asString(raw["status"]);

    const onLeave = storedStatus === "on_leave";
    const worked = checkIn !== null && !onLeave;
    const absent = !onLeave && checkIn === null;

    const minutesLate =
      checkIn && scheduledStart
        ? Math.max(
            0,
            Math.floor((checkIn.getTime() - scheduledStart.getTime()) / 60_000) -
              settings.attendance_late_grace_minutes,
          )
        : 0;

    const minutesEarlyOut =
      checkOut && scheduledEnd && scheduledStart
        ? Math.min(
            Math.max(
              0,
              Math.floor(
                (scheduledEnd.getTime() - Math.max(checkOut.getTime(), scheduledStart.getTime())) /
                  60_000,
              ) - settings.attendance_early_out_grace_minutes,
            ),
            Math.max(0, Math.floor((scheduledEnd.getTime() - scheduledStart.getTime()) / 60_000)),
          )
        : 0;

    const lostMinutes =
      checkIn && scheduledStart ? minutesLate + minutesEarlyOut : null;
    const scheduledMinutes =
      scheduledStart && scheduledEnd
        ? Math.max((scheduledEnd.getTime() - scheduledStart.getTime()) / 60_000, 0)
        : null;

    const openSessionAt = openSessions.get(rowDriverId);
    const sessionLiveSeconds = openSessionAt
      ? Math.max(0, Math.round((Date.now() - openSessionAt.getTime()) / 1000))
      : 0;
    const rawOnline = numberOf(raw["online_seconds"]) ?? 0;
    const onlineSeconds = checkIn ? rawOnline + sessionLiveSeconds : null;

    const isOnDuty =
      raw["is_on_duty"] === true && checkIn !== null && checkOut === null && logDate === today;
    const dutySecondsRaw = checkOut
      ? Math.max(0, Math.round((checkOut.getTime() - (checkIn?.getTime() ?? 0)) / 1000))
      : isOnDuty
        ? Math.max(0, Math.round((Date.now() - (checkIn?.getTime() ?? 0)) / 1000))
        : 0;
    const dutySeconds = checkIn && dutySecondsRaw > 0 ? dutySecondsRaw : null;

    const key = bucketKey(rowDriverId, logDate);
    const delivery = deliveries.get(key) ?? null;
    const hasFleetDay = fleetDays.has(logDate);

    const sources = ["attendance", "wrong_actions"];
    if (delivery) sources.push("deliveries");
    if (hasFleetDay) sources.push("fleet_events");

    rows.push({
      driver_id: rowDriverId,
      log_date: logDate,
      worked,
      on_leave: onLeave,
      absent,
      lost_minutes: lostMinutes,
      scheduled_minutes: scheduledMinutes,
      online_seconds: onlineSeconds,
      duty_seconds: dutySeconds,
      out_of_zone_minutes: hasFleetDay ? (outside.get(key) ?? 0) : null,
      gps_offline_minutes: hasFleetDay ? (gpsOffline.get(key) ?? 0) : null,
      deliveries_completed: delivery ? delivery.completed : null,
      deliveries_within_sla: delivery ? delivery.within : null,
      overspeed_events: hasFleetDay ? (overspeed.get(key) ?? 0) : null,
      conduct_weighted: conduct.get(key) ?? 0,
      sources_complete: sources,
    });
  }

  rows.sort(
    (a, b) => a.log_date.localeCompare(b.log_date) || a.driver_id.localeCompare(b.driver_id),
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

type ComponentRow = {
  key: string;
  label_en: string;
  label_ar: string;
  weight: number;
  sort_order: number;
  is_active: boolean;
};

async function loadComponents(): Promise<ComponentRow[]> {
  const snap = await getFirestore().collection(COLLECTIONS.performanceScoreComponents).get();
  return snap.docs
    .map((doc) => {
      const raw = doc.data();
      return {
        key: asString(raw["key"]) ?? doc.id,
        label_en: asString(raw["label_en"]) ?? "",
        label_ar: asString(raw["label_ar"]) ?? "",
        weight: numberOf(raw["weight"]) ?? 0,
        sort_order: numberOf(raw["sort_order"]) ?? 0,
        is_active: raw["is_active"] === true,
      };
    })
    .sort((a, b) => a.sort_order - b.sort_order || a.key.localeCompare(b.key));
}

type Scored = {
  compliance_score: number | null;
  component_scores: Record<string, number>;
};

function scoreDaily(
  row: DailySourceRow,
  weights: Map<string, number>,
  speedAllowance: number,
  conductAllowance: number,
): Scored {
  const worked = row.worked;
  const duty = row.duty_seconds ?? 0;
  const scheduled = row.scheduled_minutes ?? 0;

  const punctuality =
    worked && scheduled > 0 && row.lost_minutes !== null
      ? clamp01(1 - row.lost_minutes / scheduled)
      : null;
  const dutyRatio =
    worked && duty > 0 && row.online_seconds !== null ? clamp01(row.online_seconds / duty) : null;
  const zone =
    worked && duty > 0 && row.out_of_zone_minutes !== null
      ? clamp01(1 - row.out_of_zone_minutes / (duty / 60))
      : null;
  const gps =
    worked && duty > 0 && row.gps_offline_minutes !== null
      ? clamp01(1 - row.gps_offline_minutes / (duty / 60))
      : null;
  const onTime =
    (row.deliveries_completed ?? 0) > 0
      ? (row.deliveries_within_sla ?? 0) / (row.deliveries_completed ?? 1)
      : null;
  const speed =
    worked && row.overspeed_events !== null && speedAllowance > 0
      ? clamp01(1 - row.overspeed_events / speedAllowance)
      : null;
  const conductScore =
    worked && row.conduct_weighted !== null && conductAllowance > 0
      ? clamp01(1 - row.conduct_weighted / conductAllowance)
      : null;

  const scores: Record<(typeof COMPONENT_KEYS)[number], number | null> = {
    punctuality,
    duty_ratio: dutyRatio,
    on_time: onTime,
    speed,
    zone,
    gps,
    conduct: conductScore,
  };

  // An unmeasured component is dropped with its weight, never scored 0.
  let numerator = 0;
  let denominator = 0;
  for (const key of COMPONENT_KEYS) {
    const score = scores[key];
    if (score === null) continue;
    const weight = weights.get(key) ?? 0;
    numerator += weight * score;
    denominator += weight;
  }

  const componentScores: Record<string, number> = {};
  for (const key of COMPONENT_KEYS) {
    const rounded = round4(scores[key]);
    if (rounded !== null) componentScores[key] = rounded;
  }

  return {
    compliance_score: denominator > 0 ? round1((100 * numerator) / denominator) : null,
    component_scores: componentScores,
  };
}

async function insertDailyRows(rows: DailySourceRow[]): Promise<number> {
  const db = getFirestore();
  let written = 0;
  for (let index = 0; index < rows.length; index += WRITE_CHUNK) {
    const batch = db.batch();
    for (const row of rows.slice(index, index + WRITE_CHUNK)) {
      const ref = db
        .collection(COLLECTIONS.driverPerformanceDaily)
        .doc(`${row.driver_id}_${row.log_date}`);
      batch.set(ref, {
        driver_id: row.driver_id,
        log_date: row.log_date,
        worked: row.worked,
        on_leave: row.on_leave,
        absent: row.absent,
        lost_minutes: row.lost_minutes,
        scheduled_minutes: row.scheduled_minutes,
        online_seconds: row.online_seconds,
        duty_seconds: row.duty_seconds,
        out_of_zone_minutes: row.out_of_zone_minutes,
        gps_offline_minutes: row.gps_offline_minutes,
        deliveries_completed: row.deliveries_completed,
        deliveries_within_sla: row.deliveries_within_sla,
        overspeed_events: row.overspeed_events,
        conduct_weighted: row.conduct_weighted,
        sources_complete: row.sources_complete,
        computed_at: Timestamp.fromDate(new Date()),
      });
    }
    await batch.commit();
    written += rows.slice(index, index + WRITE_CHUNK).length;
  }
  return written;
}

/** `admin_rebuild_driver_performance_daily`: an idempotent rewrite, never a score. */
async function rebuildDriverPerformanceDaily(
  from: string,
  to: string,
  driverId: string | null,
  settings: AppSettings,
): Promise<number> {
  if (dayDiff(from, to) > MAX_ROLLUP_DAYS) {
    throw new HttpsError("failed-precondition", "range_too_large");
  }
  const rows = await performanceDailySource(from, to, driverId, settings);
  return insertDailyRows(rows);
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

async function componentsSnapshot(): Promise<Json> {
  const db = getFirestore();
  const [componentsSnap, settingsSnap] = await Promise.all([
    db.collection(COLLECTIONS.performanceScoreComponents).get(),
    db.collection(COLLECTIONS.appSettings).doc(APP_SETTINGS_DOC_ID).get(),
  ]);

  const components: Json = {};
  for (const doc of componentsSnap.docs) {
    const raw = doc.data();
    const key = asString(raw["key"]) ?? doc.id;
    components[key] = {
      weight: numberOf(raw["weight"]) ?? 0,
      is_active: raw["is_active"] === true,
    };
  }

  const settings: Json = settingsSnap.exists
    ? {
        delivery_ontime_minutes: numberOf(settingsSnap.get("delivery_ontime_minutes")),
        speed_allowance_per_day: numberOf(settingsSnap.get("performance_speed_allowance_per_day")),
        conduct_allowance_per_day: numberOf(
          settingsSnap.get("performance_conduct_allowance_per_day"),
        ),
      }
    : {};

  return { components, settings };
}

export const adminListPerformanceComponents = onCall(async (request) => {
  await requireStaff(request, "performance.view");

  const db = getFirestore();
  const [components, settingsSnap] = await Promise.all([
    loadComponents(),
    db.collection(COLLECTIONS.appSettings).doc(APP_SETTINGS_DOC_ID).get(),
  ]);

  const settings: Json = settingsSnap.exists
    ? {
        delivery_ontime_minutes:
          numberOf(settingsSnap.get("delivery_ontime_minutes")) ?? DEFAULT_SLA_MINUTES,
        speed_allowance_per_day:
          numberOf(settingsSnap.get("performance_speed_allowance_per_day")) ??
          DEFAULT_SPEED_ALLOWANCE,
        conduct_allowance_per_day:
          numberOf(settingsSnap.get("performance_conduct_allowance_per_day")) ??
          DEFAULT_CONDUCT_ALLOWANCE,
      }
    : {};

  return {
    components: components.map((row) => ({
      key: row.key,
      label_en: row.label_en,
      label_ar: row.label_ar,
      weight: row.weight,
      sort_order: row.sort_order,
      is_active: row.is_active,
    })),
    settings,
  };
});

export const adminUpdatePerformanceComponents = onCall(async (request) => {
  await requireEither(request, ["settings.manage", "attendance.manage"]);

  const db = getFirestore();
  const data: Json = isRecord(request.data) ? request.data : {};
  const before = await componentsSnapshot();

  const items = Array.isArray(data.components) ? (data.components as unknown[]) : null;
  if (items) {
    const known = new Set((await loadComponents()).map((row) => row.key));
    for (const item of items) {
      if (!isRecord(item)) continue;
      const key = asString(item.key);
      if (!key || !known.has(key)) throw new HttpsError("invalid-argument", "unknown_component");

      const rawWeight = item.weight;
      let weight: number | null = null;
      if (rawWeight !== undefined && rawWeight !== null) {
        const parsed = numberOf(rawWeight);
        if (parsed === null || parsed < 0) {
          throw new HttpsError("invalid-argument", "invalid_weight");
        }
        weight = parsed;
      }

      let isActive: boolean | null = null;
      const rawActive = item.is_active;
      if (typeof rawActive === "boolean") isActive = rawActive;
      else if (rawActive === "true" || rawActive === "false") isActive = rawActive === "true";

      const patch: Json = { updated_at: Timestamp.fromDate(new Date()) };
      if (weight !== null) patch.weight = weight;
      if (isActive !== null) patch.is_active = isActive;

      const snap = await db
        .collection(COLLECTIONS.performanceScoreComponents)
        .where("key", "==", key)
        .limit(1)
        .get();
      const ref = snap.docs[0]?.ref ?? db.collection(COLLECTIONS.performanceScoreComponents).doc(key);
      await ref.set(patch, { merge: true });
    }
  }

  const settingsIn = data.settings;
  if (settingsIn !== undefined && settingsIn !== null) {
    if (!isRecord(settingsIn)) {
      throw new HttpsError("invalid-argument", "invalid_sla_minutes");
    }
    const settingsRef = db.collection(COLLECTIONS.appSettings).doc(APP_SETTINGS_DOC_ID);
    const currentSnap = await settingsRef.get();
    const current = currentSnap.data() ?? {};

    let sla: number | null = null;
    const rawSla = settingsIn.delivery_ontime_minutes;
    if (rawSla !== undefined && rawSla !== null) {
      if (typeof rawSla !== "number" || !Number.isInteger(rawSla) || rawSla <= 0) {
        throw new HttpsError("invalid-argument", "invalid_sla_minutes");
      }
      sla = rawSla;
    }

    const speedProvided = numberOf(settingsIn.speed_allowance_per_day);
    const conductProvided = numberOf(settingsIn.conduct_allowance_per_day);
    const speedExisting = numberOf(current["performance_speed_allowance_per_day"]);
    const conductExisting = numberOf(current["performance_conduct_allowance_per_day"]);

    const patch: Json = {
      performance_speed_allowance_per_day: Math.max(speedProvided ?? speedExisting ?? 0, 0),
      performance_conduct_allowance_per_day: Math.max(conductProvided ?? conductExisting ?? 0, 0),
    };
    if (sla !== null) patch.delivery_ontime_minutes = sla;

    await settingsRef.set(patch, { merge: true });
  }

  const after = await componentsSnapshot();
  return { before, after };
});

// ---------------------------------------------------------------------------
// Rating teams
// ---------------------------------------------------------------------------

async function loadProfiles(ids: string[]): Promise<Map<string, Json>> {
  const db = getFirestore();
  const unique = [...new Set(ids.filter((id) => id.length > 0))];
  const out = new Map<string, Json>();
  for (let index = 0; index < unique.length; index += GET_ALL_CHUNK) {
    const chunk = unique.slice(index, index + GET_ALL_CHUNK);
    const snaps = await db.getAll(
      ...chunk.map((id) => db.collection(COLLECTIONS.profiles).doc(id)),
    );
    for (const snap of snaps) out.set(snap.id, (snap.data() ?? {}) as Json);
  }
  return out;
}

export const adminListPerformanceRatingTeams = onCall(async (request) => {
  await requireStaff(request, "performance.view");

  const db = getFirestore();
  const [teamsSnap, criteriaSnap, membersSnap] = await Promise.all([
    db.collection(PERFORMANCE_RATING_TEAMS).get(),
    db.collection(COLLECTIONS.performanceRatingCriteria).get(),
    db.collection(COLLECTIONS.performanceRatingTeamMembers).get(),
  ]);

  const memberRows = membersSnap.docs.map((doc) => ({
    teamKey: asString(doc.get("team_key")) ?? "",
    profileId: asString(doc.get("profile_id")) ?? "",
  }));
  const profiles = await loadProfiles(memberRows.map((row) => row.profileId));

  const criteria = criteriaSnap.docs.map((doc) => {
    const raw = doc.data();
    return {
      id: doc.id,
      team_key: asString(raw["team_key"]) ?? "",
      key: asString(raw["key"]) ?? "",
      label_en: asString(raw["label_en"]) ?? "",
      label_ar: asString(raw["label_ar"]) ?? "",
      weight: numberOf(raw["weight"]) ?? 0,
      sort_order: numberOf(raw["sort_order"]) ?? 0,
      is_active: raw["is_active"] === true,
    };
  });

  const counts = await Promise.all(
    criteria.map(async (row) => {
      const snap = await db
        .collection(COLLECTIONS.driverPerformanceRatings)
        .where("criterion_id", "==", row.id)
        .count()
        .get();
      return snap.data().count;
    }),
  );
  const ratingCount = new Map<string, number>();
  criteria.forEach((row, index) => ratingCount.set(row.id, counts[index]));

  const teams = teamsSnap.docs
    .map((doc) => {
      const raw = doc.data();
      const key = asString(raw["key"]) ?? doc.id;
      const members = memberRows
        .filter((row) => row.teamKey === key)
        .map((row) => ({
          profile_id: row.profileId,
          full_name: asString(profiles.get(row.profileId)?.["full_name"]) ?? "—",
          email: asString(profiles.get(row.profileId)?.["email"]),
        }))
        .sort((a, b) => a.full_name.localeCompare(b.full_name));
      const teamCriteria = criteria
        .filter((row) => row.team_key === key)
        .sort((a, b) => a.sort_order - b.sort_order || a.key.localeCompare(b.key))
        .map((row) => ({
          id: row.id,
          team_key: row.team_key,
          key: row.key,
          label_en: row.label_en,
          label_ar: row.label_ar,
          weight: row.weight,
          sort_order: row.sort_order,
          is_active: row.is_active,
          rating_count: ratingCount.get(row.id) ?? 0,
        }));
      return {
        key,
        label_en: asString(raw["label_en"]) ?? "",
        label_ar: asString(raw["label_ar"]) ?? "",
        weight: numberOf(raw["weight"]) ?? 0,
        sort_order: numberOf(raw["sort_order"]) ?? 0,
        is_active: raw["is_active"] === true,
        members,
        criteria: teamCriteria,
      };
    })
    .sort((a, b) => a.sort_order - b.sort_order || a.key.localeCompare(b.key));

  return { teams };
});

export const adminDeleteDriverPerformanceRating = onCall(async (request) => {
  const staff = await requireStaff(request, "performance.rate");

  const db = getFirestore();
  const data: Json = isRecord(request.data) ? request.data : {};
  const driverId = parseId(pick(data, "driverId", "p_driver_id"));
  const criterionId = parseId(pick(data, "criterionId", "p_criterion_id"));

  if (!criterionId) throw new HttpsError("not-found", "unknown_criterion");

  const criterionSnap = await db
    .collection(COLLECTIONS.performanceRatingCriteria)
    .doc(criterionId)
    .get();
  const teamKey = criterionSnap.exists ? asString(criterionSnap.get("team_key")) : null;
  if (!teamKey) throw new HttpsError("not-found", "unknown_criterion");

  if (!staff.isSuperAdmin) {
    const memberships = await db
      .collection(COLLECTIONS.performanceRatingTeamMembers)
      .where("team_key", "==", teamKey)
      .where("profile_id", "==", staff.uid)
      .limit(1)
      .get();
    if (memberships.empty) throw new HttpsError("permission-denied", "not_team_member");
  }

  const month = monthFirstDay(pick(data, "periodMonth", "p_period_month")) ?? currentKuwaitMonth();
  if (!driverId) return { deleted: 0 };

  const snap = await db
    .collection(COLLECTIONS.driverPerformanceRatings)
    .where("driver_id", "==", driverId)
    .where("criterion_id", "==", criterionId)
    .where("period_month", "==", month)
    .get();

  if (!snap.empty) {
    const batch = db.batch();
    for (const doc of snap.docs) batch.delete(doc.ref);
    await batch.commit();
  }

  return { deleted: snap.size };
});

// ---------------------------------------------------------------------------
// Daily rollup and the per-driver day view
// ---------------------------------------------------------------------------

export const adminRunPerformanceDailyRollup = onCall(async (request) => {
  await requireStaff(request);

  const data: Json = isRecord(request.data) ? request.data : {};
  const rawLookback = numberOf(pick(data, "lookbackDays", "p_lookback_days"));
  const lookback = Math.max(Math.trunc(rawLookback ?? 7) || 7, 1);

  const today = kuwaitDayString(new Date());
  const from = addDays(today, -lookback);
  const settings = await loadAppSettings();
  const rows = await rebuildDriverPerformanceDaily(from, today, null, settings);

  return { from, to: today, rows };
});

export const adminDriverPerformanceDaily = onCall(async (request) => {
  await requireStaff(request);

  const db = getFirestore();
  const data: Json = isRecord(request.data) ? request.data : {};
  const driverId = parseId(pick(data, "driverId", "p_driver_id"));
  const from = dayKey(pick(data, "from", "p_from"));
  const to = dayKey(pick(data, "to", "p_to"));

  if (!driverId) throw new HttpsError("invalid-argument", "driver_required");
  if (!from || !to || to < from) {
    throw new HttpsError("invalid-argument", "invalid_date_range");
  }
  if (dayDiff(from, to) > MAX_DAY_VIEW_DAYS) {
    throw new HttpsError("failed-precondition", "range_too_large");
  }

  const today = kuwaitDayString(new Date());
  const settings = await loadAppSettings();
  const settingsSnap = await db
    .collection(COLLECTIONS.appSettings)
    .doc(APP_SETTINGS_DOC_ID)
    .get();
  const speedAllowance =
    numberOf(settingsSnap.get("performance_speed_allowance_per_day")) ?? DEFAULT_SPEED_ALLOWANCE;
  const conductAllowance =
    numberOf(settingsSnap.get("performance_conduct_allowance_per_day")) ??
    DEFAULT_CONDUCT_ALLOWANCE;

  const components = await loadComponents();
  const activeComponents = components.filter((row) => row.is_active && row.weight > 0);
  const weights = new Map<string, number>();
  for (const row of components) {
    if (row.is_active) weights.set(row.key, row.weight);
  }

  const storedTo = to < addDays(today, -1) ? to : addDays(today, -1);
  const storedSnap = await db
    .collection(COLLECTIONS.driverPerformanceDaily)
    .where("driver_id", "==", driverId)
    .where("log_date", ">=", from)
    .where("log_date", "<=", storedTo)
    .limit(SCAN_CAP + 1)
    .get();
  if (storedSnap.size > SCAN_CAP) {
    throw new HttpsError("failed-precondition", "range_too_large");
  }

  const rows: DailySourceRow[] = storedSnap.docs.map((doc) => {
    const raw = doc.data();
    return {
      driver_id: asString(raw["driver_id"]) ?? driverId,
      log_date: asString(raw["log_date"]) ?? doc.id,
      worked: raw["worked"] === true,
      on_leave: raw["on_leave"] === true,
      absent: raw["absent"] === true,
      lost_minutes: numberOf(raw["lost_minutes"]),
      scheduled_minutes: numberOf(raw["scheduled_minutes"]),
      online_seconds: numberOf(raw["online_seconds"]),
      duty_seconds: numberOf(raw["duty_seconds"]),
      out_of_zone_minutes: numberOf(raw["out_of_zone_minutes"]),
      gps_offline_minutes: numberOf(raw["gps_offline_minutes"]),
      deliveries_completed: numberOf(raw["deliveries_completed"]),
      deliveries_within_sla: numberOf(raw["deliveries_within_sla"]),
      overspeed_events: numberOf(raw["overspeed_events"]),
      conduct_weighted: numberOf(raw["conduct_weighted"]) ?? 0,
      sources_complete: Array.isArray(raw["sources_complete"])
        ? (raw["sources_complete"] as unknown[]).filter(
            (item): item is string => typeof item === "string",
          )
        : [],
    };
  });

  const liveFrom = from > today ? from : today;
  const liveRows = await performanceDailySource(liveFrom, to, driverId, settings);
  for (const row of liveRows) rows.push({ ...row, conduct_weighted: null });

  const out = rows
    .map((row) => {
      const scored = scoreDaily(row, weights, speedAllowance, conductAllowance);
      return {
        log_date: row.log_date,
        worked: row.worked,
        on_leave: row.on_leave,
        absent: row.absent,
        compliance_score: scored.compliance_score,
        component_scores: scored.component_scores,
        deliveries_completed: row.deliveries_completed,
        deliveries_within_sla: row.deliveries_within_sla,
        overspeed_events: row.overspeed_events,
        sources_complete: row.sources_complete,
      };
    })
    .sort((a, b) => b.log_date.localeCompare(a.log_date));

  return {
    rows: out,
    components: activeComponents.map((row) => ({
      key: row.key,
      label_en: row.label_en,
      label_ar: row.label_ar,
      weight: row.weight,
    })),
    from,
    to,
  };
});

// admin_upsert_performance_target_dpd is exported from ./ops (owned there), so a
// second export of the same name from this module would make index.ts ambiguous.

