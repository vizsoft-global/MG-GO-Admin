import { AggregateField, getFirestore, Timestamp, type Firestore } from "../core/fs";
import { measureBlock, measureOnCall, withReadDeadline } from "../core/fs-metrics";
import { createConfigCache, readConfigEpochs } from "../core/config-cache";
import { COLLECTIONS, FIELDS } from "../core/collections";
import {
  kuwaitDayEnd,
  kuwaitDayRange,
  kuwaitDayStart,
  kuwaitDayString,
} from "../core/kuwait";
import { kuwaitWeekStart } from "../core/money";
import {
  loadAppSettings,
  loadDriverAppSafetySettings,
  loadHomeSnapshotFlags,
} from "../core/settings";
import { requireRider, riderError } from "../core/rider";
import { riderIsNonOperational } from "../core/operational-sections";
import { applyAttendanceRollup } from "../core/rollups";
import { bumpRiderSignal } from "../core/rider-signals";
import {
  computeIncentiveAmount,
  ruleMatchesScope,
  type IncentiveRule,
  type IncentiveTier,
  type RuleScope,
  type RuleScopeType,
  type ScopedRule,
} from "../core/incentive";
import { driverRestaurantIds } from "./deliveries-shared";
import { sendDriverHomeRefresh } from "./driver-refresh";
import { logger } from "firebase-functions";
import { FUNCTIONS_REGION } from "../router/lanes";
import {
  isoTimestamp,
  logDriverOperation,
  numberOrNull,
  pick,
  pickBoolean,
  pickText,
  pickTriBool,
  type Dict,
} from "./_shared";
import {
  isCheckInPhotoKeyForKey,
  isKeetaDriver,
  keetaZoneVerdict,
  loadCheckInCandidates,
  loadCheckInZone,
  matchCheckInRestaurant,
  nearestCheckInRestaurant,
  needsCheckIn,
  type CheckInZoneSummary,
} from "./check-in-gate";
import {
  findActiveShift,
  parseShiftTime,
  shiftEndAt,
  shiftSessionInstant,
  shiftStartAt,
  type ShiftRow,
} from "./driver-shift";
import { pickMissingAttendanceDenorm, stampAttendanceLogDenorm } from "./attendance-stamp";
import {
  attendanceDateKey,
  mergeTodayOnlineSeconds,
  pickAttendanceDayRow,
} from "./attendance-day";

/** `attendance_logs` field names, kept beside the collection constants. */
const ATT = FIELDS.attendanceLogs;
const DRIVER_ATTENDANCE = "driver_attendance";
const HOME_BANNERS = "home_banners";
const DRIVER_HOME_BANNERS = "driver_home_banners";
const DRIVER_GROUP_MEMBERS = "driver_group_members";
const WEEK_PROGRESS_STATUSES = new Set(["in_transit", "pending", "under_review", "verified"]);

/**
 * Fleet-wide configuration scans. These still bound the cold fill of the
 * `config-cache` entries, so they stay generous on purpose.
 */
const SCAN = 2_000;
/**
 * Per-rider history pages. These were a fleet-size guard copied onto a query
 * that is already filtered to one `driver_id`, so 2000 meant "read the rider's
 * whole session history on every Home call".
 */
const SESSION_SCAN = 200;
/** An open session is the newest few rows, never the rider's history. */
const OPEN_SESSION_SCAN = 5;
/** Today's closed sessions: a handful of duty sessions, not the archive. */
const DAY_SESSION_SCAN = 20;
/** The rider's day rows, the fallback page for a non-string `attendance_date`. */
const ATTENDANCE_DAY_SCAN = 80;
/** A week is seven day rows; the ceiling only absorbs duplicates. */
const WEEK_DAY_SCAN = 40;
/** A week of one rider's deliveries. Any higher is a fleet number, not a weekly one. */
const WEEK_SCAN = 1_000;
/** `source_companies` is a small settings collection; that is what the cache holds. */
const SOURCE_COMPANY_SCAN = 500;


function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function asDay(value: unknown): string | null {
  const text = asString(value);
  return text ? text.slice(0, 10) : null;
}

