import { AggregateField, getFirestore, Timestamp, type Firestore } from "../core/fs";
import { measureBlock, measureOnCall } from "../core/fs-metrics";
import { createConfigCache, readConfigEpochs } from "../core/config-cache";
import { COLLECTIONS, FIELDS } from "../core/collections";
import {
  kuwaitDayEnd,
  kuwaitDayRange,
  kuwaitDayStart,
  kuwaitDayString,
} from "../core/kuwait";
import { kuwaitWeekStart } from "../core/money";
import { loadAppSettings } from "../core/settings";
import { requireRider, riderError } from "../core/rider";
import { applyAttendanceRollup } from "../core/rollups";
import { computeIncentiveAmount, type IncentiveRule, type IncentiveTier } from "../core/incentive";
import { driverRestaurantIds } from "./deliveries-shared";
import {
  isoTimestamp,
  logDriverOperation,
  numberOrNull,
  pickBoolean,
  pickTriBool,
  type Dict,
} from "./_shared";
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

function ruleMatchesDriver(args: {
  scopeType: string;
  scopes: Array<{ zone_id: string | null; partner_id: string | null; restaurant_id: string | null }>;
  zoneId: string | null;
  partnerId: string | null;
  restaurantIds: readonly string[];
}): boolean {
  const { scopeType, scopes, zoneId, partnerId, restaurantIds } = args;
  if (scopeType === "zone") {
    return scopes.some((scope) => scope.zone_id !== null && scope.zone_id === zoneId);
  }
  if (scopeType === "partner") {
    return scopes.some((scope) => scope.partner_id !== null && scope.partner_id === partnerId);
  }
  if (scopeType === "restaurant") {
    return scopes.some(
      (scope) => scope.restaurant_id !== null && restaurantIds.includes(scope.restaurant_id),
    );
  }
  return false;
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

type RuleScope = {
  zone_id: string | null;
  partner_id: string | null;
  restaurant_id: string | null;
};

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
        scopeType,
        scopes,
        zoneId: args.zoneId,
        partnerId: args.partnerId,
        restaurantIds: args.restaurantIds,
      })
    ) {
      continue;
    }
    const restaurantId = scopes.find((scope) => scope.restaurant_id)?.restaurant_id ?? null;
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
      scopeType: rule.scopeType,
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

export async function loadRiderHomeDashboard(args: {
  uid: string;
  driver: Dict;
  profile: Dict;
  now?: Date;
}): Promise<Dict> {
  const now = args.now ?? new Date();
  const today = kuwaitDayString(now);
  const weekStart = kuwaitWeekStart(today);
  const zoneId = asString(args.driver["zone_id"]);
  const partnerId = asString(args.driver["partner_id"]);
  const forceAt = args.driver["force_app_update_at"];
  const forceMin = numberOrNull(args.driver["force_app_update_min_code"]);
  const forceAppUpdate = forceAt != null && forceMin !== null;

  // One epoch read for every fleet-wide collection this response needs. Once
  // the isolate is warm that single read is the *entire* cost of the delivery
  // rules, their scopes, the incentive rules, their scopes and tiers, and the
  // banners — the collections themselves come from the isolate memory cache.
  const epochs = await step("home.epochs", () => readConfigEpochs());
  const configEpoch = epochs.config;

  const restaurantIds = await step("home.assignedRestaurants", () =>
    assignedRestaurantIds(args.uid, args.driver),
  );
  const hideWeekly = await step("home.companyIncentive", () =>
    companyHidesWeeklyIncentive(args.driver, configEpoch),
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
  ] = await Promise.all([
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
    ]);

  const partner = partnerSnap?.exists ? ((partnerSnap.data() ?? {}) as Dict) : {};
  const [ruleConfig, incentiveConfig, banner] = await Promise.all([
    step("home.deliveryRules", () => deliveryRuleCache.get(configEpoch, loadDeliveryRuleConfig)),
    hideWeekly
      ? Promise.resolve(null)
      : step("home.incentiveRules", () => incentiveRuleCache.get(configEpoch, loadIncentiveConfig)),
    step("home.banner", () => loadBanner(args.uid, zoneId, partnerId, now, configEpoch)),
  ]);

  const rules = matchingDeliveryRules(ruleConfig, {
    today,
    zoneId,
    partnerId,
    restaurantIds,
  });
  const incentive = incentiveConfig
    ? primaryWeeklyIncentive(incentiveConfig, { today, zoneId, partnerId, restaurantIds })
    : null;

  return {
    driver: {
      full_name: asString(args.profile["full_name"]) ?? "Driver",
      is_on_duty: asBool(args.driver["is_on_duty"]),
      partner_name: asString(partner["name"]),
      partner_logo_url: asString(partner["logo_url"]),
    },
    session: {
      is_online: asBool(session?.["is_online"]),
      went_online_at: isoTimestamp(session?.["went_online_at"]),
      speed_mps: numberOrNull(location["speed_mps"]),
      distance_today_meters: numberOrNull(location["distance_today_meters"]) ?? 0,
    },
    week: {
      start_date: weekStart,
      end_date: today,
      earnings_kwd: earnings,
      deliveries_count: deliveries,
      online_seconds: onlineSeconds,
      invalid_days: compliance.invalid_days,
      rejected_orders: compliance.rejected_orders,
      cancelled_orders: compliance.cancelled_orders,
    },
    primary_weekly_incentive: incentive,
    delivery_rules: rules,
    shift_adherence: adherence,
    today_online_seconds:
      typeof adherence["online_seconds"] === "number"
        ? adherence["online_seconds"]
        : 0,
    performance,
    banner,
    force_app_update: forceAppUpdate,
    force_app_update_min_code: forceMin,
  };
}

export async function applyRiderCheckout(args: {
  driverId: string;
  reason: string;
  now: Date;
  keepDutyWrite?: boolean;
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
}

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
);

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

  await db.collection(COLLECTIONS.drivers).doc(ctx.uid).set(
    { is_on_duty: isOnDuty, updated_at: stamp },
    { merge: true },
  );

  if (isOnDuty) {
    const existing = await attendanceLogOn(ctx.uid, today);
    const payload: Dict = {
      driver_id: ctx.uid,
      log_date: today,
      check_out_at: null,
      check_out_reason: null,
      updated_at: stamp,
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
    });
  }

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
    detail: { is_on_duty: isOnDuty, is_online: isOnline, duty_changed: isOnDuty !== wasOnDuty },
  });

  const refreshed = await db.collection(COLLECTIONS.drivers).doc(ctx.uid).get();
  return loadRiderHomeDashboard({
    uid: ctx.uid,
    driver: (refreshed.data() ?? {}) as Dict,
    profile: ctx.profile,
    now,
  });
});
