/**
 * `admin_list_driver_performance` and `admin_performance_trend`.
 *
 * Both read the same per-driver-day source as the rollup: closed days from
 * `driver_performance_daily`, today recomputed live, so a closed day and the
 * live one can never be scored by different rules.
 */
import { createHash } from "crypto";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { getFirestore, Timestamp, type Query } from "firebase-admin/firestore";
import { COLLECTIONS, FIELDS } from "../core/collections";
import { kuwaitDayEnd, kuwaitDayStart, kuwaitDayString } from "../core/kuwait";
import { loadAppSettings, type AppSettings } from "../core/settings";
import { requireStaff } from "../core/staff";
import {
  compareRulesForLoop,
  deliveryMatchesRules,
  ruleAppliesOnDate,
  type IncentiveRule,
} from "../core/incentive";
import { loadIncentiveContext, normaliseDelivery, type IncentiveContext } from "../core/incentive-store";
import { loadDocMap, pick, pickDay, pickId, pickText, type Dict } from "./_shared";

const PERFORMANCE_RATING_TEAMS = "performance_rating_teams";
const DELIVERY_SLA_OVERRIDES = "delivery_sla_overrides";
const EXCEPTION_ACTIONS = "attendance_exception_actions";
const APP_SETTINGS_DOC_ID = "1";
const DAY_MS = 24 * 60 * 60 * 1000;
const GET_ALL_CHUNK = 300;

/** Fleet-wide reads for a 400-day window stay under this; it only fires on a runaway read. */
const WIDE_SCAN_CAP = 60_000;
const MAX_LIMIT = 2000;
const MAX_TREND_DAYS = 400;

const DEFAULT_SLA_MINUTES = 45;
const DEFAULT_SPEED_ALLOWANCE = 2;
const DEFAULT_CONDUCT_ALLOWANCE = 0.25;
const DEFAULT_WEIGHTS: Dict = {
  delivery: 1,
  utilization: 1,
  compliance: 1,
  manual: 0,
  exception_penalty: 5,
};

const EXCLUDED_DELIVERY_STATUSES = new Set(["cancelled", "rejected", "in_transit"]);
const PENALISED_EXCEPTIONS = new Set(["NoCheckIn", "NoAssignedShift", "OfflineDuringShift"]);

const COMPONENT_KEYS = [
  "punctuality",
  "duty_ratio",
  "on_time",
  "speed",
  "zone",
  "gps",
  "conduct",
] as const;
type ComponentKey = (typeof COMPONENT_KEYS)[number];
type ComponentScores = Record<ComponentKey, number | null>;

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

const SORTS = new Set([
  "overall_desc",
  "overall_asc",
  "delivery_desc",
  "delivery_asc",
  "utilization_desc",
  "utilization_asc",
  "compliance_desc",
  "compliance_asc",
  "manual_desc",
  "manual_asc",
  "name_asc",
  "name_desc",
]);

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

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

function isRecord(value: unknown): value is Dict {
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

function dayString(value: unknown): string | null {
  if (typeof value === "string") {
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
    if (match) return match[1];
  }
  const date = asDate(value);
  return date ? kuwaitDayString(date) : null;
}

function addDays(day: string, delta: number): string {
  return kuwaitDayString(kuwaitDayStart(day).getTime() + delta * DAY_MS);
}

function dayDiff(from: string, to: string): number {
  return Math.round((kuwaitDayStart(to).getTime() - kuwaitDayStart(from).getTime()) / DAY_MS);
}

function minDay(a: string, b: string): string {
  return a < b ? a : b;
}

function maxDay(a: string, b: string): string {
  return a > b ? a : b;
}

function monthStart(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

/** Half away from zero, the way Postgres rounds a numeric. */
function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  const scaled = Math.abs(value) * factor;
  return (Math.sign(value) * Math.round(scaled + 1e-9)) / factor;
}

function roundOrNull(value: number | null, digits: number): number | null {
  return value === null ? null : roundTo(value, digits);
}

function average(values: ReadonlyArray<number | null>): number | null {
  let sum = 0;
  let count = 0;
  for (const value of values) {
    if (value === null) continue;
    sum += value;
    count += 1;
  }
  return count ? sum / count : null;
}

function sumOrNull(values: ReadonlyArray<number | null>): number | null {
  let sum = 0;
  let seen = false;
  for (const value of values) {
    if (value === null) continue;
    sum += value;
    seen = true;
  }
  return seen ? sum : null;
}

/** `ORDER BY x DESC|ASC NULLS LAST`. */
function compareNullable(a: number | null, b: number | null, direction: 1 | -1): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return direction * (a - b);
}

function chunkOf<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size));
  return out;
}

async function scanCapped(query: Query) {
  const snap = await query.limit(WIDE_SCAN_CAP + 1).get();
  if (snap.size > WIDE_SCAN_CAP) throw new HttpsError("failed-precondition", "range_too_large");
  return snap.docs;
}

// ---------------------------------------------------------------------------
// Settings, components and the rating catalogue
// ---------------------------------------------------------------------------

type PerformanceSettings = {
  weightsRaw: Dict;
  delivery: number;
  utilization: number;
  compliance: number;
  manual: number;
  exceptionPenalty: number;
  speedAllowance: number;
  conductAllowance: number;
  slaMinutes: number;
};

async function loadPerformanceSettings(): Promise<PerformanceSettings> {
  const snap = await getFirestore().collection(COLLECTIONS.appSettings).doc(APP_SETTINGS_DOC_ID).get();
  const raw = (snap.data() ?? {}) as Dict;
  const weightsRaw = isRecord(raw["performance_score_weights"])
    ? raw["performance_score_weights"]
    : DEFAULT_WEIGHTS;

  const weight = (key: string, fallback: number) => Math.max(numberOf(weightsRaw[key]) ?? fallback, 0);
  let delivery = weight("delivery", 1);
  let utilization = weight("utilization", 1);
  let compliance = weight("compliance", 1);
  if (delivery + utilization + compliance === 0) {
    delivery = 1;
    utilization = 1;
    compliance = 1;
  }

  return {
    weightsRaw,
    delivery,
    utilization,
    compliance,
    manual: weight("manual", 0),
    exceptionPenalty: weight("exception_penalty", 5),
    speedAllowance: numberOf(raw["performance_speed_allowance_per_day"]) ?? DEFAULT_SPEED_ALLOWANCE,
    conductAllowance:
      numberOf(raw["performance_conduct_allowance_per_day"]) ?? DEFAULT_CONDUCT_ALLOWANCE,
    slaMinutes: numberOf(raw["delivery_ontime_minutes"]) ?? DEFAULT_SLA_MINUTES,
  };
}

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

/** An inactive component carries weight 0, which is the same as being absent from the blend. */
function componentWeights(components: readonly ComponentRow[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const component of components) {
    if (component.is_active) out.set(component.key, component.weight);
  }
  return out;
}

function componentsPayload(components: readonly ComponentRow[]) {
  return components
    .filter((component) => component.is_active && component.weight > 0)
    .map((component) => ({
      key: component.key,
      label_en: component.label_en,
      label_ar: component.label_ar,
      weight: component.weight,
    }));
}

/** Null when nothing was measured: absent is not the same as scored 0. */
function blend(scores: ComponentScores, weights: Map<string, number>): { num: number; den: number } {
  let num = 0;
  let den = 0;
  for (const key of COMPONENT_KEYS) {
    const score = scores[key];
    if (score === null) continue;
    const weight = weights.get(key) ?? 0;
    num += weight * score;
    den += weight;
  }
  return { num, den };
}

function componentJson(scores: ComponentScores): Dict {
  const out: Dict = {};
  for (const key of COMPONENT_KEYS) {
    const value = scores[key];
    if (value !== null) out[key] = roundTo(value, 4);
  }
  return out;
}