function asDate(value: unknown): Date | null {
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function asBool(value: unknown): boolean {
  return value === true;
}

/** A compliance counter. A missing or non-numeric field is a zero. */
function asCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

/**
 * One measured step. The step emits its own `perf:"block"` Cloud Logging line
 * with the read count, and the totals still roll up into the handler's line.
 */
async function step<T>(name: string, fn: () => Promise<T>): Promise<T> {
  return (await measureBlock(name, fn)).result;
}

async function assignedRestaurantIds(driverId: string, driver: Dict): Promise<string[]> {
  const ids = new Set(driverRestaurantIds(driver));
  const snap = await getFirestore()
    .collection(COLLECTIONS.driverRestaurants)
    .where("driver_id", "==", driverId)
    .limit(SCAN)
    .get();
  for (const doc of snap.docs) {
    const restaurantId = asString((doc.data() ?? {})["restaurant_id"]);
    if (restaurantId) ids.add(restaurantId);
  }
  return [...ids];
}

/**
 * The whole `source_companies` collection, cached. It is a settings collection
 * that changes when a company is added, not per request, and the old code paid
 * one or two reads per Home call for a rider who has a company.
 */
const sourceCompanyCache = createConfigCache<Map<string, Dict>>();

async function loadSourceCompanyMap(): Promise<Map<string, Dict>> {
  const snap = await getFirestore()
    .collection(COLLECTIONS.sourceCompanies)
    .limit(SOURCE_COMPANY_SCAN)
    .get();
  const map = new Map<string, Dict>();
  for (const doc of snap.docs) {
    const raw = (doc.data() ?? {}) as Dict;
    map.set(doc.id, raw);
    const key = asString(raw["key"]);
    if (key) map.set(key, raw);
  }
  return map;
}

async function loadSourceCompany(key: string | null, configEpoch: number): Promise<Dict | null> {
  if (!key) return null;
  const map = await sourceCompanyCache
    .get(configEpoch, loadSourceCompanyMap)
    .catch(() => null);
  const cached = map?.get(key);
  if (cached) return cached;

  // The cached collection was capped or does not carry this key: one direct
  // read, exactly as before the cache existed.
  const db = getFirestore();
  const byId = await db.collection(COLLECTIONS.sourceCompanies).doc(key).get();
  if (byId.exists) return (byId.data() ?? {}) as Dict;
  const snap = await db
    .collection(COLLECTIONS.sourceCompanies)
    .where("key", "==", key)
    .limit(1)
    .get();
  if (snap.empty) return null;
  return (snap.docs[0].data() ?? {}) as Dict;
}

/**
 * User-plan hide: enabled company scheme that is not system `mg`.
 * SQL `company_config_applies` additionally requires outsourced + effective_from.
 */
async function companyHidesWeeklyIncentive(driver: Dict, configEpoch: number): Promise<boolean> {
  const key = asString(driver["source_company"]);
  if (!key || key === "mg") return false;
  const company = await loadSourceCompany(key, configEpoch);
  if (!company) return false;
  if (company["is_system"] === true) return false;
  return company["incentive_enabled"] === true;
}

/**
 * A rule's scope as the canonical matcher wants it: the legacy single-FK column
 * plus the junction rows. The Home card and the earnings RPC have to agree, so
 * both delegate to `ruleMatchesScope`.
 */
function scopedRuleOf(scopeType: string, raw: Dict): ScopedRule {
  const known: RuleScopeType =
    scopeType === "zone" || scopeType === "partner" || scopeType === "restaurant"
      ? scopeType
      : "restaurant";
  return {
    scope_type: known,
    zone_id: asString(raw["zone_id"]),
    partner_id: asString(raw["partner_id"]),
    restaurant_id: asString(raw["restaurant_id"]),
  };
}

function ruleMatchesDriver(args: {
  rule: ScopedRule;
  scopes: readonly RuleScope[];
  zoneId: string | null;
  partnerId: string | null;
  restaurantIds: readonly string[];
}): boolean {
  const { rule, scopes, zoneId, partnerId, restaurantIds } = args;
  if (rule.scope_type === "zone") {
    return ruleMatchesScope(rule, scopes, {
      zone_id: zoneId,
      partner_id: null,
      restaurant_id: null,
    });
  }
  if (rule.scope_type === "partner") {
    return ruleMatchesScope(rule, scopes, {
      zone_id: null,
      partner_id: partnerId,
      restaurant_id: null,
    });
  }
  return restaurantIds.some((id) =>
    ruleMatchesScope(rule, scopes, {
      zone_id: null,
      partner_id: null,
      restaurant_id: id,
    }),
  );
}

/**
 * The rider's newest session row.
 *
 * The ordered query is one read. It only misses documents that have no
 * `updated_at`, which is why the bounded scan stays as a fallback rather than
 * being deleted — and why the ordered path is wrapped: a composite index that
 * is not deployed yet throws instead of returning nothing.
 */
async function latestSession(driverId: string): Promise<Dict | null> {
  const db = getFirestore();
  try {
    const ordered = await db
      .collection(COLLECTIONS.driverSessions)
      .where("driver_id", "==", driverId)
      .orderBy("updated_at", "desc")
      .limit(1)
      .get();
    if (!ordered.empty) {
      const doc = ordered.docs[0];
      return { id: doc.id, ...((doc.data() ?? {}) as Dict) };
    }
  } catch {
    // Missing composite index (driver_id, updated_at desc) — use the scan.
  }
  return scanLatestSession(driverId);
}

async function scanLatestSession(driverId: string): Promise<Dict | null> {
  const snap = await getFirestore()
    .collection(COLLECTIONS.driverSessions)
    .where("driver_id", "==", driverId)
    .limit(SESSION_SCAN)
    .get();
  let best: Dict | null = null;
  let bestAt = -1;
  for (const doc of snap.docs) {
    const raw = (doc.data() ?? {}) as Dict;
    const at =
      asDate(raw["updated_at"])?.getTime() ??
      asDate(raw["created_at"])?.getTime() ??
      0;
    if (at >= bestAt) {
      bestAt = at;
      best = { id: doc.id, ...raw };
    }
  }
  return best;
}

async function openOnlineSession(driverId: string): Promise<{ id: string; data: Dict } | null> {
  const snap = await getFirestore()
    .collection(COLLECTIONS.driverSessions)
    .where("driver_id", "==", driverId)
    .where("is_online", "==", true)
    // Two equality filters need no composite index; the newest open row is
    // picked in memory so a duplicated open session still resolves correctly.
    .limit(OPEN_SESSION_SCAN)
    .get();
  let best: { id: string; data: Dict } | null = null;
  let bestAt = -1;
  for (const doc of snap.docs) {
    const data = (doc.data() ?? {}) as Dict;
    const at = asDate(data["created_at"])?.getTime() ?? asDate(data["went_online_at"])?.getTime() ?? 0;
    if (at >= bestAt) {
      bestAt = at;
      best = { id: doc.id, data };
    }
  }
  return best;
}

async function attendanceLogOn(driverId: string, day: string): Promise<{ id: string; data: Dict } | null> {
  const snap = await getFirestore()
    .collection(COLLECTIONS.attendanceLogs)
    .where("driver_id", "==", driverId)
    .where("log_date", "==", day)
    .limit(1)
    .get();
  if (snap.empty) return null;
  return { id: snap.docs[0].id, data: (snap.docs[0].data() ?? {}) as Dict };
}

/**
 * The rider's day row.
 *
 * The direct day query is the whole answer in the normal case: rows are written
 * with a `YYYY-MM-DD` string. The rider page only runs when that query finds
 * nothing — which is exactly the case it exists for, a row whose
 * `attendance_date` was stored as a Timestamp. The equality filter cannot match
 * such a row, but `pickAttendanceDayRow` still can.
 */
async function attendanceDayOn(driverId: string, day: string): Promise<{ id: string; data: Dict } | null> {
  const db = getFirestore();
  const byString = await db
    .collection(DRIVER_ATTENDANCE)
    .where("driver_id", "==", driverId)
    .where("attendance_date", "==", day)
    .limit(10)
    .get();
  const rows = new Map<string, { id: string; data: Dict }>();
  for (const doc of byString.docs) {
    rows.set(doc.id, { id: doc.id, data: (doc.data() ?? {}) as Dict });
  }
  const picked = pickAttendanceDayRow([...rows.values()], day);
  if (picked) return picked;

  const scanned = await db
    .collection(DRIVER_ATTENDANCE)
    .where("driver_id", "==", driverId)
    .limit(ATTENDANCE_DAY_SCAN)
    .get();
  for (const doc of scanned.docs) {
    rows.set(doc.id, { id: doc.id, data: (doc.data() ?? {}) as Dict });
  }
  return pickAttendanceDayRow([...rows.values()], day);
}

async function locationOf(driverId: string): Promise<Dict> {
  const db = getFirestore();
  const byId = await db.collection(COLLECTIONS.driverLocations).doc(driverId).get();
  if (byId.exists) return (byId.data() ?? {}) as Dict;
  const snap = await db
    .collection(COLLECTIONS.driverLocations)
    .where("driver_id", "==", driverId)
    .limit(1)
    .get();
  return snap.empty ? {} : ((snap.docs[0].data() ?? {}) as Dict);
}

/**
 * The week's approved earning credits.
 *
 * An aggregate bills as one read per 1000 matched index entries instead of one
 * read per returned document, which is the difference between ~1 read and a
 * rider's whole week of wallet entries. `Query.sum()` is not in this SDK
 * version (`@google-cloud/firestore` 7.x), so the aggregate is spelled with
 * `aggregate({ total: AggregateField.sum(...) })`. If the aggregate cannot be
 * served (index not deployed) the bounded scan runs instead, so the number on
 * screen is never wrong just because the index is late.
 */
async function weekEarnings(driverId: string, weekStart: string, today: string): Promise<number> {
  const range = (col: ReturnType<Firestore["collection"]>) =>
    col
      .where("driver_id", "==", driverId)
      .where("entry_type", "==", "earning_credit")
      .where("status", "==", "approved")
      .where("earn_date", ">=", weekStart)
      .where("earn_date", "<=", today);

  const col = getFirestore().collection(COLLECTIONS.driverWalletEntries);
  try {
    const snap = await range(col)
      .aggregate({ total: AggregateField.sum("amount_kwd") })
      .get();
    const total = snap.data().total;
    if (total === null) return 0;
    if (typeof total === "number" && Number.isFinite(total)) {
      return Math.round(total * 1000) / 1000;
    }
  } catch {
    // Fall through to the scan.
  }

  const scanned = await getFirestore()
    .collection(COLLECTIONS.driverWalletEntries)
    .where("driver_id", "==", driverId)
    .where("earn_date", ">=", weekStart)
    .where("earn_date", "<=", today)
    .limit(WEEK_SCAN)
    .get();
  let sum = 0;
  for (const doc of scanned.docs) {
    const raw = (doc.data() ?? {}) as Dict;
    if (raw["status"] !== "approved") continue;
    if (raw["entry_type"] !== "earning_credit") continue;
    sum += numberOrNull(raw["amount_kwd"]) ?? 0;
  }
  return Math.round(sum * 1000) / 1000;
}

function deliveryDay(raw: Dict): string | null {
  const shift = asDay(raw["shift_date"]);
  if (shift) return shift;
  const at = asDate(raw["delivered_at"]) ?? asDate(raw["pickup_at"]);
  return at ? kuwaitDayString(at) : asDay(raw["delivered_day"]) ?? asDay(raw["created_day"]);
}

/**
 * The week's in-progress + verified deliveries.
 *
 * One `count()` aggregate — billed as one read per 1000 index entries matched —
 * replaces two range scans that pulled the rider's whole week twice and then
 * deduped the second copy away.
 *
 * Measured on the live collection before making this change
 * (`scripts/check-delivery-day-fields.mts`): all **266,908** deliveries carry
 * `shift_date`, and `deliveryDay()` prefers `shift_date`, so the aggregate
 * returns exactly the set the two scans used to build. It also explains why the
 * second scan was pure cost: only 2,064 rows have `delivered_day` at all, and
 * every one of them also has `shift_date`, so each was dropped as a duplicate.
 *
 * The two scans are kept as the fallback for the one case an aggregate cannot
 * answer — a legacy or imported row with no `shift_date`. They run only when the
 * aggregate returns zero, which is itself cheap (a query that matches nothing is
 * not billed), so the normal call never pays for them.
 */
async function weekDeliveryCount(driverId: string, weekStart: string, today: string): Promise<number> {
  try {
    const snap = await getFirestore()
      .collection(COLLECTIONS.deliveries)
      .where("driver_id", "==", driverId)
      .where("status", "in", [...WEEK_PROGRESS_STATUSES])
      .where("shift_date", ">=", weekStart)
      .where("shift_date", "<=", today)
      .count()
      .get();
    const count = snap.data().count;
    if (typeof count === "number" && Number.isFinite(count) && count > 0) return count;
  } catch {
    // Missing composite index (driver_id, status, shift_date) — use the scans.
  }
  return weekDeliveryCountByScan(driverId, weekStart, today);
}

async function weekDeliveryCountByScan(
  driverId: string,
  weekStart: string,
  today: string,
): Promise<number> {
  const db = getFirestore();
  const [byShift, byDelivered] = await Promise.all([
    db
      .collection(COLLECTIONS.deliveries)
      .where("driver_id", "==", driverId)
      .where("shift_date", ">=", weekStart)
      .where("shift_date", "<=", today)
      .limit(WEEK_SCAN)
      .get(),
    db
      .collection(COLLECTIONS.deliveries)
      .where("driver_id", "==", driverId)
      .where("delivered_day", ">=", weekStart)
      .where("delivered_day", "<=", today)
      .limit(WEEK_SCAN)
      .get(),
  ]);
  const seen = new Set<string>();
  let count = 0;
  for (const snap of [byShift, byDelivered]) {
    for (const doc of snap.docs) {
      if (seen.has(doc.id)) continue;
      seen.add(doc.id);
      const raw = (doc.data() ?? {}) as Dict;
      const status = asString(raw["status"]);
      if (!status || !WEEK_PROGRESS_STATUSES.has(status)) continue;
      const day = deliveryDay(raw);
      if (!day || day < weekStart || day > today) continue;
      count += 1;
    }
  }
  return count;
}

type WeekCompliance = { invalid_days: number; rejected_orders: number; cancelled_orders: number };

/**
 * `rider_compliance_daily/{driverId}_{day}` summed over the Kuwait week.
 *
 * Operations upload this after the week is over, so a missing collection or an
 * empty week is a zero rather than an error — the rider sees 0, not a failed Home.
 */
async function weekCompliance(
  driverId: string,
  weekStart: string,
  today: string,
): Promise<WeekCompliance> {
  const empty: WeekCompliance = { invalid_days: 0, rejected_orders: 0, cancelled_orders: 0 };
  try {
    const days = kuwaitDayRange(weekStart, today);
    if (days.length === 0) return empty;
    const col = getFirestore().collection(COLLECTIONS.riderComplianceDaily);
    const snaps = await getFirestore().getAll(
      ...days.map((day) => col.doc(`${driverId}_${day}`)),
    );
    const totals: WeekCompliance = { ...empty };
    for (const snap of snaps) {
      if (!snap.exists) continue;
      const raw = (snap.data() ?? {}) as Dict;
      totals.invalid_days += asCount(raw["invalid_days"]);
      totals.rejected_orders += asCount(raw["rejected_orders"]);
      totals.cancelled_orders += asCount(raw["cancelled_orders"]);
    }
    return totals;
  } catch {
    return empty;
  }
}

/**
 * Online seconds for the Kuwait week.
 *
 * The week range is the whole answer in the normal case — rows are written with
 * a `YYYY-MM-DD` string — which turns an 80-document rider page into about
 * seven. The page still runs when the range finds nothing, because a
 * `Timestamp`-valued `attendance_date` cannot match a string range and the
 * in-memory day test can still read it.
 */
async function weekOnlineSeconds(
  driverId: string,
  weekStart: string,
  today: string,
  now: Date,
): Promise<number> {
  const db = getFirestore();
  let rows: readonly { data(): unknown }[] = [];
  try {
    const ranged = await db
      .collection(DRIVER_ATTENDANCE)
      .where("driver_id", "==", driverId)
      .where("attendance_date", ">=", weekStart)
      .where("attendance_date", "<=", today)
      .limit(WEEK_DAY_SCAN)
      .get();
    rows = ranged.docs;
  } catch {
    rows = [];
  }
  if (rows.length === 0) {
    const scanned = await db
      .collection(DRIVER_ATTENDANCE)
      .where("driver_id", "==", driverId)
      .limit(ATTENDANCE_DAY_SCAN)
      .get();
    rows = scanned.docs;
  }

  let seconds = 0;
  for (const doc of rows) {
    const raw = (doc.data() ?? {}) as Dict;
    const day = attendanceDateKey(raw["attendance_date"]);
    if (!day || day < weekStart || day > today) continue;
    seconds += Math.max(0, Math.trunc(numberOrNull(raw["online_seconds"]) ?? 0));
  }
  const open = await openOnlineSession(driverId);
  const wentOnline = open ? asDate(open.data["went_online_at"]) : null;
  if (wentOnline && kuwaitDayString(wentOnline) === today) {
    seconds += Math.max(0, Math.floor((now.getTime() - wentOnline.getTime()) / 1000));
  }
  return seconds;
}

async function performanceCounts(driverId: string): Promise<Dict> {
  const col = getFirestore().collection(COLLECTIONS.deliveries).where("driver_id", "==", driverId);
  const [all, cancelled, verified, pending, inTransit, rejected] = await Promise.all([
    col.count().get(),
    col.where("status", "==", "cancelled").count().get(),
    col.where("status", "==", "verified").count().get(),
    col.where("status", "==", "pending").count().get(),
    col.where("status", "==", "in_transit").count().get(),
    col.where("status", "==", "rejected").count().get(),
  ]);
  return {
    total_deliveries: Math.max(0, all.data().count - cancelled.data().count),
    verified_deliveries: verified.data().count,
    pending_deliveries: pending.data().count + inTransit.data().count,
    rejected_deliveries: rejected.data().count,
  };
}

function deliveryRuleSummary(scopeType: string, name: string, restaurantName: string | null): string {
  if (scopeType === "restaurant" && restaurantName) {
    return `Verified deliveries from ${restaurantName} count toward incentives`;
  }
  if (scopeType === "partner") {
    return "Verified deliveries for this partner count toward incentives";
  }
  if (scopeType === "zone") {
    return "Verified deliveries in your zone count toward incentives";
  }
  return name;
}

type DeliveryRuleConfig = {
  rules: Array<{ id: string; raw: Dict; priority: number; name: string }>;
  scopesByRule: Map<string, RuleScope[]>;
  restaurantNames: Map<string, string>;
};

const deliveryRuleCache = createConfigCache<DeliveryRuleConfig>();

/**
 * Every active delivery rule, every scope, and the name of each restaurant the
 * scopes point at — one cached fleet-wide snapshot.
 *
 * This was the single most expensive read in the app: two unbounded collection
 * scans plus a `getAll` of up to 300 restaurants on every rider's every Home
 * call. The per-rider part (is today inside the rule window, does the scope
 * match this rider) runs against the cached rows and costs no reads at all.
 */
async function loadDeliveryRuleConfig(): Promise<DeliveryRuleConfig> {
  const db = getFirestore();
  const rulesSnap = await db
    .collection(COLLECTIONS.deliveryRules)
    .where("status", "==", "active")
    .limit(SCAN)
    .get();
  const rules: Array<{ id: string; raw: Dict; priority: number; name: string }> = [];
  for (const doc of rulesSnap.docs) {
    const raw = (doc.data() ?? {}) as Dict;
    rules.push({
      id: doc.id,
      raw,
      priority: numberOrNull(raw["priority"]) ?? 0,
      name: asString(raw["name"]) ?? "",
    });
  }
  if (rules.length === 0) {
    return { rules, scopesByRule: new Map(), restaurantNames: new Map() };
  }

  const scopesSnap = await db.collection(COLLECTIONS.deliveryRuleScopes).limit(SCAN).get();
  const scopesByRule = new Map<string, RuleScope[]>();
  const restaurantIds = new Set<string>();
  for (const doc of scopesSnap.docs) {
    const raw = (doc.data() ?? {}) as Dict;
    const ruleId = asString(raw["delivery_rule_id"]);
    if (!ruleId) continue;
    const scope: RuleScope = {
      zone_id: asString(raw["zone_id"]),
      partner_id: asString(raw["partner_id"]),
      restaurant_id: asString(raw["restaurant_id"]),
    };
    if (scope.restaurant_id) restaurantIds.add(scope.restaurant_id);
    scopesByRule.set(ruleId, [...(scopesByRule.get(ruleId) ?? []), scope]);
  }

  const restaurantNames = new Map<string, string>();
  if (restaurantIds.size > 0) {
    const snaps = await db.getAll(
      ...[...restaurantIds].slice(0, 300).map((id) => db.collection(COLLECTIONS.restaurants).doc(id)),
    );
    for (const snap of snaps) {
      if (snap.exists) restaurantNames.set(snap.id, asString((snap.data() ?? {})["name"]) ?? "");
    }
  }
  return { rules, scopesByRule, restaurantNames };
}

function matchingDeliveryRules(
  config: DeliveryRuleConfig,
  args: {
    today: string;
    zoneId: string | null;
    partnerId: string | null;
    restaurantIds: readonly string[];
  },
): Dict[] {
  const matched = config.rules.filter((rule) => {
    const start = asDay(rule.raw["start_date"]) ?? "1970-01-01";
    const end = asDay(rule.raw["end_date"]) ?? "9999-12-31";
    return args.today >= start && args.today <= end;
  });
  if (matched.length === 0) return [];

  const scopesByRule = config.scopesByRule;
  const restaurantMap = config.restaurantNames;

  const rows: Array<Dict & { _priority: number; _name: string }> = [];
  for (const rule of matched) {
    const scopeType = asString(rule.raw["scope_type"]) ?? "restaurant";
    const scopes = scopesByRule.get(rule.id) ?? [];
    if (
      !ruleMatchesDriver({
        rule: scopedRuleOf(scopeType, rule.raw),
        scopes,
        zoneId: args.zoneId,
        partnerId: args.partnerId,
        restaurantIds: args.restaurantIds,
      })
    ) {
      continue;
    }
    const restaurantId =
      scopes.find((scope) => scope.restaurant_id)?.restaurant_id ??
      asString(rule.raw["restaurant_id"]) ??
      null;
    const restaurantName = restaurantId ? restaurantMap.get(restaurantId) ?? null : null;
    rows.push({
      id: rule.id,
      name: rule.name,
      scope_type: scopeType,
      restaurant_name: restaurantName,
      start_date: asDay(rule.raw["start_date"]),
      end_date: asDay(rule.raw["end_date"]),
      summary: deliveryRuleSummary(scopeType, rule.name, restaurantName),
      _priority: rule.priority,
      _name: rule.name,
    });
  }
  rows.sort((a, b) => b._priority - a._priority || a._name.localeCompare(b._name));
  return rows.map(({ _priority, _name, ...rest }) => {
    void _priority;
    void _name;
    return rest;
  });
}

type IncentiveCandidate = {
  id: string;
  raw: Dict;
  priority: number;
  createdAt: number;
  scopeType: string;
};

type IncentiveConfig = {
  candidates: IncentiveCandidate[];
  scopesByRule: Map<string, RuleScope[]>;
  tiersByRule: Map<string, IncentiveTier[]>;
};

const incentiveRuleCache = createConfigCache<IncentiveConfig>();

/**
 * Active weekly incentive rules with every scope and every tier. All three
 * collections are fleet-wide configuration, so they are read once per cache
 * fill instead of on every Home call — the old path re-scanned the scope
 * collection and then the tier collection for each requesting rider.
 */
async function loadIncentiveConfig(): Promise<IncentiveConfig> {
  const db = getFirestore();
  const rulesSnap = await db
    .collection(COLLECTIONS.incentiveRules)
    .where("status", "==", "active")
    .where("period", "==", "weekly")
    .limit(SCAN)
    .get();
  const candidates: IncentiveCandidate[] = [];
  for (const doc of rulesSnap.docs) {
    const raw = (doc.data() ?? {}) as Dict;
    candidates.push({
      id: doc.id,
      raw,
      priority: numberOrNull(raw["priority"]) ?? 0,
      createdAt: asDate(raw["created_at"])?.getTime() ?? 0,
      scopeType: asString(raw["scope_type"]) ?? "restaurant",
    });
  }
  if (candidates.length === 0) {
    return { candidates, scopesByRule: new Map(), tiersByRule: new Map() };
  }

  const [scopesSnap, tiersSnap] = await Promise.all([
    db.collection(COLLECTIONS.incentiveRuleScopes).limit(SCAN).get(),
    db.collection(COLLECTIONS.incentiveRuleTiers).limit(SCAN).get(),
  ]);

  const scopesByRule = new Map<string, RuleScope[]>();
  for (const doc of scopesSnap.docs) {
    const raw = (doc.data() ?? {}) as Dict;
    const ruleId = asString(raw["incentive_rule_id"]);
    if (!ruleId) continue;
    scopesByRule.set(ruleId, [
      ...(scopesByRule.get(ruleId) ?? []),
      {
        zone_id: asString(raw["zone_id"]),
        partner_id: asString(raw["partner_id"]),
        restaurant_id: asString(raw["restaurant_id"]),
      },
    ]);
  }

  const tiersByRule = new Map<string, IncentiveTier[]>();
  for (const doc of tiersSnap.docs) {
    const raw = (doc.data() ?? {}) as Dict;
    const ruleId = asString(raw["incentive_rule_id"]);
    if (!ruleId) continue;
    const tier: IncentiveTier = {
      threshold_deliveries: numberOrNull(raw["threshold_deliveries"]) ?? 0,
      reward_mode: (asString(raw["reward_mode"]) ?? "per_delivery") as IncentiveTier["reward_mode"],
      reward_kwd: numberOrNull(raw["reward_kwd"]),
      reward_per_delivery_kwd: numberOrNull(raw["reward_per_delivery_kwd"]),
    };
    tiersByRule.set(ruleId, [...(tiersByRule.get(ruleId) ?? []), tier]);
  }
  for (const tiers of tiersByRule.values()) {
    tiers.sort((a, b) => a.threshold_deliveries - b.threshold_deliveries);
  }
  return { candidates, scopesByRule, tiersByRule };
}

function primaryWeeklyIncentive(
  config: IncentiveConfig,
  args: {
    today: string;
    zoneId: string | null;
    partnerId: string | null;
    restaurantIds: readonly string[];
  },
): Dict | null {
  const candidates = config.candidates.filter((rule) => {
    const start = asDay(rule.raw["start_date"]) ?? "1970-01-01";
    const end = asDay(rule.raw["end_date"]) ?? "9999-12-31";
    return args.today >= start && args.today <= end;
  });
  if (candidates.length === 0) return null;

  const scopesByRule = config.scopesByRule;

  const matching = candidates.filter((rule) =>
    ruleMatchesDriver({
      rule: scopedRuleOf(rule.scopeType, rule.raw),
      scopes: scopesByRule.get(rule.id) ?? [],
      zoneId: args.zoneId,
      partnerId: args.partnerId,
      restaurantIds: args.restaurantIds,
    }),
  );
  matching.sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt);
  const picked = matching[0];
  if (!picked) return null;

  const tiers = config.tiersByRule.get(picked.id) ?? [];

  const targetMode = asString(picked.raw["target_mode"]) ?? "single";
  const target =
    targetMode === "tiered"
      ? Math.max(
          ...tiers.map((tier) => tier.threshold_deliveries),
          numberOrNull(picked.raw["base_minimum_deliveries"]) ?? 0,
        )
      : numberOrNull(picked.raw["target_deliveries"]) ?? 0;

  const rule: IncentiveRule = {
    id: picked.id,
    name: asString(picked.raw["name"]) ?? "—",
    period: "weekly",
    status: "active",
    start_date: asDay(picked.raw["start_date"]) ?? args.today,
    end_date: asDay(picked.raw["end_date"]) ?? args.today,
    priority: picked.priority,
    created_at: isoTimestamp(picked.raw["created_at"]) ?? "",
    scope_type: (picked.scopeType === "zone" || picked.scopeType === "partner"
      ? picked.scopeType
      : "restaurant") as IncentiveRule["scope_type"],
    target_mode: targetMode === "tiered" ? "tiered" : "single",
    base_minimum_deliveries: numberOrNull(picked.raw["base_minimum_deliveries"]),
    target_deliveries: numberOrNull(picked.raw["target_deliveries"]),
    reward_mode: (asString(picked.raw["reward_mode"]) ?? "per_delivery") as IncentiveRule["reward_mode"],
    reward_kwd: numberOrNull(picked.raw["reward_kwd"]),
    reward_per_delivery_kwd: numberOrNull(picked.raw["reward_per_delivery_kwd"]),
    payout_mode: (asString(picked.raw["payout_mode"]) ?? "per_tier") as IncentiveRule["payout_mode"],
    overrides_others: picked.raw["overrides_others"] === true,
    zone_id: asString(picked.raw["zone_id"]),
    partner_id: asString(picked.raw["partner_id"]),
    restaurant_id: asString(picked.raw["restaurant_id"]),
  };

  const computed =
    target > 0
      ? computeIncentiveAmount({ rule, tiers, eligibleCount: target, gateTarget: null })
      : 0;
  const reward = numberOrNull(picked.raw["reward_kwd"]) ?? computed;

  return {
    rule_id: picked.id,
    name: rule.name,
    eligible_count: 0,
    progress_count: 0,
    target,
    reward_kwd: reward,
    remaining_deliveries: Math.max(0, target),
    target_mode: targetMode,
    tiers: tiers.map((tier) => ({
      threshold: tier.threshold_deliveries,
      reward_kwd: tier.reward_kwd,
      reward_per_delivery_kwd: tier.reward_per_delivery_kwd,
      reward_mode: tier.reward_mode,
    })),
  };
}

async function shiftOnDate(driverId: string, day: string): Promise<ShiftRow | null> {
  const snap = await getFirestore()
    .collection(COLLECTIONS.driverDailyShifts)
    .where("driver_id", "==", driverId)
    .where("shift_date", "==", day)
    .limit(1)
    .get();
  if (snap.empty) return null;
  const raw = (snap.docs[0].data() ?? {}) as Dict;
  const driver = asString(raw["driver_id"]);
  const shiftDate = asDay(raw["shift_date"]);
  const session1Start = asString(raw["session1_start"]);
  const session1End = asString(raw["session1_end"]);
  if (!driver || !shiftDate || !session1Start || !session1End) return null;
  return {
    id: snap.docs[0].id,
    driver_id: driver,
    shift_date: shiftDate,
    shift_type: raw["shift_type"] === "split" ? "split" : "single",
    session1_start: session1Start,
    session1_end: session1End,
    session1_end_day_offset: numberOrNull(raw["session1_end_day_offset"]) ?? 0,
    session2_start: asString(raw["session2_start"]),
    session2_end: asString(raw["session2_end"]),
    session2_start_day_offset: numberOrNull(raw["session2_start_day_offset"]) ?? 0,
    session2_end_day_offset: numberOrNull(raw["session2_end_day_offset"]) ?? 0,
    submitted_at: raw["submitted_at"] ?? null,
  };
}