type TeamRow = {
  key: string;
  label_en: string;
  label_ar: string;
  weight: number | null;
  sort_order: number;
  is_active: boolean;
};

async function loadTeams(): Promise<TeamRow[]> {
  const snap = await getFirestore().collection(PERFORMANCE_RATING_TEAMS).get();
  return snap.docs
    .map((doc) => {
      const raw = doc.data();
      return {
        key: asString(raw["key"]) ?? doc.id,
        label_en: asString(raw["label_en"]) ?? "",
        label_ar: asString(raw["label_ar"]) ?? "",
        weight: numberOf(raw["weight"]),
        sort_order: numberOf(raw["sort_order"]) ?? 0,
        is_active: raw["is_active"] === true,
      };
    })
    .sort((a, b) => a.sort_order - b.sort_order || a.key.localeCompare(b.key));
}

type CriterionRow = {
  id: string;
  team_key: string;
  key: string;
  label_en: string;
  label_ar: string;
  weight: number;
  sort_order: number;
  is_active: boolean;
};

async function loadCriteria(): Promise<CriterionRow[]> {
  const snap = await getFirestore().collection(COLLECTIONS.performanceRatingCriteria).get();
  return snap.docs.map((doc) => {
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
}

type RatingRow = {
  driver_id: string;
  criterion_id: string;
  score: number;
  rated_at: string | null;
};

async function loadRatings(monthFrom: string, monthTo: string): Promise<RatingRow[]> {
  const docs = await scanCapped(
    getFirestore()
      .collection(COLLECTIONS.driverPerformanceRatings)
      .where("period_month", ">=", monthFrom)
      .where("period_month", "<=", monthTo),
  );
  const out: RatingRow[] = [];
  for (const doc of docs) {
    const raw = doc.data();
    const driverId = asString(raw["driver_id"]);
    const criterionId = asString(raw["criterion_id"]);
    const score = numberOf(raw["score"]);
    if (!driverId || !criterionId || score === null) continue;
    out.push({
      driver_id: driverId,
      criterion_id: criterionId,
      score,
      rated_at: asDate(raw["rated_at"])?.toISOString() ?? null,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The per-driver-day source (live half)
// ---------------------------------------------------------------------------

type DailyRow = {
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
  conduct_weighted: number | null;
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

function lateMinutes(checkIn: Date | null, scheduledStart: Date | null, settings: AppSettings): number {
  return checkIn && scheduledStart
    ? Math.max(
        0,
        Math.floor((checkIn.getTime() - scheduledStart.getTime()) / 60_000) -
          settings.attendance_late_grace_minutes,
      )
    : 0;
}

function earlyOutMinutes(
  checkOut: Date | null,
  scheduledStart: Date | null,
  scheduledEnd: Date | null,
  settings: AppSettings,
): number {
  return checkOut && scheduledEnd && scheduledStart
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
}

async function liveDailySource(
  from: string,
  to: string,
  driverId: string | null,
  settings: AppSettings,
): Promise<DailyRow[]> {
  const db = getFirestore();
  const fromTs = kuwaitDayStart(from);
  const toTs = kuwaitDayEnd(to);

  let attendanceQuery: Query = db
    .collection(COLLECTIONS.attendanceLogs)
    .where("log_date", ">=", from)
    .where("log_date", "<=", to);
  if (driverId) attendanceQuery = attendanceQuery.where("driver_id", "==", driverId);

  let deliveryQuery: Query = db
    .collection(COLLECTIONS.deliveries)
    .where("delivered_at", ">=", fromTs)
    .where("delivered_at", "<", toTs);
  if (driverId) deliveryQuery = deliveryQuery.where("driver_id", "==", driverId);

  let wrongQuery: Query = db
    .collection(COLLECTIONS.wrongActions)
    .where("occurred_at", ">=", fromTs)
    .where("occurred_at", "<", toTs);
  if (driverId) wrongQuery = wrongQuery.where("driver_id", "==", driverId);

  // Fleet-wide on purpose: a quiet fleet and a pruned one look the same.
  const fleetQuery = db
    .collection(COLLECTIONS.fleetEvents)
    .where("detected_at", ">=", fromTs)
    .where("detected_at", "<", toTs);

  const [attendanceDocs, deliveryDocs, wrongDocs, fleetDocs, overrides, openSessions] =
    await Promise.all([
      scanCapped(attendanceQuery),
      scanCapped(deliveryQuery),
      scanCapped(wrongQuery),
      scanCapped(fleetQuery),
      loadSlaOverrides(),
      loadOpenSessions(),
    ]);

  const now = Date.now();
  const today = kuwaitDayString(now);

  const deliveries = new Map<string, Bucket>();
  for (const doc of deliveryDocs) {
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
  for (const doc of fleetDocs) {
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
      const target = category === "gps" ? gpsOffline : outside;
      target.set(key, (target.get(key) ?? 0) + minutes);
    }
  }

  const conduct = new Map<string, number>();
  for (const doc of wrongDocs) {
    const raw = doc.data();
    const occurredAt = asDate(raw["occurred_at"]);
    const rowDriverId = asString(raw["driver_id"]);
    if (!occurredAt || !rowDriverId) continue;
    const severity = asString(raw["severity"]);
    const weight = severity === "high" ? 3 : severity === "medium" ? 2 : 1;
    const key = bucketKey(rowDriverId, kuwaitDayString(occurredAt));
    conduct.set(key, (conduct.get(key) ?? 0) + weight);
  }

  const rows: DailyRow[] = [];
  for (const doc of attendanceDocs) {
    const raw = doc.data();
    const rowDriverId = asString(raw["driver_id"]) ?? doc.id;
    const logDate = asString(raw["log_date"]) ?? today;

    const checkIn = asDate(raw["check_in_at"]);
    const checkOut = asDate(raw["check_out_at"]);
    const scheduledStart = asDate(raw["scheduled_start_at"]);
    const scheduledEnd = asDate(raw["scheduled_end_at"]);
    const onLeave = asString(raw["status"]) === "on_leave";

    const minutesLate = lateMinutes(checkIn, scheduledStart, settings);
    const minutesEarlyOut = earlyOutMinutes(checkOut, scheduledStart, scheduledEnd, settings);

    const openSessionAt = openSessions.get(rowDriverId);
    const sessionLiveSeconds = openSessionAt
      ? Math.max(0, Math.round((now - openSessionAt.getTime()) / 1000))
      : 0;
    const isOnDuty =
      raw["is_on_duty"] === true && checkIn !== null && checkOut === null && logDate === today;
    const dutySecondsRaw = checkOut
      ? Math.max(0, Math.round((checkOut.getTime() - (checkIn?.getTime() ?? 0)) / 1000))
      : isOnDuty
        ? Math.max(0, Math.round((now - (checkIn?.getTime() ?? 0)) / 1000))
        : 0;

    const key = bucketKey(rowDriverId, logDate);
    const delivery = deliveries.get(key) ?? null;
    const hasFleetDay = fleetDays.has(logDate);

    rows.push({
      driver_id: rowDriverId,
      log_date: logDate,
      worked: checkIn !== null && !onLeave,
      on_leave: onLeave,
      absent: !onLeave && checkIn === null,
      lost_minutes: checkIn && scheduledStart ? minutesLate + minutesEarlyOut : null,
      scheduled_minutes:
        scheduledStart && scheduledEnd
          ? Math.max((scheduledEnd.getTime() - scheduledStart.getTime()) / 60_000, 0)
          : null,
      online_seconds: checkIn ? (numberOf(raw["online_seconds"]) ?? 0) + sessionLiveSeconds : null,
      duty_seconds: checkIn && dutySecondsRaw > 0 ? dutySecondsRaw : null,
      out_of_zone_minutes: hasFleetDay ? (outside.get(key) ?? 0) : null,
      gps_offline_minutes: hasFleetDay ? (gpsOffline.get(key) ?? 0) : null,
      deliveries_completed: delivery ? delivery.completed : null,
      deliveries_within_sla: delivery ? delivery.within : null,
      overspeed_events: hasFleetDay ? (overspeed.get(key) ?? 0) : null,
      conduct_weighted: conduct.get(key) ?? 0,
    });
  }
  return rows;
}

async function storedDailyRows(from: string, to: string, driverId: string | null): Promise<DailyRow[]> {
  let query: Query = getFirestore()
    .collection(COLLECTIONS.driverPerformanceDaily)
    .where("log_date", ">=", from)
    .where("log_date", "<=", to);
  if (driverId) query = query.where("driver_id", "==", driverId);
  const docs = await scanCapped(query);
  const out: DailyRow[] = [];
  for (const doc of docs) {
    const raw = doc.data();
    const rowDriverId = asString(raw["driver_id"]);
    const logDate = dayString(raw["log_date"]);
    if (!rowDriverId || !logDate) continue;
    out.push({
      driver_id: rowDriverId,
      log_date: logDate,
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
      conduct_weighted: numberOf(raw["conduct_weighted"]),
    });
  }
  return out;
}

/** Closed days from the rollup, today and later recomputed from the source. */
async function dailyRows(
  from: string,
  to: string,
  driverId: string | null,
  today: string,
  settings: AppSettings,
): Promise<DailyRow[]> {
  const storedTo = minDay(to, addDays(today, -1));
  const liveFrom = maxDay(from, today);
  const [stored, live] = await Promise.all([
    from <= storedTo ? storedDailyRows(from, storedTo, driverId) : Promise.resolve([]),
    liveFrom <= to ? liveDailySource(liveFrom, to, driverId, settings) : Promise.resolve([]),
  ]);
  return [...stored, ...live];
}

/** Per-day component scores; the time-based ones are only measured on a worked day. */
function dayComponents(row: DailyRow, speedAllowance: number, conductAllowance: number): ComponentScores {
  const duty = row.duty_seconds ?? 0;
  return {
    punctuality:
      row.worked && (row.scheduled_minutes ?? 0) > 0 && row.lost_minutes !== null
        ? clamp01(1 - row.lost_minutes / (row.scheduled_minutes as number))
        : null,
    duty_ratio:
      row.worked && duty > 0 && row.online_seconds !== null
        ? clamp01(row.online_seconds / duty)
        : null,
    on_time:
      (row.deliveries_completed ?? 0) > 0
        ? (row.deliveries_within_sla ?? 0) / (row.deliveries_completed as number)
        : null,
    speed:
      row.worked && row.overspeed_events !== null && speedAllowance > 0
        ? clamp01(1 - row.overspeed_events / speedAllowance)
        : null,
    zone:
      row.worked && duty > 0 && row.out_of_zone_minutes !== null
        ? clamp01(1 - row.out_of_zone_minutes / (duty / 60))
        : null,
    gps:
      row.worked && duty > 0 && row.gps_offline_minutes !== null
        ? clamp01(1 - row.gps_offline_minutes / (duty / 60))
        : null,
    conduct:
      row.worked && row.conduct_weighted !== null && conductAllowance > 0
        ? clamp01(1 - row.conduct_weighted / conductAllowance)
        : null,
  };
}

// ---------------------------------------------------------------------------
// Attendance aggregates and exceptions (v_attendance_daily / v_attendance_exceptions)
// ---------------------------------------------------------------------------

type ExceptionItem = {
  exception_type: string;
  exception_date: string;
  severity: string;
  resolution_status: string;
};

type AttendanceAggregate = {
  worked_days: number;
  leave_days: number;
  absent_days: number;
  avg_compliance: number | null;
  worked_dates: string[];
  exceptions: ExceptionItem[];
};

function exceptionKey(driverId: string, day: string, type: string): string {
  return createHash("md5").update(`${driverId}:${day}:${type}`).digest("hex");
}

async function loadAttendanceAggregates(
  from: string,
  to: string,
  driverIds: ReadonlySet<string>,
  driverId: string | null,
  settings: AppSettings,
): Promise<Map<string, AttendanceAggregate>> {
  const db = getFirestore();
  const ATT = FIELDS.attendanceLogs;
  let query: Query = db
    .collection(COLLECTIONS.attendanceLogs)
    .where(ATT.logDate, ">=", from)
    .where(ATT.logDate, "<=", to);
  if (driverId) query = query.where(ATT.driverId, "==", driverId);
  const docs = (await scanCapped(query)).filter((doc) => {
    const id = asString(doc.get(ATT.driverId));
    return id !== null && driverIds.has(id);
  });

  const out = new Map<string, AttendanceAggregate>();
  if (!docs.length) return out;

  const now = new Date();
  const nowMs = now.getTime();
  const today = kuwaitDayString(now);
  const staleBefore = nowMs - settings.attendance_gps_stale_minutes * 60_000;

  const riderIds = [...new Set(docs.map((doc) => asString(doc.get(ATT.driverId)) as string))];
  const locations = new Map<string, Dict>();
  for (const group of chunkOf(riderIds, GET_ALL_CHUNK)) {
    const snaps = await db.getAll(...group.map((id) => db.collection(COLLECTIONS.driverLocations).doc(id)));
    for (const snap of snaps) if (snap.exists) locations.set(snap.id, (snap.data() ?? {}) as Dict);
  }
  const openSessions = await loadOpenSessions();

  const drafts: Array<{ driverId: string; day: string; type: string; severity: string }> = [];
  const complianceByDriver = new Map<string, Array<number | null>>();

  for (const doc of docs) {
    const raw = doc.data();
    const rowDriverId = asString(raw[ATT.driverId]) as string;
    const logDate = asString(raw[ATT.logDate]) ?? today;
    const checkIn = asDate(raw[ATT.checkInAt]);
    const checkOut = asDate(raw[ATT.checkOutAt]);
    const scheduledStart = asDate(raw[ATT.scheduledStartAt]);
    const scheduledEnd = asDate(raw[ATT.scheduledEndAt]);
    const onLeave = asString(raw[ATT.status]) === "on_leave";

    const location = locations.get(rowDriverId);
    const lastSeen = asDate(location?.[FIELDS.driverLocations.at]);
    const gpsZoneStatus = asString(location?.["zone_status"]);
    const isOnDuty = raw[ATT.isOnDuty] === true && Boolean(checkIn) && !checkOut && logDate === today;
    const openSessionAt = openSessions.get(rowDriverId);
    const onlineSeconds =
      (numberOf(raw[ATT.onlineSeconds]) ?? 0) +
      (openSessionAt ? Math.max(0, Math.round((nowMs - openSessionAt.getTime()) / 1000)) : 0);
    const dutySeconds = checkOut && checkIn
      ? Math.max(0, Math.round((checkOut.getTime() - checkIn.getTime()) / 1000))
      : isOnDuty && checkIn
        ? Math.max(0, Math.round((nowMs - checkIn.getTime()) / 1000))
        : 0;
    const minutesLate = lateMinutes(checkIn, scheduledStart, settings);
    const minutesEarlyOut = earlyOutMinutes(checkOut, scheduledStart, scheduledEnd, settings);

    let liveStatus: string;
    if (onLeave) liveStatus = "on_leave";
    else if (!scheduledStart) liveStatus = "no_shift";
    else if (!checkIn) liveStatus = "absent";
    else if (minutesLate > 0) liveStatus = "late";
    else if (isOnDuty && (!openSessionAt || !lastSeen || lastSeen.getTime() < staleBefore)) {
      liveStatus = "offline_during_shift";
    } else if (gpsZoneStatus === "out_of_zone") liveStatus = "outside_zone";
    else liveStatus = "present";

    let complianceScore: number | null;
    if (!checkIn || !scheduledStart) complianceScore = null;
    else if (minutesLate > 0) complianceScore = 70;
    else if (dutySeconds > 0) complianceScore = Math.min(100, Math.round((onlineSeconds / dutySeconds) * 100));
    else complianceScore = 100;

    const aggregate = out.get(rowDriverId) ?? {
      worked_days: 0,
      leave_days: 0,
      absent_days: 0,
      avg_compliance: null,
      worked_dates: [],
      exceptions: [],
    };
    const worked = checkIn !== null && !onLeave;
    if (worked) {
      aggregate.worked_days += 1;
      aggregate.worked_dates.push(logDate);
      const list = complianceByDriver.get(rowDriverId) ?? [];
      list.push(complianceScore);
      complianceByDriver.set(rowDriverId, list);
    }
    if (onLeave) aggregate.leave_days += 1;
    if (!onLeave && !checkIn) aggregate.absent_days += 1;
    out.set(rowDriverId, aggregate);

    const push = (type: string, severity: string) =>
      drafts.push({ driverId: rowDriverId, day: logDate, type, severity });
    if (minutesLate > 0) push("LateCheckIn", "high");
    if (
      scheduledStart &&
      !checkIn &&
      !isOnDuty &&
      logDate === today &&
      nowMs > scheduledStart.getTime()
    ) {
      push("NoCheckIn", "high");
    }
    if (minutesEarlyOut > 0) push("EarlyLogout", "medium");
    if (liveStatus === "offline_during_shift") push("OfflineDuringShift", "high");
    if (liveStatus === "outside_zone") push("OutsideZone", "medium");
    if (!scheduledStart && checkIn && logDate === today) push("NoAssignedShift", "low");
  }

  for (const [id, scores] of complianceByDriver) {
    const aggregate = out.get(id);
    if (aggregate) aggregate.avg_compliance = average(scores);
  }

  const keys = drafts.map((draft) => exceptionKey(draft.driverId, draft.day, draft.type));
  const resolutions = new Map<string, string>();
  for (const group of chunkOf([...new Set(keys)], GET_ALL_CHUNK)) {
    const snaps = await db.getAll(...group.map((key) => db.collection(EXCEPTION_ACTIONS).doc(key)));
    for (const snap of snaps) {
      const status = snap.exists ? asString(snap.get("resolution_status")) : null;
      if (status) resolutions.set(snap.id, status);
    }
  }

  drafts.forEach((draft, index) => {
    const resolution = resolutions.get(keys[index]) ?? "open";
    if (resolution !== "open" && resolution !== "acknowledged") return;
    out.get(draft.driverId)?.exceptions.push({
      exception_type: draft.type,
      exception_date: draft.day,
      severity: draft.severity,
      resolution_status: resolution,
    });
  });
  for (const aggregate of out.values()) {
    aggregate.exceptions.sort((a, b) => b.exception_date.localeCompare(a.exception_date));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Incentive target + eligible-delivery count
// ---------------------------------------------------------------------------

type ResolvedTarget = { rule: IncentiveRule; target: number };

function resolveTargets(
  context: IncentiveContext,
  onDate: string,
  drivers: ReadonlyArray<{ id: string; zone_id: string | null; partner_id: string | null }>,
  restaurantsByDriver: Map<string, Set<string>>,
): Map<string, ResolvedTarget> {
  const applicable = context.rules
    .filter((rule) => ruleAppliesOnDate(rule, onDate, context.rules, context.restaurantIdsOf))
    .sort(compareRulesForLoop);

  const out = new Map<string, ResolvedTarget>();
  for (const driver of drivers) {
    const restaurants = restaurantsByDriver.get(driver.id);
    const winner = applicable.find((rule) => {
      const scopes = context.incentiveScopesByRule.get(rule.id) ?? [];
      if (rule.scope_type === "zone") {
        return scopes.some((s) => s.zone_id !== null && s.zone_id === driver.zone_id);
      }
      if (rule.scope_type === "partner") {
        return scopes.some((s) => s.partner_id !== null && s.partner_id === driver.partner_id);
      }
      return Boolean(restaurants) && scopes.some((s) => s.restaurant_id !== null && restaurants!.has(s.restaurant_id));
    });
    if (!winner) continue;

    let target: number;
    if (winner.target_mode === "tiered") {
      const thresholds = (context.tiersByRule.get(winner.id) ?? []).map((tier) => tier.threshold_deliveries);
      target = thresholds.length ? Math.max(...thresholds) : (winner.base_minimum_deliveries ?? 0);
    } else {
      target = winner.target_deliveries ?? 0;
    }
    out.set(driver.id, { rule: winner, target });
  }
  return out;
}

type VerifiedDelivery = {
  driver_id: string;
  day: string;
  zone_id: string | null;
  partner_id: string | null;
  restaurant_id: string | null;
};

async function loadVerifiedDeliveries(
  from: string,
  to: string,
  driverId: string | null,
): Promise<Map<string, VerifiedDelivery[]>> {
  let query: Query = getFirestore()
    .collection(COLLECTIONS.deliveries)
    .where("delivered_at", ">=", kuwaitDayStart(from))
    .where("delivered_at", "<", kuwaitDayEnd(to));
  if (driverId) query = query.where("driver_id", "==", driverId);
  const docs = await scanCapped(query);
  const out = new Map<string, VerifiedDelivery[]>();
  for (const doc of docs) {
    const delivery = normaliseDelivery(doc.id, doc.data() as Record<string, unknown>);
    if (delivery.status !== "verified" || !delivery.delivered_at || !delivery.driver_id) continue;
    const list = out.get(delivery.driver_id) ?? [];
    list.push({
      driver_id: delivery.driver_id,
      day: kuwaitDayString(delivery.delivered_at),
      zone_id: delivery.zone_id,
      partner_id: delivery.partner_id,
      restaurant_id: delivery.restaurant_id,
    });
    out.set(delivery.driver_id, list);
  }
  return out;
}

/** `admin_count_eligible_deliveries_on_dates`. */
function countEligibleOnDates(
  context: IncentiveContext,
  deliveries: readonly VerifiedDelivery[],
  rule: IncentiveRule | null,
  workedDates: ReadonlySet<string>,
): number {
  if (!workedDates.size) return 0;
  const scopes = rule ? (context.incentiveScopesByRule.get(rule.id) ?? []) : [];
  let count = 0;
  for (const delivery of deliveries) {
    if (!workedDates.has(delivery.day)) continue;
    const matches = deliveryMatchesRules({
      delivery: {
        status: "verified",
        zone_id: delivery.zone_id,
        partner_id: delivery.partner_id,
        scope_restaurant_id: delivery.restaurant_id,
      },
      checkDate: delivery.day,
      deliveryRules: context.deliveryRules,
      deliveryScopesByRule: context.deliveryScopesByRule,
    });
    if (!matches) continue;
    if (rule) {
      const inScope =
        rule.scope_type === "zone"
          ? scopes.some((s) => s.zone_id !== null && s.zone_id === delivery.zone_id)
          : rule.scope_type === "partner"
            ? scopes.some((s) => s.partner_id !== null && s.partner_id === delivery.partner_id)
            : scopes.some((s) => s.restaurant_id !== null && s.restaurant_id === delivery.restaurant_id);
      if (!inScope) continue;
    }
    count += 1;
  }
  return count;
}

async function loadDriverRestaurants(): Promise<Map<string, Set<string>>> {
  const docs = await scanCapped(getFirestore().collection(COLLECTIONS.driverRestaurants));
  const out = new Map<string, Set<string>>();
  for (const doc of docs) {
    const driverId = asString(doc.get("driver_id"));
    const restaurantId = asString(doc.get("restaurant_id"));
    if (!driverId || !restaurantId) continue;
    const set = out.get(driverId) ?? new Set<string>();
    set.add(restaurantId);
    out.set(driverId, set);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Drivers
// ---------------------------------------------------------------------------

type DriverBase = {
  driver_id: string;
  driver_code: string | null;
  employee_id: string | null;
  driver_status: string | null;
  partner_id: string | null;
  zone_id: string | null;
  is_on_duty: boolean;
  driver_name: string;
  driver_phone: string;
  partner_name: string | null;
  zone_name: string | null;
};

async function loadActiveDrivers(driverId: string | null) {
  const db = getFirestore();
  if (driverId) {
    const snap = await db.collection(COLLECTIONS.drivers).doc(driverId).get();
    return snap.exists ? [{ id: snap.id, raw: (snap.data() ?? {}) as Dict }] : [];
  }
  const docs = await scanCapped(db.collection(COLLECTIONS.drivers));
  return docs.map((doc) => ({ id: doc.id, raw: doc.data() as Dict }));
}

// ---------------------------------------------------------------------------
// admin_list_driver_performance
// ---------------------------------------------------------------------------

type FinalRow = DriverBase & {
  worked_days: number;
  leave_days: number;
  absent_days: number;
  eligible_days: number;
  actual_deliveries: number;
  target_deliveries: number;
  rule_id: string | null;
  incentive_period: string | null;
  rule_target: number;
  utilization: number;
  delivery_efficiency: number;
  delivery_efficiency_raw: number;
  compliance_score: number | null;
  legacy_compliance_score: number | null;
  component_scores: Dict;
  exception_count: number;
  penalised_count: number;
  exceptions: ExceptionItem[];
  manual_score: number | null;
  manual_rating_count: number;
  manual_teams: Dict[];
  manual_criteria: Dict;
  overall_score: number | null;
};

function sortValue(row: FinalRow, sort: string): number | null {
  if (sort.startsWith("overall")) return row.overall_score;
  if (sort.startsWith("delivery")) return row.delivery_efficiency;
  if (sort.startsWith("utilization")) return row.utilization;
  if (sort.startsWith("compliance")) return row.compliance_score;
  if (sort.startsWith("manual")) return row.manual_score;
  return null;
}

function compareRows(a: FinalRow, b: FinalRow, sort: string): number {
  if (SORTS.has(sort)) {
    const direction: 1 | -1 = sort.endsWith("_asc") ? 1 : -1;
    const primary = sort.startsWith("name")
      ? direction * a.driver_name.localeCompare(b.driver_name)
      : compareNullable(sortValue(a, sort), sortValue(b, sort), direction);
    if (primary !== 0) return primary;
  }
  return compareNullable(a.overall_score, b.overall_score, -1) || a.driver_name.localeCompare(b.driver_name);
}

function scoreBand(score: number | null): string {
  if (score !== null && score >= 80) return "top";
  if (score !== null && score >= 70) return "good";
  if (score !== null && score >= 50) return "watch";
  return "critical";
}

export const adminListDriverPerformance = onCall(async (request) => {
  await requireStaff(request);
  const data = (request.data ?? {}) as Dict;

  const from = pickDay(data, "from", "p_from");
  const to = pickDay(data, "to", "p_to");
  if (!from || !to || to < from) throw new HttpsError("invalid-argument", "invalid_date_range");

  const limitRaw = numberOf(pick(data, "limit", "p_limit"));
  if ((limitRaw ?? 50) > MAX_LIMIT) throw new HttpsError("invalid-argument", "limit_too_large");
  const limit = Math.max(Math.trunc(limitRaw ?? 50), 1);
  const offset = Math.max(Math.trunc(numberOf(pick(data, "offset", "p_offset")) ?? 0), 0);

  const search = (pickText(data, "search", "p_search") ?? "").trim().toLowerCase();
  const partnerId = pickId(data, "partnerId", "p_partner_id");
  const zoneId = pickId(data, "zoneId", "p_zone_id");
  const restaurantId = pickId(data, "restaurantId", "p_restaurant_id");
  const driverStatus = pickText(data, "driverStatus", "p_driver_status");
  const driverId = pickId(data, "driverId", "p_driver_id");
  const sort = pickText(data, "sort", "p_sort") ?? "overall_desc";

  const today = kuwaitDayString(new Date());
  const periodDays = dayDiff(from, to) + 1;

  const [settings, perf, components, teams, criteria, ratings, restaurantsByDriver, rawDrivers, context] =
    await Promise.all([
      loadAppSettings(),
      loadPerformanceSettings(),
      loadComponents(),
      loadTeams(),
      loadCriteria(),
      loadRatings(monthStart(from), monthStart(to)),
      loadDriverRestaurants(),
      loadActiveDrivers(driverId),
      loadIncentiveContext(),
    ]);

  const candidates = rawDrivers.filter(({ raw }) => {
    if (raw["archived_at"] !== undefined && raw["archived_at"] !== null) return false;
    if (partnerId && asString(raw["partner_id"]) !== partnerId) return false;
    if (zoneId && asString(raw["zone_id"]) !== zoneId) return false;
    return true;
  });
  const [profiles, partners, zones] = await Promise.all([
    loadDocMap(COLLECTIONS.profiles, candidates.map((driver) => driver.id)),
    loadDocMap(
      COLLECTIONS.partners,
      [...new Set(candidates.map(({ raw }) => asString(raw["partner_id"])).filter((id): id is string => !!id))],
    ),
    loadDocMap(
      COLLECTIONS.zones,
      [...new Set(candidates.map(({ raw }) => asString(raw["zone_id"])).filter((id): id is string => !!id))],
    ),
  ]);

  const base: DriverBase[] = [];
  for (const { id, raw } of candidates) {
    const profile = profiles.get(id);
    if (!profile) continue;
    const status = asString(raw["status"]);
    if (driverStatus && driverStatus !== "all" && status !== driverStatus) continue;
    if (restaurantId && !restaurantsByDriver.get(id)?.has(restaurantId)) continue;
    const fullName = asString(profile["full_name"]);
    const driverCode = asString(raw["driver_code"]);
    const employeeId = asString(raw["employee_id"]);
    if (
      search &&
      !(fullName ?? "").toLowerCase().includes(search) &&
      !(driverCode ?? "").toLowerCase().includes(search) &&
      !(employeeId ?? "").toLowerCase().includes(search)
    ) {
      continue;
    }
    const partner = asString(raw["partner_id"]);
    const zone = asString(raw["zone_id"]);
    base.push({
      driver_id: id,
      driver_code: driverCode,
      employee_id: employeeId,
      driver_status: status,
      partner_id: partner,
      zone_id: zone,
      is_on_duty: raw["is_on_duty"] === true,
      driver_name: fullName ?? "—",
      driver_phone: asString(profile["phone"]) ?? "—",
      partner_name: partner ? asString(partners.get(partner)?.["name"]) : null,
      zone_name: zone ? asString(zones.get(zone)?.["name"]) : null,
    });
  }
  const baseIds = new Set(base.map((driver) => driver.driver_id));

  const [attendance, daily, deliveries] = await Promise.all([
    loadAttendanceAggregates(from, to, baseIds, driverId, settings),
    dailyRows(from, to, driverId, today, settings),
    loadVerifiedDeliveries(from, to, driverId),
  ]);

  const targets = resolveTargets(
    context,
    to,
    base.map((driver) => ({ id: driver.driver_id, zone_id: driver.zone_id, partner_id: driver.partner_id })),
    restaurantsByDriver,
  );

  const rollByDriver = new Map<string, DailyRow[]>();
  for (const row of daily) {
    if (!baseIds.has(row.driver_id)) continue;
    const list = rollByDriver.get(row.driver_id) ?? [];
    list.push(row);
    rollByDriver.set(row.driver_id, list);
  }

  const weights = componentWeights(components);
  const teamByKey = new Map(teams.map((team) => [team.key, team]));
  const criterionById = new Map(criteria.map((criterion) => [criterion.id, criterion]));

  type CritAgg = { criterion: CriterionRow; scores: number[]; lastRatedAt: string | null };
  const ratingsByDriver = new Map<string, Map<string, CritAgg>>();
  for (const rating of ratings) {
    if (!baseIds.has(rating.driver_id)) continue;
    const criterion = criterionById.get(rating.criterion_id);
    if (!criterion?.is_active || !teamByKey.get(criterion.team_key)?.is_active) continue;
    const perDriver = ratingsByDriver.get(rating.driver_id) ?? new Map<string, CritAgg>();
    const agg = perDriver.get(criterion.id) ?? { criterion, scores: [], lastRatedAt: null };
    agg.scores.push(rating.score);
    if (rating.rated_at && (!agg.lastRatedAt || rating.rated_at > agg.lastRatedAt)) agg.lastRatedAt = rating.rated_at;
    perDriver.set(criterion.id, agg);
    ratingsByDriver.set(rating.driver_id, perDriver);
  }

  const rows: FinalRow[] = base.map((driver) => {
    const att = attendance.get(driver.driver_id);
    const workedDays = att?.worked_days ?? 0;
    const leaveDays = att?.leave_days ?? 0;
    const absentDays = att?.absent_days ?? 0;
    const eligibleDays = Math.max(periodDays - leaveDays - absentDays, 0);

    const roll = rollByDriver.get(driver.driver_id) ?? [];
    const perDay = roll.map((row) => dayComponents(row, perf.speedAllowance, perf.conductAllowance));
    const delTotal = sumOrNull(roll.map((row) => row.deliveries_completed));
    const delSla = sumOrNull(roll.map((row) => row.deliveries_within_sla));
    const overspeedTotal = sumOrNull(roll.map((row) => row.overspeed_events));
    const speedDays = roll.filter((row) => row.worked && row.overspeed_events !== null).length;
    const conductTotal = sumOrNull(roll.map((row) => row.conduct_weighted));
    const conductDays = roll.filter((row) => row.worked && row.conduct_weighted !== null).length;

    const scores: ComponentScores = {
      punctuality: average(perDay.map((day) => day.punctuality)),
      duty_ratio: average(perDay.map((day) => day.duty_ratio)),
      zone: average(perDay.map((day) => day.zone)),
      gps: average(perDay.map((day) => day.gps)),
      on_time: (delTotal ?? 0) > 0 ? (delSla ?? 0) / (delTotal as number) : null,
      speed:
        speedDays > 0 && perf.speedAllowance > 0
          ? clamp01(1 - (overspeedTotal ?? 0) / (perf.speedAllowance * speedDays))
          : null,
      conduct:
        conductDays > 0 && perf.conductAllowance > 0
          ? clamp01(1 - (conductTotal ?? 0) / (perf.conductAllowance * conductDays))
          : null,
    };
    const { num, den } = blend(scores, weights);

    const exceptions = att?.exceptions ?? [];
    const penalisedCount = exceptions.filter((item) => PENALISED_EXCEPTIONS.has(item.exception_type)).length;

    const complianceScore =
      den > 0 ? Math.max(0, Math.min(100, (100 * num) / den - penalisedCount * perf.exceptionPenalty)) : null;
    const legacyRaw = att?.avg_compliance ?? null;
    const legacyCompliance =
      legacyRaw === null
        ? null
        : Math.max(0, Math.min(100, legacyRaw - exceptions.length * perf.exceptionPenalty));

    const critAggs = [...(ratingsByDriver.get(driver.driver_id)?.values() ?? [])];
    const byTeam = new Map<string, CritAgg[]>();
    for (const agg of critAggs) {
      const list = byTeam.get(agg.criterion.team_key) ?? [];
      list.push(agg);
      byTeam.set(agg.criterion.team_key, list);
    }
    const teamRows = [...byTeam.entries()].map(([teamKey, aggs]) => {
      const crit = aggs.map((agg) => ({
        weight: Math.max(agg.criterion.weight, 0),
        avg: agg.scores.reduce((sum, value) => sum + value, 0) / agg.scores.length,
      }));
      const weightSum = crit.reduce((sum, item) => sum + item.weight, 0);
      const teamAvg =
        weightSum > 0
          ? crit.reduce((sum, item) => sum + item.weight * item.avg, 0) / weightSum
          : crit.reduce((sum, item) => sum + item.avg, 0) / crit.length;
      const lastRated = aggs.reduce<string | null>(
        (latest, agg) => (agg.lastRatedAt && (!latest || agg.lastRatedAt > latest) ? agg.lastRatedAt : latest),
        null,
      );
      return {
        team: teamByKey.get(teamKey) as TeamRow,
        teamAvg,
        monthsRated: Math.max(...aggs.map((agg) => agg.scores.length)),
        lastRated,
      };
    });
    teamRows.sort((a, b) => a.team.sort_order - b.team.sort_order || a.team.key.localeCompare(b.team.key));
    const teamWeightSum = teamRows.reduce((sum, row) => sum + (row.team.weight ?? 1), 0);
    const manualAvgRaw =
      teamRows.length && teamWeightSum > 0
        ? teamRows.reduce((sum, row) => sum + (row.team.weight ?? 1) * row.teamAvg, 0) / teamWeightSum
        : null;
    const manualRatio = manualAvgRaw === null ? null : clamp01((manualAvgRaw - 1) / 4);
    const manualCriteria: Dict = {};
    for (const agg of critAggs) {
      const avg = agg.scores.reduce((sum, value) => sum + value, 0) / agg.scores.length;
      manualCriteria[`${agg.criterion.team_key}.${agg.criterion.key}`] = roundTo(avg, 2);
    }

    const resolved = targets.get(driver.driver_id) ?? null;
    const ruleTarget = resolved?.target ?? 0;
    const period = resolved?.rule.period ?? null;
    let targetDeliveries: number;
    if (!resolved || ruleTarget <= 0 || eligibleDays <= 0) targetDeliveries = 0;
    else if (period === "daily") targetDeliveries = roundTo(ruleTarget * eligibleDays, 0);
    else if (period === "weekly") targetDeliveries = Math.max(roundTo(ruleTarget * (eligibleDays / 7), 0), 1);
    else if (period === "monthly") targetDeliveries = Math.max(roundTo(ruleTarget * (eligibleDays / 30), 0), 1);
    else targetDeliveries = ruleTarget;

    const actualDeliveries = countEligibleOnDates(
      context,
      deliveries.get(driver.driver_id) ?? [],
      resolved?.rule ?? null,
      new Set(att?.worked_dates ?? []),
    );
    const utilization = eligibleDays <= 0 ? 0 : Math.min(workedDays / eligibleDays, 1);
    const efficiencyRaw = targetDeliveries <= 0 ? 0 : actualDeliveries / targetDeliveries;
    const efficiency = Math.min(efficiencyRaw, 1);

    const overallDen =
      perf.delivery +
      perf.utilization +
      (complianceScore === null ? 0 : perf.compliance) +
      (manualRatio === null ? 0 : perf.manual);
    const overallNum =
      perf.delivery * efficiency +
      perf.utilization * utilization +
      (complianceScore === null ? 0 : perf.compliance * (complianceScore / 100)) +
      (manualRatio === null ? 0 : perf.manual * manualRatio);

    return {
      ...driver,
      worked_days: workedDays,
      leave_days: leaveDays,
      absent_days: absentDays,
      eligible_days: eligibleDays,
      actual_deliveries: actualDeliveries,
      target_deliveries: targetDeliveries,
      rule_id: resolved?.rule.id ?? null,
      incentive_period: period,
      rule_target: ruleTarget,
      utilization,
      delivery_efficiency: efficiency,
      delivery_efficiency_raw: efficiencyRaw,
      compliance_score: complianceScore,
      legacy_compliance_score: legacyCompliance,
      component_scores: componentJson(scores),
      exception_count: exceptions.length,
      penalised_count: penalisedCount,
      exceptions,
      manual_score: manualRatio === null ? null : roundTo(manualRatio * 100, 1),
      manual_rating_count: teamRows.length,
      manual_teams: teamRows.map((row) => ({
        team_key: row.team.key,
        score: roundTo(row.teamAvg, 2),
        months_rated: row.monthsRated,
        last_rated_at: row.lastRated,
      })),
      manual_criteria: manualCriteria,
      overall_score: overallDen === 0 ? null : roundTo((100 * overallNum) / overallDen, 1),
    };
  });

  const scoredValues = rows.map((row) => row.overall_score).filter((score): score is number => score !== null);
  const rankOf = (score: number | null) =>
    score === null
      ? scoredValues.length + 1
      : 1 + scoredValues.filter((other) => other > score).length;

  const ordered = [...rows].sort((a, b) => compareRows(a, b, sort));
  const paged = ordered.slice(offset, offset + limit).map((row) => ({
    driver_id: row.driver_id,
    driver_code: row.driver_code,
    employee_id: row.employee_id,
    driver_name: row.driver_name,
    driver_phone: row.driver_phone,
    driver_status: row.driver_status,
    partner_id: row.partner_id,
    partner_name: row.partner_name,
    zone_id: row.zone_id,
    zone_name: row.zone_name,
    is_on_duty: row.is_on_duty,
    worked_days: row.worked_days,
    leave_days: row.leave_days,
    absent_days: row.absent_days,
    eligible_days: row.eligible_days,
    period_days: periodDays,
    actual_deliveries: row.actual_deliveries,
    target_deliveries: row.target_deliveries,
    rule_id: row.rule_id,
    incentive_period: row.incentive_period,
    rule_target: row.rule_target,
    delivery_efficiency: roundTo(row.delivery_efficiency, 4),
    delivery_efficiency_raw: roundTo(row.delivery_efficiency_raw, 4),
    utilization: roundTo(row.utilization, 4),
    compliance_score: roundOrNull(row.compliance_score, 1),
    legacy_compliance_score: roundOrNull(row.legacy_compliance_score, 1),
    component_scores: row.component_scores,
    exception_count: row.exception_count,
    penalised_exception_count: row.penalised_count,
    exceptions: row.exceptions,
    manual_score: row.manual_score,
    manual_rating_count: row.manual_rating_count,
    manual_teams: row.manual_teams,
    manual_criteria: row.manual_criteria,
    overall_score: row.overall_score,
    dpd_rank: rankOf(row.overall_score),
    score_band: scoreBand(row.overall_score),
  }));

  const byScoreDesc = [...rows].sort(
    (a, b) => compareNullable(a.overall_score, b.overall_score, -1) || a.driver_name.localeCompare(b.driver_name),
  );
  const byScoreAsc = [...rows].sort(
    (a, b) => compareNullable(a.overall_score, b.overall_score, 1) || a.driver_name.localeCompare(b.driver_name),
  );
  const countWhere = (predicate: (score: number) => boolean) => scoredValues.filter(predicate).length;
  const kpis = {
    avg_overall: roundOrNull(average(rows.map((row) => row.overall_score)), 1),
    avg_delivery_pct: roundOrNull(
      rows.length ? (average(rows.map((row) => row.delivery_efficiency)) as number) * 100 : null,
      1,
    ),
    avg_utilization_pct: roundOrNull(
      rows.length ? (average(rows.map((row) => row.utilization)) as number) * 100 : null,
      1,
    ),
    avg_compliance: roundOrNull(average(rows.map((row) => row.compliance_score)), 1),
    avg_legacy_compliance: roundOrNull(average(rows.map((row) => row.legacy_compliance_score)), 1),
    below_threshold: countWhere((score) => score < 70),
    top_score: scoredValues.length ? roundTo(Math.max(...scoredValues), 1) : null,
    bottom_score: scoredValues.length ? roundTo(Math.min(...scoredValues), 1) : null,
    top_driver_name: byScoreDesc[0]?.driver_name ?? null,
    bottom_driver_name: byScoreAsc[0]?.driver_name ?? null,
    band_top: countWhere((score) => score >= 80),
    band_good: countWhere((score) => score >= 70 && score < 80),
    band_watch: countWhere((score) => score >= 50 && score < 70),
    band_critical: countWhere((score) => score < 50),
    avg_manual: roundOrNull(average(rows.map((row) => row.manual_score)), 1),
    rated_drivers: rows.filter((row) => row.manual_rating_count > 0).length,
  };

  const criteriaPayload = criteria
    .filter((criterion) => {
      const team = teamByKey.get(criterion.team_key);
      return criterion.is_active && team?.is_active === true && criterion.weight > 0;
    })
    .sort((a, b) => {
      const teamA = teamByKey.get(a.team_key) as TeamRow;
      const teamB = teamByKey.get(b.team_key) as TeamRow;
      return (
        teamA.sort_order - teamB.sort_order ||
        teamA.key.localeCompare(teamB.key) ||
        a.sort_order - b.sort_order ||
        a.key.localeCompare(b.key)
      );
    })
    .map((criterion) => {
      const team = teamByKey.get(criterion.team_key) as TeamRow;
      return {
        id: criterion.id,
        team_key: criterion.team_key,
        key: criterion.key,
        label_en: criterion.label_en,
        label_ar: criterion.label_ar,
        weight: criterion.weight,
        team_label_en: team.label_en,
        team_label_ar: team.label_ar,
      };
    });

  return {
    totalCount: rows.length,
    rows: paged,
    kpis,
    weights: perf.weightsRaw,
    components: componentsPayload(components),
    criteria: criteriaPayload,
    slaMinutes: perf.slaMinutes,
    from,
    to,
    maxExportRows: MAX_LIMIT,
  };
});

// ---------------------------------------------------------------------------
// admin_performance_trend
// ---------------------------------------------------------------------------

type TrendBucket = "day" | "week" | "month";

function parseBucket(value: string | null): TrendBucket {
  switch ((value ?? "day").toLowerCase()) {
    case "week":
      return "week";
    case "month":
      return "month";
    default:
      return "day";
  }
}

function bucketStart(day: string, bucket: TrendBucket): string {
  switch (bucket) {
    case "day":
      return day;
    case "month":
      return monthStart(day);
    case "week": {
      const date = new Date(`${day}T00:00:00Z`);
      const offsetToMonday = (date.getUTCDay() + 6) % 7;
      return new Date(date.getTime() - offsetToMonday * DAY_MS).toISOString().slice(0, 10);
    }
    default: {
      const exhaustive: never = bucket;
      return exhaustive;
    }
  }
}

type TrendDay = DailyRow & {
  zone_id: string | null;
  partner_id: string | null;
  is_current: boolean;
  scores: ComponentScores;
  day_score: number | null;
};

function halfTotals(days: readonly TrendDay[]): Dict {
  if (!days.length) return {};
  const completed = sumOrNull(days.map((day) => day.deliveries_completed)) ?? 0;
  const within = sumOrNull(days.map((day) => day.deliveries_within_sla)) ?? 0;
  return {
    score: roundOrNull(average(days.map((day) => day.day_score)), 1),
    drivers: new Set(days.map((day) => day.driver_id)).size,
    worked_days: days.filter((day) => day.worked).length,
    leave_days: days.filter((day) => day.on_leave).length,
    absent_days: days.filter((day) => day.absent).length,
    deliveries: completed,
    within_sla: within,
    sla_rate: completed > 0 ? roundTo((100 * within) / completed, 1) : null,
    overspeed_events: sumOrNull(days.map((day) => day.overspeed_events)) ?? 0,
    conduct_weighted: sumOrNull(days.map((day) => day.conduct_weighted)) ?? 0,
    components_measured: COMPONENT_KEYS.filter((key) => days.some((day) => day.scores[key] !== null)),
  };
}

function breakdown(
  days: readonly TrendDay[],
  keyOf: (day: TrendDay) => string | null,
  names: Map<string, Dict>,
): Dict[] {
  const groups = new Map<string | null, TrendDay[]>();
  for (const day of days) {
    const key = keyOf(day);
    const list = groups.get(key) ?? [];
    list.push(day);
    groups.set(key, list);
  }
  return [...groups.entries()]
    .map(([key, list]) => ({
      key,
      label: (key ? asString(names.get(key)?.["name"]) : null) ?? "",
      score: average(list.map((day) => day.day_score)),
      drivers: new Set(list.map((day) => day.driver_id)).size,
      deliveries: sumOrNull(list.map((day) => day.deliveries_completed)) ?? 0,
    }))
    .sort((a, b) => compareNullable(a.score, b.score, -1) || a.label.localeCompare(b.label))
    .map((row) => ({ ...row, score: roundOrNull(row.score, 1) }));
}

function bandRank(score: number | null): number | null {
  if (score === null) return null;
  if (score >= 80) return 3;
  if (score >= 70) return 2;
  if (score >= 50) return 1;
  return 0;
}

export const adminPerformanceTrend = onCall(async (request) => {
  await requireStaff(request, "performance.analyze");
  const data = (request.data ?? {}) as Dict;

  const from = pickDay(data, "from", "p_from");
  const to = pickDay(data, "to", "p_to");
  if (!from || !to || to < from) throw new HttpsError("invalid-argument", "invalid_date_range");
  if (dayDiff(from, to) > MAX_TREND_DAYS) throw new HttpsError("failed-precondition", "range_too_large");

  const bucket = parseBucket(pickText(data, "bucket", "p_bucket"));
  const zoneId = pickId(data, "zoneId", "p_zone_id");
  const partnerId = pickId(data, "partnerId", "p_partner_id");

  const days = dayDiff(from, to) + 1;
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(days - 1));
  const today = kuwaitDayString(new Date());

  const [settings, perf, components, teams, criteria, ratings, rawDrivers] = await Promise.all([
    loadAppSettings(),
    loadPerformanceSettings(),
    loadComponents(),
    loadTeams(),
    loadCriteria(),
    loadRatings(monthStart(from), monthStart(to)),
    loadActiveDrivers(null),
  ]);

  const drivers = new Map<string, { zone_id: string | null; partner_id: string | null }>();
  for (const { id, raw } of rawDrivers) {
    if (raw["archived_at"] !== undefined && raw["archived_at"] !== null) continue;
    const zone = asString(raw["zone_id"]);
    const partner = asString(raw["partner_id"]);
    if (zoneId && zone !== zoneId) continue;
    if (partnerId && partner !== partnerId) continue;
    drivers.set(id, { zone_id: zone, partner_id: partner });
  }

  const weights = componentWeights(components);
  const source = await dailyRows(prevFrom, to, null, today, settings);
  const scored: TrendDay[] = [];
  for (const row of source) {
    const driver = drivers.get(row.driver_id);
    if (!driver) continue;
    const scores = dayComponents(row, perf.speedAllowance, perf.conductAllowance);
    const { num, den } = blend(scores, weights);
    scored.push({
      ...row,
      zone_id: driver.zone_id,
      partner_id: driver.partner_id,
      is_current: row.log_date >= from,
      scores,
      day_score: den > 0 ? (100 * num) / den : null,
    });
  }
  const current = scored.filter((day) => day.is_current);
  const previous = scored.filter((day) => !day.is_current);

  const seriesGroups = new Map<string, TrendDay[]>();
  for (const day of current) {
    const key = bucketStart(day.log_date, bucket);
    const list = seriesGroups.get(key) ?? [];
    list.push(day);
    seriesGroups.set(key, list);
  }
  const series = [...seriesGroups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, list]) => {
      const componentAverages: Dict = {};
      for (const component of COMPONENT_KEYS) {
        const value = average(list.map((day) => day.scores[component]));
        if (value !== null) componentAverages[component] = roundTo(value, 4);
      }
      return {
        bucket: key,
        score: roundOrNull(average(list.map((day) => day.day_score)), 1),
        drivers: new Set(list.map((day) => day.driver_id)).size,
        worked_days: list.filter((day) => day.worked).length,
        leave_days: list.filter((day) => day.on_leave).length,
        absent_days: list.filter((day) => day.absent).length,
        deliveries: sumOrNull(list.map((day) => day.deliveries_completed)) ?? 0,
        within_sla: sumOrNull(list.map((day) => day.deliveries_within_sla)) ?? 0,
        components: componentAverages,
      };
    });

  const zoneIds = [...new Set(current.map((day) => day.zone_id).filter((id): id is string => !!id))];
  const partnerIds = [...new Set(current.map((day) => day.partner_id).filter((id): id is string => !!id))];
  const [zoneNames, partnerNames] = await Promise.all([
    loadDocMap(COLLECTIONS.zones, zoneIds),
    loadDocMap(COLLECTIONS.partners, partnerIds),
  ]);

  const halves = new Map<string, { now: Array<number | null>; prev: Array<number | null> }>();
  for (const day of scored) {
    if (day.day_score === null) continue;
    const entry = halves.get(day.driver_id) ?? { now: [], prev: [] };
    (day.is_current ? entry.now : entry.prev).push(day.day_score);
    halves.set(day.driver_id, entry);
  }
  const driverHalves = new Map(
    [...halves.entries()].map(([id, entry]) => [id, { now: average(entry.now), prev: average(entry.prev) }]),
  );

  const criterionTeam = new Map(criteria.map((criterion) => [criterion.id, criterion.team_key]));
  const teamRated = new Map<string, Map<string, number[]>>();
  for (const rating of ratings) {
    const teamKey = criterionTeam.get(rating.criterion_id);
    if (teamKey === undefined) continue;
    const perTeam = teamRated.get(teamKey) ?? new Map<string, number[]>();
    const list = perTeam.get(rating.driver_id) ?? [];
    list.push(rating.score);
    perTeam.set(rating.driver_id, list);
    teamRated.set(teamKey, perTeam);
  }
  const byTeam = teams
    .filter((team) => team.is_active)
    .map((team) => {
      const rated = [...(teamRated.get(team.key)?.entries() ?? [])];
      const avgScores = rated.map(([, scores]) => scores.reduce((sum, value) => sum + value, 0) / scores.length);
      return {
        key: team.key,
        label: team.label_en,
        score: roundOrNull(average(rated.map(([id]) => driverHalves.get(id)?.now ?? null)), 1),
        drivers: rated.length,
        avg_rating: roundOrNull(average(avgScores), 2),
      };
    });

  const banded = [...driverHalves.values()].map((entry) => ({
    now: bandRank(entry.now),
    prev: bandRank(entry.prev),
  }));
  const moved = (predicate: (now: number, prev: number) => boolean) =>
    banded.filter((band) => band.prev !== null && band.now !== null && predicate(band.now, band.prev)).length;
  const bandCounts = (pickRank: (band: { now: number | null; prev: number | null }) => number | null) => ({
    top: banded.filter((band) => pickRank(band) === 3).length,
    good: banded.filter((band) => pickRank(band) === 2).length,
    watch: banded.filter((band) => pickRank(band) === 1).length,
    critical: banded.filter((band) => pickRank(band) === 0).length,
  });

  return {
    from,
    to,
    previous_from: prevFrom,
    previous_to: prevTo,
    bucket,
    components: componentsPayload(components),
    series,
    totals: halfTotals(current),
    previous_totals: halfTotals(previous),
    by_zone: breakdown(current, (day) => day.zone_id, zoneNames),
    by_partner: breakdown(current, (day) => day.partner_id, partnerNames),
    by_team: byTeam,
    bands: {
      improved: moved((now, prev) => now > prev),
      declined: moved((now, prev) => now < prev),
      unchanged: moved((now, prev) => now === prev),
      current: bandCounts((band) => band.now),
      previous: bandCounts((band) => band.prev),
    },
  };
});