/**
 * Closed-session seconds credited to `day`.
 *
 * A session is attributed to the day it *started* (`kuwaitDayString(online)`),
 * exactly as before, so the range prefilter plus the in-memory day test is the
 * same answer with ~20 reads instead of the rider's whole history. The scan
 * stays for the case where the range query cannot be served.
 */
async function closedSessionSeconds(driverId: string, day: string): Promise<number> {
  const db = getFirestore();
  let rows: readonly { data(): unknown }[] = [];
  try {
    const snap = await db
      .collection(COLLECTIONS.driverSessions)
      .where("driver_id", "==", driverId)
      .where("went_online_at", ">=", Timestamp.fromDate(kuwaitDayStart(day)))
      .where("went_online_at", "<", Timestamp.fromDate(kuwaitDayEnd(day)))
      .limit(DAY_SESSION_SCAN)
      .get();
    rows = snap.docs;
  } catch {
    const snap = await db
      .collection(COLLECTIONS.driverSessions)
      .where("driver_id", "==", driverId)
      .limit(SESSION_SCAN)
      .get();
    rows = snap.docs;
  }

  let seconds = 0;
  for (const doc of rows) {
    const raw = ((doc.data() ?? {}) as Dict);
    const online = asDate(raw["went_online_at"]);
    const offline = asDate(raw["went_offline_at"]);
    if (!online || !offline) continue;
    if (kuwaitDayString(online) !== day) continue;
    seconds += Math.max(0, Math.floor((offline.getTime() - online.getTime()) / 1000));
  }
  return seconds;
}

async function todayOnlineFromSources(driverId: string, day: string): Promise<number> {
  const [dayRow, sessionSeconds] = await Promise.all([
    attendanceDayOn(driverId, day),
    closedSessionSeconds(driverId, day),
  ]);
  const stored = dayRow ? Math.trunc(numberOrNull(dayRow.data["online_seconds"]) ?? 0) : 0;
  return mergeTodayOnlineSeconds(stored, sessionSeconds);
}

async function shiftAdherence(driverId: string, today: string): Promise<Dict> {
  const shift = await shiftOnDate(driverId, today);
  if (!shift) {
    return { online_seconds: await todayOnlineFromSources(driverId, today) };
  }

  const s1Start = parseShiftTime(shift.session1_start);
  const s1End = parseShiftTime(shift.session1_end);
  if (!s1Start || !s1End) return {};

  const scheduledStart = shiftSessionInstant(shift.shift_date, s1Start, 0);
  let scheduledEnd = shiftSessionInstant(shift.shift_date, s1End, shift.session1_end_day_offset);
  if (shift.shift_type === "split" && shift.session2_end) {
    const s2End = parseShiftTime(shift.session2_end);
    if (s2End) {
      scheduledEnd = shiftSessionInstant(
        shift.shift_date,
        s2End,
        shift.session2_end_day_offset,
      );
    }
  }

  const [log, dayRow, settings, sessionSeconds] = await Promise.all([
    attendanceLogOn(driverId, today),
    attendanceDayOn(driverId, today),
    loadAppSettings(),
    closedSessionSeconds(driverId, today),
  ]);

  let actualIn = log ? asDate(log.data["check_in_at"]) : null;
  const actualOut = log ? asDate(log.data["check_out_at"]) : null;
  if (!actualIn) actualIn = dayRow ? asDate(dayRow.data["first_online_at"]) : null;

  const storedOnline = dayRow ? Math.trunc(numberOrNull(dayRow.data["online_seconds"]) ?? 0) : 0;
  const onlineSeconds = Math.max(storedOnline, sessionSeconds);
  const scheduledSeconds = Math.max(
    0,
    Math.floor((scheduledEnd.getTime() - scheduledStart.getTime()) / 1000),
  );
  const grace = settings.attendance_late_grace_minutes;

  let minutesLate = 0;
  if (actualIn) {
    minutesLate = Math.max(
      0,
      Math.floor((actualIn.getTime() - scheduledStart.getTime()) / 60_000) - grace,
    );
  }

  let minutesEarlyOut = 0;
  if (actualOut) {
    const clampedOut = actualOut.getTime() < scheduledStart.getTime() ? scheduledStart : actualOut;
    minutesEarlyOut = Math.min(
      Math.max(0, Math.floor((scheduledEnd.getTime() - clampedOut.getTime()) / 60_000)),
      Math.floor(scheduledSeconds / 60),
    );
  }

  return {
    scheduled_start_at: scheduledStart.toISOString(),
    scheduled_end_at: scheduledEnd.toISOString(),
    actual_in_at: actualIn ? actualIn.toISOString() : null,
    actual_out_at: actualOut ? actualOut.toISOString() : null,
    minutes_late: minutesLate,
    minutes_early_out: minutesEarlyOut,
    online_seconds: onlineSeconds,
    scheduled_seconds: scheduledSeconds,
  };
}

function bannerWindowOk(raw: Dict, now: Date): boolean {
  if (raw["is_active"] !== true) return false;
  const starts = asDate(raw["starts_at"]);
  const ends = asDate(raw["ends_at"]);
  if (starts && starts.getTime() > now.getTime()) return false;
  if (ends && ends.getTime() < now.getTime()) return false;
  return true;
}

function listIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

type BannerRow = { id: string; raw: Dict };

/**
 * Both banner collections in one cached snapshot. The date window and the
 * zone / partner / group targeting stay per call because they depend on the
 * requesting rider and on `now`; only the two collection scans are shared.
 */
const bannerCache = createConfigCache<BannerRow[]>();

async function loadBannerConfig(): Promise<BannerRow[]> {
  const db = getFirestore();
  const [home, driverHome] = await Promise.all([
    db.collection(HOME_BANNERS).limit(200).get().catch(() => null),
    db.collection(DRIVER_HOME_BANNERS).limit(200).get().catch(() => null),
  ]);
  const rows: BannerRow[] = [];
  for (const snap of [home, driverHome]) {
    if (!snap) continue;
    for (const doc of snap.docs) rows.push({ id: doc.id, raw: (doc.data() ?? {}) as Dict });
  }
  return rows;
}

function pickBanner(
  rows: readonly BannerRow[],
  memberGroups: ReadonlySet<string>,
  zoneId: string | null,
  partnerId: string | null,
  now: Date,
): Dict | null {
  const candidates: Array<{ id: string; raw: Dict; sort: number; created: number }> = [];
  for (const row of rows) {
    const raw = row.raw;
    if (!bannerWindowOk(raw, now)) continue;
    const zones = listIds(raw["zone_ids"]);
    const partners = listIds(raw["partner_ids"]);
    const groupIds = listIds(raw["driver_group_ids"]);
    if (zones.length > 0 && (!zoneId || !zones.includes(zoneId))) continue;
    if (partners.length > 0 && (!partnerId || !partners.includes(partnerId))) continue;
    if (groupIds.length > 0 && !groupIds.some((id) => memberGroups.has(id))) continue;
    candidates.push({
      id: row.id,
      raw,
      sort: numberOrNull(raw["sort_order"]) ?? 0,
      created: asDate(raw["created_at"])?.getTime() ?? 0,
    });
  }
  candidates.sort((a, b) => a.sort - b.sort || b.created - a.created);
  const first = candidates[0];
  if (!first) return null;
  return {
    id: first.id,
    image_url: asString(first.raw["image_url"]),
    caption_en: asString(first.raw["caption_en"]),
    caption_ar: asString(first.raw["caption_ar"]),
    deep_link: asString(first.raw["deep_link"]),
  };
}

async function loadBanner(
  driverId: string,
  zoneId: string | null,
  partnerId: string | null,
  now: Date,
  configEpoch: number,
): Promise<Dict | null> {
  const db = getFirestore();
  const [rows, groups] = await Promise.all([
    bannerCache.get(configEpoch, loadBannerConfig).catch(() => [] as BannerRow[]),
    db
      .collection(DRIVER_GROUP_MEMBERS)
      .where("driver_id", "==", driverId)
      .limit(200)
      .get()
      .catch(() => null),
  ]);
  const memberGroups = new Set<string>();
  if (groups) {
    for (const doc of groups.docs) {
      const groupId = asString((doc.data() ?? {})["group_id"]);
      if (groupId) memberGroups.add(groupId);
    }
  }
  return pickBanner(rows, memberGroups, zoneId, partnerId, now);
}

/**
 * Everything the Home payload needs that is *not* fleet-wide config.
 *
 * The same record is produced by the 25-document source path and read back from
 * `driver_home_daily`. Rule matching, the weekly incentive and the banner stay
 * per call against the config cache, which is why the snapshot stores values
 * and not the response: a rule edit is never hidden by a snapshot.
 */
export type HomeSourceValues = {
  today: string;
  weekStart: string;
  zoneId: string | null;
  partnerId: string | null;
  restaurantIds: string[];
  forceAppUpdate: boolean;
  forceMin: number | null;
  partnerName: string | null;
  partnerLogoUrl: string | null;
  sessionOnline: boolean;
  wentOnlineAt: string | null;
  openSince: string | null;
  speedMps: number | null;
  distanceTodayMeters: number;
  earnings: number;
  deliveries: number;
  onlineSeconds: number;
  /** Today's closed-session seconds. The live open interval is added at read time. */
  elapsedBaseSeconds: number;
  performance: Dict;
  /** `shift_adherence` without `online_seconds` — that number is derived per call. */
  adherence: Dict;
  compliance: WeekCompliance;
};

/**
 * The 25-document path, as one value record.
 *
 * Every read here is the same read the deployed response already made; the only
 * change is that the result is returned as data instead of being assembled into
 * the wire payload inline, so the snapshot writer and the RPC share it.
 */
async function loadHomeSourceValues(args: {
  uid: string;
  driver: Dict;
  profile: Dict;
  now: Date;
  configEpoch: number;
  today?: string;
}): Promise<HomeSourceValues> {
  const now = args.now;
  const today = args.today ?? kuwaitDayString(now);
  const weekStart = kuwaitWeekStart(today);
  const zoneId = asString(args.driver["zone_id"]);
  const partnerId = asString(args.driver["partner_id"]);
  const forceAt = args.driver["force_app_update_at"];
  const forceMin = numberOrNull(args.driver["force_app_update_min_code"]);

  const restaurantIds = await step("home.assignedRestaurants", () =>
    assignedRestaurantIds(args.uid, args.driver),
  );

  const [
    partnerSnap,
    session,
    location,
    earnings,
    deliveries,
    onlineSeconds,
    performance,
    adherence,
    compliance,
  ] = await withReadDeadline(
    Promise.all([
    partnerId
      ? step("home.partner", () =>
          getFirestore().collection(COLLECTIONS.partners).doc(partnerId).get(),
        )
      : Promise.resolve(null),
    step("home.latestSession", () => latestSession(args.uid)),
    step("home.location", () => locationOf(args.uid)),
    step("home.weekEarnings", () => weekEarnings(args.uid, weekStart, today)),
    step("home.weekDeliveries", () => weekDeliveryCount(args.uid, weekStart, today)),
    step("home.weekOnlineSeconds", () => weekOnlineSeconds(args.uid, weekStart, today, now)),
    step("home.performanceCounts", () => performanceCounts(args.uid)),
    step("home.shiftAdherence", () => shiftAdherence(args.uid, today)),
    step("home.weekCompliance", () => weekCompliance(args.uid, weekStart, today)),
    ]),
    HOME_READ_TIMEOUT_MS,
    "home_sources",
  );

  const partner = partnerSnap?.exists ? ((partnerSnap.data() ?? {}) as Dict) : {};
  const sessionOnline = session ? asBool(session["is_online"]) : false;
  const wentOnlineAt = session ? (isoTimestamp(session["went_online_at"]) ?? null) : null;
  const { online_seconds: elapsedBase, ...adherenceRest } = adherence;

  return {
    today,
    weekStart,
    zoneId,
    partnerId,
    restaurantIds,
    forceAppUpdate: forceAt != null && forceMin !== null,
    forceMin,
    partnerName: asString(partner["name"]),
    partnerLogoUrl: asString(partner["logo_url"]),
    sessionOnline,
    wentOnlineAt,
    openSince: sessionOnline ? wentOnlineAt : null,
    speedMps: numberOrNull(location["speed_mps"]),
    distanceTodayMeters: numberOrNull(location["distance_today_meters"]) ?? 0,
    earnings,
    deliveries,
    onlineSeconds,
    elapsedBaseSeconds: Math.max(0, Math.trunc(numberOrNull(elapsedBase) ?? 0)),
    performance,
    adherence: adherenceRest,
    compliance,
  };
}

/**
 * Rule / incentive / banner — all three are served from the config cache, so
 * this costs one `driver_group_members` query at most on a warm isolate.
 */
async function decorateHomeValues(args: {
  uid: string;
  driver: Dict;
  values: HomeSourceValues;
  configEpoch: number;
  now: Date;
}): Promise<{ rules: Dict[]; incentive: Dict | null; banner: Dict | null }> {
  const { values } = args;
  const hideWeekly = await step("home.companyIncentive", () =>
    companyHidesWeeklyIncentive(args.driver, args.configEpoch),
  );
  const [ruleConfig, incentiveConfig, banner] = await Promise.all([
    step("home.deliveryRules", () => deliveryRuleCache.get(args.configEpoch, loadDeliveryRuleConfig)),
    hideWeekly
      ? Promise.resolve(null)
      : step("home.incentiveRules", () => incentiveRuleCache.get(args.configEpoch, loadIncentiveConfig)),
    step("home.banner", () =>
      loadBanner(args.uid, values.zoneId, values.partnerId, args.now, args.configEpoch),
    ),
  ]);

  const rules = matchingDeliveryRules(ruleConfig, {
    today: values.today,
    zoneId: values.zoneId,
    partnerId: values.partnerId,
    restaurantIds: values.restaurantIds,
  });
  const incentive = incentiveConfig
    ? primaryWeeklyIncentive(incentiveConfig, {
        today: values.today,
        zoneId: values.zoneId,
        partnerId: values.partnerId,
        restaurantIds: values.restaurantIds,
      })
    : null;

  return { rules, incentive, banner };
}


/** `elapsed_base + (now - open_since)` — the total is never stored. */
export function liveOpenSeconds(openSince: string | null, today: string, now: Date): number {
  if (!openSince) return 0;
  const at = new Date(openSince);
  if (Number.isNaN(at.getTime())) return 0;
  if (kuwaitDayString(at) !== today) return 0;
  return Math.max(0, Math.floor((now.getTime() - at.getTime()) / 1000));
}

/**
 * Assemble the wire payload.
 *
 * One implementation for both read paths, so a snapshot response and a source
 * response cannot drift into different shapes — which is exactly what the
 * shadow week is looking for.
 */
function composeHomePayload(args: {
  driver: Dict;
  profile: Dict;
  values: HomeSourceValues;
  rules: Dict[];
  incentive: Dict | null;
  banner: Dict | null;
  configEpoch: number;
  now: Date;
  snapshotAgeMs: number | null;
}): Dict {
  const v = args.values;
  // Closed sessions only. Every app build adds the open interval itself, so a
  // summed value here double counts the open session on Home.
  const todayOnlineSeconds = v.elapsedBaseSeconds;
  return {
    driver: {
      full_name: asString(args.profile["full_name"]) ?? "Driver",
      is_on_duty: asBool(args.driver["is_on_duty"]),
      partner_name: v.partnerName,
      partner_logo_url: v.partnerLogoUrl,
    },
    session: {
      is_online: v.sessionOnline,
      went_online_at: v.wentOnlineAt,
      speed_mps: v.speedMps,
      distance_today_meters: v.distanceTodayMeters,
      // The two fields the client needs to keep the timer ticking without a
      // call. `today_online_seconds` below carries the same base, not the sum.
      online_seconds_base: v.elapsedBaseSeconds,
      open_since: v.openSince,
    },
    week: {
      start_date: v.weekStart,
      end_date: v.today,
      earnings_kwd: v.earnings,
      deliveries_count: v.deliveries,
      online_seconds: v.onlineSeconds,
      invalid_days: v.compliance.invalid_days,
      rejected_orders: v.compliance.rejected_orders,
      cancelled_orders: v.compliance.cancelled_orders,
    },
    primary_weekly_incentive: args.incentive,
    delivery_rules: args.rules,
    shift_adherence: { ...v.adherence, online_seconds: todayOnlineSeconds },
    today_online_seconds: todayOnlineSeconds,
    performance: v.performance,
    banner: args.banner,
    force_app_update: v.forceAppUpdate,
    force_app_update_min_code: v.forceMin,
    // Step 2: the two fields the phone cache keys on.
    config_epoch: args.configEpoch,
    server_day: v.today,
    /** `null` when the response came from source. */
    snapshot_age_ms: args.snapshotAgeMs,
  };
}


/**
 * The Home snapshot — `driver_home_daily/{driverId}_{shiftDate}`.
 *
 * A snapshot is only ever a cache of values that have a source: every field is
 * recomputed by `rebuildDriverHomeDaily`, never incremented. The read path
 * serves it only when it is fresh, on the same shift day, and about the same
 * zone/partner the driver document currently says — a zone move is an admin
 * write that no rider action would otherwise notice.
 */
const HOME_SNAPSHOT_VERSION = 1;
/** Older than this and the RPC pays the source path instead of showing stale numbers. */
const HOME_SNAPSHOT_MAX_AGE_MS = 30 * 60 * 1000;
/** Writers may call the rebuild freely; the recompute itself is the expensive part. */
const HOME_SNAPSHOT_REBUILD_MIN_MS = 10 * 60 * 1000;
/** One hung read must not hold eight concurrent riders. */
const HOME_READ_TIMEOUT_MS = 8_000;

export function homeSnapshotId(driverId: string, day: string): string {
  return `${driverId}_${day}`;
}

function snapshotAgeMs(raw: Dict, now: Date): number | null {
  const ms = numberOrNull(raw["updated_at_ms"]);
  return ms === null ? null : now.getTime() - ms;
}

export function snapshotFresh(raw: Dict, today: string, now: Date, driver: Dict): boolean {
  if (numberOrNull(raw["schema_version"]) !== HOME_SNAPSHOT_VERSION) return false;
  if (raw["stale"] === true) return false;
  if (asDay(raw["shift_date"]) !== today) return false;
  const age = snapshotAgeMs(raw, now);
  if (age === null || age < -60_000 || age > HOME_SNAPSHOT_MAX_AGE_MS) return false;
  if (asString(raw["zone_id"]) !== asString(driver["zone_id"])) return false;
  if (asString(raw["partner_id"]) !== asString(driver["partner_id"])) return false;
  return true;
}

/** One read, raced against a deadline; any failure is a cache miss. */
async function readHomeSnapshot(
  driverId: string,
  today: string,
  now: Date,
): Promise<{ raw: Dict; ageMs: number } | null> {
  try {
    const snap = await withReadDeadline(
      getFirestore()
        .collection(COLLECTIONS.driverHomeDaily)
        .doc(homeSnapshotId(driverId, today))
        .get(),
      HOME_READ_TIMEOUT_MS,
      "home_snapshot",
    );
    if (!snap.exists) return null;
    const raw = (snap.data() ?? {}) as Dict;
    return { raw, ageMs: Math.max(0, snapshotAgeMs(raw, now) ?? 0) };
  } catch {
    return null;
  }
}

/** The stored document, as the same value record the source path produces. */
function snapshotToValues(raw: Dict, driver: Dict): HomeSourceValues {
  const week = (raw["week"] ?? {}) as Dict;
  const session = (raw["session"] ?? {}) as Dict;
  const shift = (raw["shift_adherence"] ?? {}) as Dict;
  const partner = (raw["partner"] ?? {}) as Dict;
  const forceMin = numberOrNull(driver["force_app_update_min_code"]);
  const { online_seconds_base: elapsedBase, ...shiftRest } = shift;
  return {
    today: asDay(raw["shift_date"]) ?? "",
    weekStart: asDay(week["start_date"]) ?? "",
    zoneId: asString(raw["zone_id"]),
    partnerId: asString(raw["partner_id"]),
    restaurantIds: listIds(raw["restaurant_ids"]),
    forceAppUpdate: driver["force_app_update_at"] != null && forceMin !== null,
    forceMin,
    partnerName: asString(partner["name"]),
    partnerLogoUrl: asString(partner["logo_url"]),
    sessionOnline: asBool(session["is_online"]),
    wentOnlineAt: asString(session["went_online_at"]),
    openSince: asString(session["open_since"]),
    speedMps: numberOrNull(session["speed_mps"]),
    distanceTodayMeters: numberOrNull(session["distance_today_meters"]) ?? 0,
    earnings: numberOrNull(week["earnings_kwd"]) ?? 0,
    deliveries: numberOrNull(week["deliveries_count"]) ?? 0,
    onlineSeconds: numberOrNull(week["online_seconds"]) ?? 0,
    elapsedBaseSeconds: Math.max(0, Math.trunc(numberOrNull(elapsedBase) ?? 0)),
    performance: (raw["performance"] ?? {}) as Dict,
    adherence: shiftRest,
    compliance: {
      invalid_days: asCount(week["invalid_days"]),
      rejected_orders: asCount(week["rejected_orders"]),
      cancelled_orders: asCount(week["cancelled_orders"]),
    },
  };
}

/**
 * One `set` of the whole document. A rebuild never patches: a partial write is
 * how a snapshot starts disagreeing with its source.
 */
async function writeHomeSnapshot(
  driverId: string,
  values: HomeSourceValues,
  now: Date,
  reason: string,
): Promise<void> {
  if (values.today === "" || values.weekStart === "") return;
  await getFirestore()
    .collection(COLLECTIONS.driverHomeDaily)
    .doc(homeSnapshotId(driverId, values.today))
    .set({
      driver_id: driverId,
      shift_date: values.today,
      schema_version: HOME_SNAPSHOT_VERSION,
      zone_id: values.zoneId,
      partner_id: values.partnerId,
      partner: { name: values.partnerName, logo_url: values.partnerLogoUrl },
      restaurant_ids: values.restaurantIds,
      week: {
        start_date: values.weekStart,
        end_date: values.today,
        earnings_kwd: values.earnings,
        deliveries_count: values.deliveries,
        online_seconds: values.onlineSeconds,
        invalid_days: values.compliance.invalid_days,
        rejected_orders: values.compliance.rejected_orders,
        cancelled_orders: values.compliance.cancelled_orders,
      },
      performance: values.performance,
      session: {
        is_online: values.sessionOnline,
        went_online_at: values.wentOnlineAt,
        open_since: values.openSince,
        speed_mps: values.speedMps,
        distance_today_meters: values.distanceTodayMeters,
      },
      shift_adherence: {
        ...values.adherence,
        online_seconds_base: values.elapsedBaseSeconds,
      },
      // A freshly recomputed document is by definition not invalidated.
      stale: false,
      stale_reason: null,
      stale_at_ms: null,
      updated_at: Timestamp.fromDate(now),
      updated_at_ms: now.getTime(),
      reason,
    });
}

/** Field-by-field, so a shadow log names the number that disagreed. */
export function snapshotMismatchFields(
  snapshot: HomeSourceValues,
  source: HomeSourceValues,
): string[] {
  const fields: string[] = [];
  if (snapshot.deliveries !== source.deliveries) fields.push("week.deliveries_count");
  if (Math.abs(snapshot.earnings - source.earnings) > 0.001) fields.push("week.earnings_kwd");
  if (Math.abs(snapshot.onlineSeconds - source.onlineSeconds) > 120) fields.push("week.online_seconds");
  if (Math.abs(snapshot.elapsedBaseSeconds - source.elapsedBaseSeconds) > 120) {
    fields.push("today_online_seconds");
  }
  if (JSON.stringify(snapshot.performance) !== JSON.stringify(source.performance)) {
    fields.push("performance");
  }
  if (
    snapshot.compliance.invalid_days !== source.compliance.invalid_days ||
    snapshot.compliance.rejected_orders !== source.compliance.rejected_orders ||
    snapshot.compliance.cancelled_orders !== source.compliance.cancelled_orders
  ) {
    fields.push("week.compliance");
  }
  if (snapshot.sessionOnline !== source.sessionOnline) fields.push("session.is_online");
  if (snapshot.restaurantIds.length !== source.restaurantIds.length) fields.push("restaurant_ids");
  return fields;
}

/**
 * Shadow week: compute the source path as well and log only the fields that
 * disagree. It costs a second read pass, which is why it is a temporary flag and
 * not how the RPC normally runs.
 */
async function logSnapshotShadow(args: {
  uid: string;
  driver: Dict;
  profile: Dict;
  values: HomeSourceValues;
  configEpoch: number;
  now: Date;
}): Promise<void> {
  try {
    const source = await loadHomeSourceValues({
      uid: args.uid,
      driver: args.driver,
      profile: args.profile,
      now: args.now,
      configEpoch: args.configEpoch,
      today: args.values.today,
    });
    const fields = snapshotMismatchFields(args.values, source);
    if (fields.length === 0) return;
    logger.warn({
      perf: "home",
      name: "driverGetHomeDashboard",
      snapshot_shadow: true,
      uid: args.uid,
      shift_date: args.values.today,
      fields,
      snapshot_deliveries: args.values.deliveries,
      source_deliveries: source.deliveries,
    });
  } catch {
    logger.warn({
      perf: "home",
      name: "driverGetHomeDashboard",
      snapshot_shadow: "failed",
      uid: args.uid,
    });
  }
}

/**
 * The Home response.
 *
 * Warm cost with `home_snapshot_enabled`: `drivers` + `profiles` (from
 * `requireRider`) + `auth_epochs/current` + `driver_home_daily`, plus one
 * `driver_group_members` read when a banner is group-targeted. Without the flag,
 * or on a miss, this is the deployed 25-document path.
 */
export async function loadRiderHomeDashboard(args: {
  uid: string;
  driver: Dict;
  profile: Dict;
  now?: Date;
}): Promise<Dict> {
  const now = args.now ?? new Date();
  const today = kuwaitDayString(now);

  // One epoch read for every fleet-wide collection this response needs. Once
  // the isolate is warm that single read is the *entire* cost of the delivery
  // rules, their scopes, the incentive rules, their scopes and tiers, and the
  // banners — the collections themselves come from the isolate memory cache.
  const epochs = await step("home.epochs", () => readConfigEpochs());
  const configEpoch = epochs.config;
  const flags = await step("home.snapshotFlag", () => loadHomeSnapshotFlags(configEpoch));

  if (flags.enabled) {
    const snapshot = await step("home.snapshot", () => readHomeSnapshot(args.uid, today, now));
    if (snapshot && snapshotFresh(snapshot.raw, today, now, args.driver)) {
      const values = snapshotToValues(snapshot.raw, args.driver);
      const decorated = await decorateHomeValues({
        uid: args.uid,
        driver: args.driver,
        values,
        configEpoch,
        now,
      });
      if (flags.shadow) {
        await logSnapshotShadow({
          uid: args.uid,
          driver: args.driver,
          profile: args.profile,
          values,
          configEpoch,
          now,
        });
      }
      return composeHomePayload({
        driver: args.driver,
        profile: args.profile,
        values,
        rules: decorated.rules,
        incentive: decorated.incentive,
        banner: decorated.banner,
        configEpoch,
        now,
        snapshotAgeMs: snapshot.ageMs,
      });
    }
  }

  const values = await loadHomeSourceValues({
    uid: args.uid,
    driver: args.driver,
    profile: args.profile,
    now,
    configEpoch,
    today,
  });
  const decorated = await decorateHomeValues({
    uid: args.uid,
    driver: args.driver,
    values,
    configEpoch,
    now,
  });
  const payload = composeHomePayload({
    driver: args.driver,
    profile: args.profile,
    values,
    rules: decorated.rules,
    incentive: decorated.incentive,
    banner: decorated.banner,
    configEpoch,
    now,
    snapshotAgeMs: null,
  });
  if (flags.enabled) {
    // Compute-on-miss: this call already paid for these values, so filling the
    // snapshot costs one document write and no extra read.
    await writeHomeSnapshot(args.uid, values, now, "home_call").catch(() => undefined);
  }
  return payload;
}

export type HomeSnapshotRebuildResult =
  | "rebuilt"
  | "skipped"
  | "disabled"
  | "not_today"
  | "no_driver";

/**
 * Recompute one rider's Home snapshot from source.
 *
 * Idempotent and whole-document: callers are writers, not owners, so a missed or
 * duplicated call can never leave a field half-updated. The throttle exists
 * because a pickup immediately followed by a complete would otherwise pay the
 * full recompute twice for the same numbers; `force` is for the events where the
 * rider is looking at the screen (duty, checkout, earnings, compliance, zone).
 */
export async function rebuildDriverHomeDaily(
  driverId: string,
  day: string,
  reason: string,
  options: { force?: boolean } = {},
): Promise<HomeSnapshotRebuildResult> {
  const now = new Date();
  const today = kuwaitDayString(now);
  if (day !== today) return "not_today";

  const epochs = await readConfigEpochs();
  const flags = await loadHomeSnapshotFlags(epochs.config);
  if (!flags.enabled) return "disabled";

  const db = getFirestore();
  const ref = db.collection(COLLECTIONS.driverHomeDaily).doc(homeSnapshotId(driverId, today));

  if (!options.force) {
    const existing = await ref.get().catch(() => null);
    const age = existing?.exists ? numberOrNull(existing.get("updated_at_ms")) : null;
    if (existing?.exists && age !== null && now.getTime() - age < HOME_SNAPSHOT_REBUILD_MIN_MS) {
      return "skipped";
    }
  }

  const [driverSnap, profileSnap] = await Promise.all([
    db.collection(COLLECTIONS.drivers).doc(driverId).get(),
    db.collection(COLLECTIONS.profiles).doc(driverId).get(),
  ]);
  if (!driverSnap.exists) return "no_driver";

  const values = await loadHomeSourceValues({
    uid: driverId,
    driver: (driverSnap.data() ?? {}) as Dict,
    profile: (profileSnap.data() ?? {}) as Dict,
    now,
    configEpoch: epochs.config,
    today,
  });
  await writeHomeSnapshot(driverId, values, now, reason);
  return "rebuilt";
}

/**
 * The shape every writer calls. A rebuild failure is never the writer's failure:
 * the RPC has a source fallback and the hourly repair re-runs the same function.
 */
export async function rebuildDriverHomeDailySafe(
  driverId: string,
  reason: string,
  force = false,
): Promise<HomeSnapshotRebuildResult | "failed"> {
  try {
    return await rebuildDriverHomeDaily(driverId, kuwaitDayString(new Date()), reason, { force });
  } catch {
    return "failed";
  }
}

export type HomeSnapshotInvalidateResult = "invalidated" | "missing" | "disabled" | "failed";

/**
 * The signal every writer sends.
 *
 * A writer does **not** recompute the snapshot: a full rebuild costs ~35 reads
 * (week aggregates, lifetime counts, compliance rows, sessions), so doing it on
 * every pickup and complete would cost more than the Home calls it saves. It
 * writes one flag instead, and the next Home call — which has to produce the new
 * numbers anyway — recomputes and rewrites the document at no extra read.
 *
 * `update()` on a missing document throws `not-found`, which is the cheapest
 * "nothing to invalidate" answer: no read, no write.
 */
export async function invalidateDriverHomeDaily(
  driverId: string,
  reason: string,
): Promise<HomeSnapshotInvalidateResult> {
  const epochs = await readConfigEpochs();
  const flags = await loadHomeSnapshotFlags(epochs.config);
  if (!flags.enabled) return "disabled";
  try {
    await getFirestore()
      .collection(COLLECTIONS.driverHomeDaily)
      .doc(homeSnapshotId(driverId, kuwaitDayString(new Date())))
      .update({ stale: true, stale_reason: reason, stale_at_ms: Date.now() });
    return "invalidated";
  } catch (error) {
    const code = (error as { code?: number | string }).code;
    if (code === 5 || code === "not-found") return "missing";
    return "failed";
  }
}

/**
 * Writer-safe wrapper. A failed invalidation is covered by the staleness window.
 *
 * `signal: false` is for writes the rider's own phone made: it already refreshes
 * after its call, so a `rider_signals` bump would make it fetch Home twice.
 */
export async function invalidateDriverHomeDailySafe(
  driverId: string,
  reason: string,
  options: { signal?: boolean } = {},
): Promise<HomeSnapshotInvalidateResult> {
  if (options.signal !== false) await bumpRiderSignal(driverId, ["home", "earnings"], reason);
  try {
    return await invalidateDriverHomeDaily(driverId, reason);
  } catch {
    return "failed";
  }
}

export async function applyRiderCheckout(args: {
  driverId: string;
  reason: string;
  now: Date;
  keepDutyWrite?: boolean;
  /** `false` when the rider's own device is the caller — no push back to it. */
  notify?: boolean;
}): Promise<void> {
  const db = getFirestore();
  const today = kuwaitDayString(args.now);
  const stamp = Timestamp.fromDate(args.now);
  const [log, open, location, driverSnap, profileSnap] = await Promise.all([
    attendanceLogOn(args.driverId, today),
    openOnlineSession(args.driverId),
    locationOf(args.driverId),
    db.collection(COLLECTIONS.drivers).doc(args.driverId).get(),
    db.collection(COLLECTIONS.profiles).doc(args.driverId).get(),
  ]);
  const batch = db.batch();
  if (args.keepDutyWrite !== false) {
    batch.set(
      db.collection(COLLECTIONS.drivers).doc(args.driverId),
      { is_on_duty: false, updated_at: stamp },
      { merge: true },
    );
  }
  if (open) {
    const wentOnline = asDate(open.data["went_online_at"]);
    const elapsed = wentOnline
      ? Math.max(0, Math.floor((args.now.getTime() - wentOnline.getTime()) / 1000))
      : 0;
    batch.set(
      db.collection(COLLECTIONS.driverSessions).doc(open.id),
      {
        is_online: false,
        went_offline_at: open.data["went_offline_at"] ?? stamp,
        updated_at: stamp,
      },
      { merge: true },
    );
    const dayRow = await attendanceDayOn(args.driverId, today);
    if (elapsed > 0) {
      if (dayRow) {
        const previous = Math.trunc(numberOrNull(dayRow.data["online_seconds"]) ?? 0);
        batch.set(
          db.collection(DRIVER_ATTENDANCE).doc(dayRow.id),
          { online_seconds: previous + elapsed, last_online_at: stamp, updated_at: stamp },
          { merge: true },
        );
      } else {
        batch.set(db.collection(DRIVER_ATTENDANCE).doc(), {
          driver_id: args.driverId,
          attendance_date: today,
          first_online_at: stamp,
          last_online_at: stamp,
          online_seconds: elapsed,
          status: "online_unvalidated",
          created_at: stamp,
          updated_at: stamp,
        });
      }
    }
  }
  if (log) {
    const old = log.data ?? {};
    batch.set(
      db.collection(COLLECTIONS.attendanceLogs).doc(log.id),
      {
        // Clocking out is a duty change and the last chance to repair a log
        // that was written before the identity denorm existed.
        ...pickMissingAttendanceDenorm(
          old,
          stampAttendanceLogDenorm({
            driver: (driverSnap.data() ?? {}) as Dict,
            profile: profileSnap.exists ? ((profileSnap.data() ?? {}) as Dict) : null,
            isOnDuty: false,
          }),
        ),
        [ATT.isOnDuty]: false,
        check_out_at: stamp,
        check_out_reason: args.reason,
        updated_at: stamp,
        distance_meters:
          numberOrNull(location["distance_today_meters"]) ?? old["distance_meters"] ?? null,
      },
      { merge: true },
    );
  }
  await batch.commit();

  // Step 1 — the phone learns about a checkout it did not perform. Data-only:
  // no title, no body, so FCM never paints a tray item. A build that does not
  // know `record_type: "home"` ignores it, which is why this ships alone.
  if (args.notify !== false) {
    await sendDriverHomeRefresh(args.driverId, `checkout:${args.reason}`);
  }
  // Step 3 — the snapshot must not describe a rider who is still online. One
  // flag write; the next Home call recomputes the numbers it has to produce
  // anyway.
  await invalidateDriverHomeDailySafe(args.driverId, `checkout:${args.reason}`, {
    signal: args.notify !== false,
  });
}

/**
 * Step 4 — its own runtime shape.
 *
 * The global set is `cpu: 0.08, concurrency: 1, maxInstances: 2`, which means one
 * rider per isolate and the ~373-document cold fill for every one of them. This
 * handler is read-only, so it can share an isolate: `concurrency: 8` lets eight
 * riders reuse one warm config cache (`373 / 8 ≈ 47` `docsRead` on a cold call),
 * and `maxInstances: 20` sizes the 08:00 shift-start herd at 160 in flight.
 *
 * gen2 rejects `concurrency > 1` under one full CPU, so the CPU has to come up
 * with it. `region` is passed explicitly: `init.ts` documents why the project
 * runs in `me-central1` while Firestore lives in `me-central2`, and a runtime
 * override is exactly where that would otherwise be lost.
 */
export const driverGetHomeDashboard = measureOnCall(
  "driverGetHomeDashboard",
  async (request) => {
    const ctx = await requireRider(request);
    return loadRiderHomeDashboard({
      uid: ctx.uid,
      driver: ctx.driver,
      profile: ctx.profile,
    });
  },
  {
    region: FUNCTIONS_REGION,
    cpu: 1,
    memory: "1GiB",
    concurrency: 8,
    maxInstances: 20,
  },
);

/**
 * `driverSetDutyState` keeps the global single-concurrency shape on purpose.
 *
 * It writes a batch, an attendance rollup and a session, and its response is a
 * fresh Home payload. Overlapping two of those on one instance would let two
 * duty calls for the same rider race on the same session row, and the read win
 * here is zero — the call runs twice a day. CPU and concurrency change only if a
 * handler read shows the writes are independent.
 */
export const driverSetDutyState = measureOnCall("driverSetDutyState", async (request) => {
  const ctx = await requireRider(request);
  const data = (request.data ?? {}) as Dict;
  const isOnDuty = pickTriBool(data, "is_on_duty", "p_is_on_duty") ?? pickBoolean(data, "is_on_duty", "p_is_on_duty");
  const isOnline = pickTriBool(data, "is_online", "p_is_online") ?? pickBoolean(data, "is_online", "p_is_online");
  const now = new Date();
  const today = kuwaitDayString(now);
  const stamp = Timestamp.fromDate(now);
  const db = getFirestore();
  const driver = ctx.driver;
  const wasOnDuty = driver["is_on_duty"] === true;
  const archivedAt = driver["archived_at"];
  const status = asString(driver["status"]);

  let activeShift: ShiftRow | null = null;
  if (isOnDuty || isOnline) {
    if (archivedAt != null) {
      throw riderError("failed-precondition", "driver_archived");
    }
    if (status !== "active") {
      throw riderError("failed-precondition", "inactive");
    }
    activeShift = await findActiveShift(ctx.uid, now);
    if (!activeShift) {
      throw riderError("failed-precondition", "shift_required");
    }
  }

  const existingAttendance = isOnDuty ? await attendanceLogOn(ctx.uid, today) : null;
  const freshCheckIn =
    isOnDuty && needsCheckIn(existingAttendance?.data ?? null);

  type CheckInStamp = {
    photoKey: string | null;
    restaurantId: string | null;
    restaurantName: string | null;
    distanceM: number | null;
  };
  let checkInStamp: CheckInStamp | null = null;
  const keeta = isKeetaDriver(driver);

  if (freshCheckIn) {
    const safety = await loadDriverAppSafetySettings();
    const photoKey = pickText(data, "p_check_in_photo_key", "check_in_photo_key", "checkInPhotoKey");
    const lat = numberOrNull(pick(data, "p_lat", "lat", "check_in_lat", "checkInLat"));
    const lng = numberOrNull(pick(data, "p_lng", "lng", "check_in_lng", "checkInLng"));
    const requestedRestaurantId = pickText(
      data,
      "p_restaurant_id",
      "restaurant_id",
      "checkInRestaurantId",
    );

    if (safety.checkInPhotoRequired && !photoKey) {
      throw riderError("failed-precondition", "check_in_photo_required");
    }
    if (photoKey && !isCheckInPhotoKeyForKey(ctx.uid, photoKey)) {
      throw riderError("invalid-argument", "invalid_check_in_photo");
    }
    if (lat === null || lng === null) {
      throw riderError("failed-precondition", "check_in_location_required");
    }

    if (await riderIsNonOperational(driver)) {
      // Office staff: the selfie and the GPS fix above still apply, but there is
      // no zone or store to match, so the attendance row keeps no location.
      checkInStamp = {
        photoKey,
        restaurantId: null,
        restaurantName: null,
        distanceM: null,
      };
    } else if (keeta) {
      // Keeta has no store assignment to prove, so the location gate is the
      // assigned zone with a zero buffer. The selfie is still owed (the check
      // above is shared), and the attendance row keeps the project as its
      // "store" so the admin grid reads Keeta rather than a blank.
      const zone = await loadCheckInZone(asString(driver["zone_id"]));
      const verdict = keetaZoneVerdict({ lat, lng, zone });
      if (verdict.outcome !== "in_range") {
        if (verdict.outcome === "no_zone") {
          throw riderError("failed-precondition", "check_in_zone_unassigned", {
            zone_name: verdict.zone?.name ?? null,
          });
        }
        throw riderError("failed-precondition", "check_in_outside_zone", {
          zone_name: verdict.zone?.name ?? null,
          zone_id: verdict.zone?.id ?? null,
        });
      }
      checkInStamp = {
        photoKey,
        restaurantId: null,
        restaurantName: "Keeta",
        distanceM: 0,
      };
    } else {
      const candidates = await loadCheckInCandidates(ctx.uid, driver);
      const match = matchCheckInRestaurant({
        candidates,
        lat,
        lng,
        proximityMeters: safety.proximityMeters > 0 ? safety.proximityMeters : 500,
        requestedId: requestedRestaurantId,
      });
      if (!match) {
        const nearest = nearestCheckInRestaurant({ candidates, lat, lng });
        throw riderError("failed-precondition", "check_in_outside_restaurant_range", {
          nearest_restaurant: nearest?.name ?? null,
          nearest_restaurant_id: nearest?.id ?? null,
          distance_m: nearest?.distanceM ?? null,
        });
      }

      checkInStamp = {
        photoKey,
        restaurantId: match.id,
        restaurantName: match.name,
        distanceM: match.distanceM,
      };
    }
  }

  await db.collection(COLLECTIONS.drivers).doc(ctx.uid).set(
    { is_on_duty: isOnDuty, updated_at: stamp },
    { merge: true },
  );

  if (isOnDuty) {
    const existing = existingAttendance;
    const payload: Dict = {
      driver_id: ctx.uid,
      log_date: today,
      check_out_at: null,
      check_out_reason: null,
      updated_at: stamp,
      ...(checkInStamp
        ? {
            [ATT.checkInPhotoKey]: checkInStamp.photoKey,
            // A Keeta clock-in has no photo to point at, so the timestamp stays
            // unset instead of claiming a photo the row cannot resolve.
            ...(checkInStamp.photoKey ? { [ATT.checkInPhotoAt]: stamp } : {}),
            [ATT.checkInRestaurantId]: checkInStamp.restaurantId,
            [ATT.checkInRestaurantName]: checkInStamp.restaurantName,
            [ATT.checkInDistanceM]: checkInStamp.distanceM,
          }
        : {}),
    };
    const zoneId = asString(driver["zone_id"]);
    // Identity and the shift window are denormalised at clock-in so the admin
    // Attendance list never joins `profiles` just to print a rider's name.
    const denorm = stampAttendanceLogDenorm({
      driver,
      profile: ctx.profile,
      isOnDuty: true,
      scheduledStart: activeShift ? shiftStartAt(activeShift) : null,
      scheduledEnd: activeShift ? shiftEndAt(activeShift) : null,
    });
    if (existing) {
      const old = existing.data ?? {};
      const keepLeave = old["status"] === "on_leave";
      await db
        .collection(COLLECTIONS.attendanceLogs)
        .doc(existing.id)
        .set(
          {
            ...payload,
            ...pickMissingAttendanceDenorm(old, denorm),
            [ATT.isOnDuty]: true,
            check_in_at: old["check_in_at"] ?? stamp,
            status: keepLeave ? "on_leave" : "present",
          },
          { merge: true },
        );
      await applyAttendanceRollup(db, {
        driverId: ctx.uid,
        zoneId,
        day: today,
        logId: existing.id,
        present: !keepLeave,
      });
    } else {
      const created = await db.collection(COLLECTIONS.attendanceLogs).add({
        ...payload,
        ...denorm,
        check_in_at: stamp,
        status: "present",
        created_at: stamp,
      });
      await applyAttendanceRollup(db, {
        driverId: ctx.uid,
        zoneId,
        day: today,
        logId: created.id,
        present: true,
      });
    }
  }

  const open = await openOnlineSession(ctx.uid);
  if (isOnline) {
    if (!open) {
      await db.collection(COLLECTIONS.driverSessions).add({
        driver_id: ctx.uid,
        is_online: true,
        went_online_at: stamp,
        went_offline_at: null,
        created_at: stamp,
        updated_at: stamp,
      });
    } else {
      await db.collection(COLLECTIONS.driverSessions).doc(open.id).set(
        { is_online: true, went_offline_at: null, updated_at: stamp },
        { merge: true },
      );
    }
    const dayRow = await attendanceDayOn(ctx.uid, today);
    if (dayRow) {
      const keepPresent = dayRow.data["status"] === "present";
      await db.collection(DRIVER_ATTENDANCE).doc(dayRow.id).set(
        {
          first_online_at: dayRow.data["first_online_at"] ?? stamp,
          last_online_at: stamp,
          status: keepPresent ? "present" : "online_unvalidated",
          updated_at: stamp,
        },
        { merge: true },
      );
    } else {
      await db.collection(DRIVER_ATTENDANCE).add({
        driver_id: ctx.uid,
        attendance_date: today,
        first_online_at: stamp,
        last_online_at: stamp,
        online_seconds: 0,
        status: "online_unvalidated",
        created_at: stamp,
        updated_at: stamp,
      });
    }
  } else if (open) {
    const wentOnline = asDate(open.data["went_online_at"]);
    const elapsed = wentOnline
      ? Math.max(0, Math.floor((now.getTime() - wentOnline.getTime()) / 1000))
      : 0;
    await db.collection(COLLECTIONS.driverSessions).doc(open.id).set(
      { is_online: false, went_offline_at: stamp, updated_at: stamp },
      { merge: true },
    );
    const dayRow = await attendanceDayOn(ctx.uid, today);
    if (elapsed > 0) {
      if (dayRow) {
        const previous = Math.trunc(numberOrNull(dayRow.data["online_seconds"]) ?? 0);
        const keepPresent = dayRow.data["status"] === "present";
        await db.collection(DRIVER_ATTENDANCE).doc(dayRow.id).set(
          {
            online_seconds: previous + elapsed,
            last_online_at: stamp,
            status: keepPresent ? "present" : "online_unvalidated",
            updated_at: stamp,
          },
          { merge: true },
        );
      } else {
        await db.collection(DRIVER_ATTENDANCE).add({
          driver_id: ctx.uid,
          attendance_date: today,
          first_online_at: stamp,
          last_online_at: stamp,
          online_seconds: elapsed,
          status: "online_unvalidated",
          created_at: stamp,
          updated_at: stamp,
        });
      }
    }
  }

  if (!isOnDuty) {
    await applyRiderCheckout({
      driverId: ctx.uid,
      reason: "manual",
      now,
      keepDutyWrite: false,
      // The phone that made this call already knows; a push back to it is a
      // cycle of the same refresh.
      notify: false,
    });
  }

  // A duty transition rewrites the session and the day row, so the snapshot is
  // invalidated before the response reads it. The response then recomputes and
  // rewrites the document, which is why the rider sees the new `is_online` and
  // online timer immediately — the one thing §2 says must never be cached.
  await invalidateDriverHomeDailySafe(ctx.uid, "duty", { signal: false });

  let opKey = "duty.offline";
  if (isOnDuty !== wasOnDuty) {
    opKey = isOnDuty ? "duty.on" : "duty.off";
  } else if (isOnline) {
    opKey = "duty.online";
  }

  await logDriverOperation({
    driverId: ctx.uid,
    module: "duty",
    action: opKey,
    actor: "rpc",
    success: true,
    recordType: "driver",
    recordId: ctx.uid,
    detail: {
      is_on_duty: isOnDuty,
      is_online: isOnline,
      duty_changed: isOnDuty !== wasOnDuty,
      check_in_restaurant_id: checkInStamp?.restaurantId ?? null,
      check_in_distance_m: checkInStamp?.distanceM ?? null,
      check_in_photo: checkInStamp?.photoKey != null,
    },
  });

  const refreshed = await db.collection(COLLECTIONS.drivers).doc(ctx.uid).get();
  return loadRiderHomeDashboard({
    uid: ctx.uid,
    driver: (refreshed.data() ?? {}) as Dict,
    profile: ctx.profile,
    now,
  });
});

type CheckInRestaurantSummary = {
  id: string;
  name: string | null;
  distance_m: number | null;
};

function checkInRestaurantSummary(match: {
  id: string;
  name: string | null;
  distanceM: number | null;
} | null): CheckInRestaurantSummary | null {
  if (!match) return null;
  return { id: match.id, name: match.name, distance_m: match.distanceM };
}

/**
 * Clock-in precheck for the rider app.
 *
 * `driverSetDutyState` stays the only authority on the write, so a tampered
 * client still cannot skip the gate. This callable exists so the phone can ask
 * *before* it opens the camera: out of range is data, not an error, so the rider
 * learns they are 800 m from Salmiya without spending a selfie on it.
 *
 * It also answers the one thing the phone could not know: a rider who clocked
 * out and back in on the same Kuwait day owes no check-in at all, so
 * `requires_check_in: false` lets it skip both the photo and the proximity gate
 * — exactly the condition `freshCheckIn` refuses on.
 *
 * A Keeta rider gets a zone gate instead of a restaurant gate: `gate: "zone"`
 * and a `zone` summary (`{ id, name }`). The photo is **not** exempt — the same
 * `photo_required` answer as everyone else, so the phone opens the camera once
 * the zone check passes. No zone or no stored shape answers `in_range: false`
 * with `zone: null` so the phone sends them to an administrator, not 800 m down
 * the road.
 *
 * It never throws for a refusal, so it is safe to call on every Clock In tap.
 */
export const driverCheckInContext = measureOnCall("driverCheckInContext", async (request) => {
  const ctx = await requireRider(request);
  const data = (request.data ?? {}) as Dict;
  const day = kuwaitDayString(new Date());
  const lat = numberOrNull(pick(data, "p_lat", "lat", "check_in_lat", "checkInLat"));
  const lng = numberOrNull(pick(data, "p_lng", "lng", "check_in_lng", "checkInLng"));

  const [existingAttendance, safety, nonOperational] = await Promise.all([
    attendanceLogOn(ctx.uid, day),
    loadDriverAppSafetySettings(),
    riderIsNonOperational(ctx.driver),
  ]);

  const requiresCheckIn = needsCheckIn(existingAttendance?.data ?? null);
  // Keeta has no store to match: `gate` names the location gate (the assigned
  // zone) and `zone` carries the name so the refusal can say which zone was
  // missed. The photo requirement below is shared with every other rider.
  const keeta = isKeetaDriver(ctx.driver);
  const base = {
    day,
    requires_check_in: requiresCheckIn,
    checked_in_today: !requiresCheckIn,
    // A non-operational rider (MG Head Office) has no zone or store at all, so
    // there is no place to gate on; the selfie below still applies.
    gate: nonOperational ? "none" : keeta ? "zone" : "restaurant",
    photo_required: safety.checkInPhotoRequired,
    proximity_meters: safety.proximityMeters,
    candidates: 0,
    requires_location: false,
    in_range: false,
    restaurant: null as CheckInRestaurantSummary | null,
    nearest: null as CheckInRestaurantSummary | null,
    zone: null as CheckInZoneSummary | null,
  };

  if (!requiresCheckIn) {
    // Already checked in today: the write cannot refuse on the gate, so the
    // phone must not open the camera — or fail on a missing GPS fix — for it.
    return { ...base, in_range: true };
  }

  if (lat === null || lng === null) {
    // No fix yet is a client-side retry, not a refusal: `in_range` stays false
    // and `requires_location` tells the phone which copy to show.
    return { ...base, requires_location: true };
  }

  if (nonOperational) {
    // No zone and no store to prove — the precheck admits the rider so the
    // phone goes straight to the selfie the shared rule still requires.
    return { ...base, in_range: true };
  }

  if (keeta) {
    const zone = await loadCheckInZone(asString(ctx.driver["zone_id"]));
    const verdict = keetaZoneVerdict({ lat, lng, zone });
    return {
      ...base,
      in_range: verdict.outcome === "in_range",
      zone: verdict.zone,
    };
  }

  const candidates = await loadCheckInCandidates(ctx.uid, ctx.driver);
  const match = matchCheckInRestaurant({
    candidates,
    lat,
    lng,
    // Same allowance the duty write applies, so a precheck can never refuse a
    // clock-in the write would have accepted.
    proximityMeters: safety.proximityMeters > 0 ? safety.proximityMeters : 500,
  });
  const nearest = match ? null : nearestCheckInRestaurant({ candidates, lat, lng });

  return {
    ...base,
    candidates: candidates.length,
    in_range: match != null,
    restaurant: checkInRestaurantSummary(match),
    nearest: checkInRestaurantSummary(nearest),
  };
});
