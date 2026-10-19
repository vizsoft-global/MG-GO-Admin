/**
 * Level D, as the panel and the rider app see it.
 *
 * The rule is pure maths in `core/driver-level.ts`; this module is the
 * Firestore side of it — where the month-to-date numbers come from, how a
 * target is resolved for one rider, and where an admin override is stored.
 *
 * Two inputs, deliberately from different collections:
 *
 *   active_days  — `attendance_logs`. A row is written when the rider clocks
 *                  in, so the row existing *is* the fact that they turned up.
 *   verified     — `driver_performance_daily.deliveries_completed`, today read
 *                  live from `deliveries`. Summing `deliveries` for a whole
 *                  month would read six figures of documents per call for a
 *                  number the nightly rollup has already computed.
 *
 * If the rollup has never run for the month, the delivery half falls back to a
 * live `deliveries` read rather than reporting zero. A silent zero would mark
 * the entire fleet `standard` on a fresh environment and read as "nobody is D",
 * which is the one answer this module must never give for the wrong reason.
 */
import { onCall } from "firebase-functions/v2/https";
import { FieldValue, Timestamp, getFirestore, type Query, type QueryDocumentSnapshot } from "../core/fs";
import { COLLECTIONS } from "../core/collections";
import {
  kuwaitDayEnd,
  kuwaitDayStart,
  kuwaitDayString,
  monthKey,
  parseMonthKey,
} from "../core/kuwait";
import { requireRider } from "../core/rider";
import { requireStaff, requireStaffFresh } from "../core/staff";
import {
  partnerDailyDpdTarget,
  restaurantDailyDpdTarget,
  zoneDailyDpdTarget,
} from "../core/incentive";
import { loadIncentiveContext, type IncentiveContext } from "../core/incentive-store";
import {
  DRIVER_LEVEL_D,
  DRIVER_LEVEL_FALLBACK_TARGET,
  DRIVER_LEVEL_MIN_ACTIVE_DAYS,
  DRIVER_LEVEL_STANDARD,
  driverLevelDaysElapsed,
  driverLevelWindow,
  effectiveDriverLevel,
  parseDriverLevelKey,
  resolveDriverLevel,
  type DriverLevelKey,
  type DriverLevelMetrics,
} from "../core/driver-level";
import { notifyDriverTransactional } from "./visits-shared";
import {
  chunk,
  isoTimestamp,
  loadDocMap,
  logAdminActivity,
  pick,
  pickCount,
  pickText,
  textOrNull,
  type Dict,
} from "./_shared";

/** A month of rider-days is ~27k rows for a 900-rider fleet; this is headroom. */
const WINDOW_SCAN_CAP = 120_000;
const LIST_DEFAULT = 50;
const LIST_MAX = 500;
const SWEEP_WRITE_CHUNK = 400;

export const DRIVER_LEVEL_PERMISSION_READ = "drivers.view";
export const DRIVER_LEVEL_PERMISSION_MANAGE = "drivers.manage";

type LevelRow = {
  driver_id: string;
  driver_code: string | null;
  employee_id: string | null;
  driver_name: string | null;
  driver_status: string | null;
  zone_id: string | null;
  zone_name: string | null;
  partner_id: string | null;
  partner_name: string | null;
  restaurant_id: string | null;
  restaurant_name: string | null;
  /** What the maths says, before any override. */
  auto_level: DriverLevelKey;
  /** What the panel and the app print: override first, else `auto_level`. */
  level: DriverLevelKey;
  override_level: DriverLevelKey | null;
  override_reason: string | null;
  override_updated_at: string | null;
  override_by_name: string | null;
  /** `false` while the period has too few worked days to classify. */
  classified: boolean;
  metrics: DriverLevelMetrics;
  snapshot_at: string | null;
};

function monthOf(raw: string | null, fallback: string): string {
  const candidate = (raw ?? "").trim();
  if (!/^\d{4}-\d{2}$/.test(candidate)) return fallback;
  try {
    const parsed = parseMonthKey(candidate);
    return monthKey(parsed.year, parsed.month);
  } catch {
    return fallback;
  }
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** Kuwait day of a Firestore timestamp, or null when it is not a usable instant. */
function dayOfValue(value: unknown): string | null {
  if (value instanceof Timestamp) return kuwaitDayString(value.toDate().getTime());
  if (value instanceof Date) return kuwaitDayString(value.getTime());
  if (typeof value === "number" && Number.isFinite(value)) return kuwaitDayString(value);
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : kuwaitDayString(parsed);
  }
  return null;
}

async function scanWindow(query: Query, label: string): Promise<QueryDocumentSnapshot[]> {
  const snap = await query.limit(WINDOW_SCAN_CAP + 1).get();
  if (snap.size > WINDOW_SCAN_CAP) {
    throw new Error(`${label}_range_too_large`);
  }
  return snap.docs;
}

// ---------------------------------------------------------------------------
// Target resolution
// ---------------------------------------------------------------------------

type MonthlyTargets = {
  /** `YYYY-MM` → target, for rows with neither `zone_id` nor `team_key`. */
  global: Map<string, number>;
  /** `${zoneId}|${YYYY-MM}` → target. */
  byZone: Map<string, number>;
  /** Greatest month present, as the last-resort fallback. */
  latest: number | null;
};

async function loadMonthlyTargets(): Promise<MonthlyTargets> {
  const snap = await getFirestore().collection(COLLECTIONS.performanceTargetDpd).get();
  const global = new Map<string, number>();
  const byZone = new Map<string, number>();
  let latestMonth = "";
  let latest: number | null = null;

  for (const doc of snap.docs) {
    const raw = doc.data() as Dict;
    const month = asString(raw["month"])?.slice(0, 7) ?? null;
    const target = typeof raw["target"] === "number" ? raw["target"] : Number(raw["target"]);
    if (!month || !Number.isFinite(target) || target <= 0) continue;
    const zoneId = asString(raw["zone_id"]);
    if (asString(raw["team_key"])) continue;
    if (zoneId) byZone.set(`${zoneId}|${month}`, target);
    else global.set(month, target);
    if (month > latestMonth) {
      latestMonth = month;
      latest = target;
    }
  }

  return { global, byZone, latest };
}

function monthlyTargetFor(targets: MonthlyTargets, month: string, zoneId: string | null): number | null {
  if (zoneId) {
    const zone = targets.byZone.get(`${zoneId}|${month}`);
    if (zone !== undefined) return zone;
  }
  return targets.global.get(month) ?? targets.latest;
}

/**
 * One rider's daily target: restaurant rule first, then their zone, then their
 * partner, then the month's own target row.
 *
 * The restaurant target is the *highest* across the stores the rider is
 * assigned to. A rider who works two stores is held to the stricter one,
 * because the alternative — the easier one — is a target a rider can lower by
 * being assigned somewhere quiet.
 */
function resolveTargetDpd(args: {
  context: IncentiveContext;
  monthly: MonthlyTargets;
  month: string;
  onDate: string;
  zoneId: string | null;
  partnerId: string | null;
  restaurantIds: readonly string[];
}): { target: number; source: string } {
  const { context, monthly, month, onDate, zoneId, partnerId, restaurantIds } = args;

  let restaurantTarget: number | null = null;
  for (const restaurantId of restaurantIds) {
    const value = restaurantDailyDpdTarget({
      restaurantId,
      onDate,
      restaurantZoneId: context.restaurantZoneById.get(restaurantId) ?? null,
      restaurantPartnerId: context.restaurantPartnerById.get(restaurantId) ?? null,
      deliveryRules: context.deliveryRules,
      deliveryScopesByRule: context.deliveryScopesByRule,
    });
    if (value !== null && (restaurantTarget === null || value > restaurantTarget)) {
      restaurantTarget = value;
    }
  }
  if (restaurantTarget !== null) return { target: restaurantTarget, source: "restaurant" };

  const zoneTarget = zoneDailyDpdTarget({
    zoneId,
    onDate,
    deliveryRules: context.deliveryRules,
    deliveryScopesByRule: context.deliveryScopesByRule,
  });
  if (zoneTarget !== null) return { target: zoneTarget, source: "zone" };

  const partnerTarget = partnerDailyDpdTarget({
    partnerId,
    onDate,
    deliveryRules: context.deliveryRules,
    deliveryScopesByRule: context.deliveryScopesByRule,
  });
  if (partnerTarget !== null) return { target: partnerTarget, source: "partner" };

  const monthlyTarget = monthlyTargetFor(monthly, month, zoneId);
  if (monthlyTarget !== null) return { target: monthlyTarget, source: "month" };

  return { target: DRIVER_LEVEL_FALLBACK_TARGET, source: "default" };
}

// ---------------------------------------------------------------------------
// Month-to-date aggregation
// ---------------------------------------------------------------------------

type MonthAccumulator = {
  days: Set<string>;
  verified: number;
};

type MonthFacts = {
  month: string;
  from: string;
  to: string;
  /** `driverId` → the days they were present and the orders they finished. */
  byDriver: Map<string, MonthAccumulator>;
  /** True when the delivery half came from a live `deliveries` read. */
  liveDeliveries: boolean;
};

function emptyMonth(month: string, from: string, to: string): MonthFacts {
  return { month, from, to, byDriver: new Map(), liveDeliveries: false };
}

function accrue(facts: MonthFacts, driverId: string, day: string, orders: number): void {
  const entry = facts.byDriver.get(driverId) ?? { days: new Set<string>(), verified: 0 };
  entry.days.add(day);
  entry.verified += orders;
  facts.byDriver.set(driverId, entry);
}

/**
 * Everything the fleet needs for one month, in three reads.
 *
 * `driverId` narrows all three so a single rider's detail page costs three
 * indexed queries instead of a fleet scan.
 */
async function loadMonthFacts(args: {
  month: string;
  today: string;
  driverId?: string | null;
}): Promise<MonthFacts> {
  const { month, today, driverId } = args;
  const window = driverLevelWindow(month, today);
  if (window.to === "") return emptyMonth(month, window.from, window.to);

  const db = getFirestore();
  const { from, to } = window;

  let attendanceQuery = db
    .collection(COLLECTIONS.attendanceLogs)
    .where("log_date", ">=", from)
    .where("log_date", "<=", to);
  if (driverId) attendanceQuery = attendanceQuery.where("driver_id", "==", driverId);

  // Yesterday and earlier are the rollup's job; today has no row yet.
  const storedTo = to < today ? to : null;
  let storedQuery = storedTo
    ? db
        .collection(COLLECTIONS.driverPerformanceDaily)
        .where("log_date", ">=", from)
        .where("log_date", "<=", storedTo)
    : null;
  if (storedQuery && driverId) storedQuery = storedQuery.where("driver_id", "==", driverId);

  const [attendanceDocs, storedDocs] = await Promise.all([
    scanWindow(attendanceQuery, "attendance"),
    storedQuery ? scanWindow(storedQuery, "performance_daily") : Promise.resolve([]),
  ]);

  const facts = emptyMonth(month, from, to);
  for (const doc of attendanceDocs) {
    const raw = doc.data() ?? {};
    const rowDriverId = asString(raw["driver_id"]);
    const day = asString(raw["log_date"])?.slice(0, 10) ?? null;
    if (!rowDriverId || !day) continue;
    accrue(facts, rowDriverId, day, 0);
  }

  for (const doc of storedDocs) {
    const raw = doc.data() ?? {};
    const rowDriverId = asString(raw["driver_id"]);
    const day = asString(raw["log_date"])?.slice(0, 10) ?? null;
    if (!rowDriverId || !day) continue;
    const orders =
      typeof raw["deliveries_completed"] === "number" ? raw["deliveries_completed"] : 0;
    if (raw["worked"] === true || orders > 0) accrue(facts, rowDriverId, day, orders);
  }

  if (storedDocs.length > 0 || storedTo === null) {
    // Today, live: the rollup writes a closed day at 02:00, so anything the
    // rider finished after midnight is only in `deliveries`.
    if (to >= today && from <= today) {
      let todayQuery = db
        .collection(COLLECTIONS.deliveries)
        .where("delivered_at", ">=", kuwaitDayStart(today))
        .where("delivered_at", "<", kuwaitDayEnd(today));
      if (driverId) todayQuery = todayQuery.where("driver_id", "==", driverId);
      const todayDocs = await scanWindow(todayQuery, "deliveries_today");
      for (const doc of todayDocs) {
        const raw = doc.data() ?? {};
        if (asString(raw["status"]) !== "verified") continue;
        const rowDriverId = asString(raw["driver_id"]);
        const day = dayOfValue(raw["delivered_at"]) ?? today;
        if (!rowDriverId) continue;
        accrue(facts, rowDriverId, day, 1);
      }
    }
    return facts;
  }

  // No rollup rows at all for the window. Report the truth from `deliveries`
  // instead of a zero that would read as "nobody is D".
  facts.liveDeliveries = true;
  let liveQuery = db
    .collection(COLLECTIONS.deliveries)
    .where("delivered_at", ">=", kuwaitDayStart(from))
    .where("delivered_at", "<", kuwaitDayEnd(to));
  if (driverId) liveQuery = liveQuery.where("driver_id", "==", driverId);
  const liveDocs = await scanWindow(liveQuery, "deliveries");
  for (const doc of liveDocs) {
    const raw = doc.data() ?? {};
    if (asString(raw["status"]) !== "verified") continue;
    const rowDriverId = asString(raw["driver_id"]);
    const day = dayOfValue(raw["delivered_at"]);
    if (!rowDriverId || !day) continue;
    accrue(facts, rowDriverId, day, 1);
  }
  return facts;
}

// ---------------------------------------------------------------------------
// Roster
// ---------------------------------------------------------------------------

type DriverRecord = { id: string; raw: Dict };

async function loadRoster(driverId: string | null): Promise<DriverRecord[]> {
  const db = getFirestore();
  if (driverId) {
    const snap = await db.collection(COLLECTIONS.drivers).doc(driverId).get();
    return snap.exists ? [{ id: snap.id, raw: (snap.data() ?? {}) as Dict }] : [];
  }
  const snap = await db.collection(COLLECTIONS.drivers).limit(WINDOW_SCAN_CAP).get();
  return snap.docs
    .map((doc) => ({ id: doc.id, raw: (doc.data() ?? {}) as Dict }))
    .filter(({ raw }) => raw["archived_at"] === undefined || raw["archived_at"] === null);
}

async function loadRestaurantsByDriver(
  driverIds: readonly string[],
): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  if (driverIds.length === 0) return out;
  const db = getFirestore();
  const wanted = new Set(driverIds);
  for (const group of chunk(driverIds, 30)) {
    const snap = await db
      .collection(COLLECTIONS.driverRestaurants)
      .where("driver_id", "in", group)
      .get();
    for (const doc of snap.docs) {
      const raw = doc.data() as Dict;
      const rowDriverId = asString(raw["driver_id"]);
      const restaurantId = asString(raw["restaurant_id"]);
      if (!rowDriverId || !restaurantId || !wanted.has(rowDriverId)) continue;
      const set = out.get(rowDriverId) ?? new Set<string>();
      set.add(restaurantId);
      out.set(rowDriverId, set);
    }
  }
  return out;
}

type LevelBuildArgs = {
  month: string;
  today: string;
  facts: MonthFacts;
  context: IncentiveContext;
  monthly: MonthlyTargets;
  drivers: readonly DriverRecord[];
  profiles: Map<string, Dict>;
  zones: Map<string, Dict>;
  partners: Map<string, Dict>;
  restaurants: Map<string, Dict>;
  restaurantsByDriver: Map<string, Set<string>>;
  snapshots: Map<string, Dict>;
};

function buildRow(args: LevelBuildArgs, driver: DriverRecord): LevelRow {
  const { raw } = driver;
  const profile = args.profiles.get(driver.id) ?? {};
  const zoneId = asString(raw["zone_id"]);
  const partnerId = asString(raw["partner_id"]);
  const restaurantId = asString(raw["restaurant_id"]);
  const assigned = new Set(args.restaurantsByDriver.get(driver.id) ?? []);
  if (restaurantId) assigned.add(restaurantId);

  const onDate = args.facts.to !== "" ? args.facts.to : args.today;
  const resolved = resolveTargetDpd({
    context: args.context,
    monthly: args.monthly,
    month: args.month,
    onDate,
    zoneId,
    partnerId,
    restaurantIds: [...assigned],
  });

  const entry = args.facts.byDriver.get(driver.id);
  const activeDays = entry?.days.size ?? 0;
  const verified = entry?.verified ?? 0;
  const verdict = resolveDriverLevel({
    month: args.month,
    activeDays,
    verifiedDeliveries: verified,
    targetDpd: resolved.target,
    minActiveDays: DRIVER_LEVEL_MIN_ACTIVE_DAYS,
    daysElapsed: driverLevelDaysElapsed(args.facts.from, args.facts.to),
  });

  const override = parseDriverLevelKey(asString(raw["level_override"]));
  const snapshot = args.snapshots.get(`${driver.id}_${args.month}`) ?? null;

  return {
    driver_id: driver.id,
    driver_code: asString(raw["driver_code"]),
    employee_id: asString(raw["employee_id"]),
    driver_name:
      asString(profile["full_name"]) ?? asString(raw["full_name"]) ?? asString(raw["name"]),
    driver_status: asString(raw["status"]),
    zone_id: zoneId,
    zone_name: zoneId ? asString(args.zones.get(zoneId)?.["name"]) : null,
    partner_id: partnerId,
    partner_name: partnerId ? asString(args.partners.get(partnerId)?.["name"]) : null,
    restaurant_id: restaurantId,
    restaurant_name: restaurantId ? asString(args.restaurants.get(restaurantId)?.["name"]) : null,
    auto_level: verdict.level,
    level: effectiveDriverLevel(verdict.level, override),
    override_level: override,
    override_reason: asString(raw["level_override_reason"]),
    override_updated_at: isoTimestamp(raw["level_override_updated_at"]),
    override_by_name: asString(raw["level_override_by_name"]),
    classified: activeDays >= DRIVER_LEVEL_MIN_ACTIVE_DAYS,
    metrics: { ...verdict.metrics, target_dpd: resolved.target },
    snapshot_at: snapshot ? isoTimestamp(snapshot["computed_at"]) : null,
  };
}

async function loadSnapshotMap(month: string, driverIds: readonly string[]): Promise<Map<string, Dict>> {
  if (driverIds.length === 0) return new Map();
  const ids = driverIds.map((id) => `${id}_${month}`);
  return loadDocMap(COLLECTIONS.driverLevelSnapshots, ids);
}

/** The whole roster's level for one month, with everything joined in. */
async function buildLevelRows(args: {
  month: string;
  today: string;
  driverId: string | null;
}): Promise<{ rows: LevelRow[]; facts: MonthFacts }> {
  const drivers = await loadRoster(args.driverId);
  const driverIds = drivers.map((driver) => driver.id);

  const [facts, context, monthly, restaurantsByDriver, profiles, zones, partners, restaurants, snapshots] =
    await Promise.all([
      loadMonthFacts({ month: args.month, today: args.today, driverId: args.driverId }),
      loadIncentiveContext(),
      loadMonthlyTargets(),
      loadRestaurantsByDriver(driverIds),
      loadDocMap(COLLECTIONS.profiles, driverIds),
      loadAllNamed(COLLECTIONS.zones),
      loadAllNamed(COLLECTIONS.partners),
      loadAllNamed(COLLECTIONS.restaurants),
      loadSnapshotMap(args.month, driverIds),
    ]);

  const rows = drivers.map((driver) =>
    buildRow(
      {
        month: args.month,
        today: args.today,
        facts,
        context,
        monthly,
        drivers,
        profiles,
        zones,
        partners,
        restaurants,
        restaurantsByDriver,
        snapshots,
      },
      driver,
    ),
  );

  return { rows, facts };
}

async function loadAllNamed(collection: string): Promise<Map<string, Dict>> {
  const snap = await getFirestore().collection(collection).select("name").limit(WINDOW_SCAN_CAP).get();
  const out = new Map<string, Dict>();
  for (const doc of snap.docs) out.set(doc.id, (doc.data() ?? {}) as Dict);
  return out;
}

function sortRows(rows: LevelRow[], sort: string): LevelRow[] {
  const byName = (a: LevelRow, b: LevelRow) =>
    (a.driver_name ?? "").localeCompare(b.driver_name ?? "");
  const copy = [...rows];
  if (sort === "gap_desc") {
    return copy.sort((a, b) => b.metrics.gap - a.metrics.gap || byName(a, b));
  }
  if (sort === "gap_asc") {
    return copy.sort((a, b) => a.metrics.gap - b.metrics.gap || byName(a, b));
  }
  if (sort === "orders_desc") {
    return copy.sort(
      (a, b) => b.metrics.mtd_verified_deliveries - a.metrics.mtd_verified_deliveries || byName(a, b),
    );
  }
  if (sort === "dpd_asc") {
    return copy.sort((a, b) => (a.metrics.dpd ?? 0) - (b.metrics.dpd ?? 0) || byName(a, b));
  }
  if (sort === "dpd_desc") {
    return copy.sort((a, b) => (b.metrics.dpd ?? 0) - (a.metrics.dpd ?? 0) || byName(a, b));
  }
  if (sort === "name_asc") return copy.sort(byName);
  // Default: the riders the panel exists to find come first.
  return copy.sort(
    (a, b) =>
      (a.level === DRIVER_LEVEL_D ? 0 : 1) - (b.level === DRIVER_LEVEL_D ? 0 : 1) ||
      b.metrics.gap - a.metrics.gap ||
      byName(a, b),
  );
}

function identityMatch(row: LevelRow, search: string): boolean {
  if (search === "") return true;
  const haystack = [row.driver_name, row.driver_code, row.employee_id, row.restaurant_name, row.zone_name]
    .filter((part): part is string => part !== null)
    .map((part) => part.toLowerCase());
  return haystack.some((part) => part.includes(search));
}

// ---------------------------------------------------------------------------
// Rider callable
// ---------------------------------------------------------------------------

/**
 * `driver_get_my_level` — the badge on the rider's own Home / Profile.
 *
 * Computed live rather than read from the sweep's snapshot: a rider who has
 * just finished the order that lifts them out of D should see it, and the
 * numbers are three indexed queries for one document.
 */
export const driverGetMyLevel = onCall(async (request) => {
  const rider = await requireRider(request);
  const data = (request.data ?? {}) as Dict;
  const today = kuwaitDayString(new Date());
  const month = monthOf(pickText(data, "month", "p_month"), today.slice(0, 7));

  const { rows, facts } = await buildLevelRows({ month, today, driverId: rider.uid });
  const row = rows[0] ?? null;
  if (!row) {
    return {
      month,
      level: DRIVER_LEVEL_STANDARD,
      auto_level: DRIVER_LEVEL_STANDARD,
      override_level: null,
      override_reason: null,
      classified: false,
      metrics: resolveDriverLevel({
        month,
        activeDays: 0,
        verifiedDeliveries: 0,
        targetDpd: DRIVER_LEVEL_FALLBACK_TARGET,
      }).metrics,
    };
  }

  return {
    month,
    level: row.level,
    auto_level: row.auto_level,
    override_level: row.override_level,
    override_reason: row.override_reason,
    override_updated_at: row.override_updated_at,
    classified: row.classified,
    metrics: row.metrics,
    live_deliveries: facts.liveDeliveries,
  };
});

// ---------------------------------------------------------------------------
// Admin callables
// ---------------------------------------------------------------------------

/**
 * `admin_list_driver_levels` — the roster with its level, for the Drivers list
 * filter and the driver detail header.
 *
 * `month` is the Kuwait month; a driver's own detail page passes `driverId` and
 * gets the same shape for one rider instead of a fleet scan.
 */
export const adminListDriverLevels = onCall(async (request) => {
  await requireStaff(request, DRIVER_LEVEL_PERMISSION_READ);
  const data = (request.data ?? {}) as Dict;
  const today = kuwaitDayString(new Date());
  const month = monthOf(pickText(data, "month", "p_month"), today.slice(0, 7));

  const driverId = pickText(data, "driverId", "driver_id", "p_driver_id");
  const zoneId = pickText(data, "zoneId", "zone_id", "p_zone_id");
  const partnerId = pickText(data, "partnerId", "partner_id", "p_partner_id");
  const restaurantId = pickText(data, "restaurantId", "restaurant_id", "p_restaurant_id");
  const status = pickText(data, "driverStatus", "driver_status", "p_driver_status");
  const levelFilter = pickText(data, "level", "p_level");
  const onlyClassified = pick(data, "classified", "p_classified") === true;
  const search = (pickText(data, "search", "p_search") ?? "").toLowerCase();
  const sort = pickText(data, "sort", "p_sort") ?? "level_first";
  const limit = Math.min(Math.max(pickCount(data, LIST_DEFAULT, "limit", "p_limit"), 1), LIST_MAX);
  const offset = Math.max(pickCount(data, 0, "offset", "p_offset"), 0);

  const { rows, facts } = await buildLevelRows({ month, today, driverId });

  const filtered = rows.filter((row) => {
    if (zoneId && row.zone_id !== zoneId) return false;
    if (partnerId && row.partner_id !== partnerId) return false;
    if (restaurantId && row.restaurant_id !== restaurantId) return false;
    if (status && status !== "all" && row.driver_status !== status) return false;
    if (onlyClassified && !row.classified) return false;
    if (levelFilter === DRIVER_LEVEL_D && row.level !== DRIVER_LEVEL_D) return false;
    if (levelFilter === DRIVER_LEVEL_STANDARD && row.level !== DRIVER_LEVEL_STANDARD) return false;
    if (levelFilter === "override" && row.override_level === null) return false;
    return identityMatch(row, search);
  });

  const counts = { total: filtered.length, d: 0, standard: 0, overridden: 0, unclassified: 0 };
  for (const row of filtered) {
    if (row.level === DRIVER_LEVEL_D) counts.d += 1;
    else counts.standard += 1;
    if (row.override_level !== null) counts.overridden += 1;
    if (!row.classified) counts.unclassified += 1;
  }

  const ordered = sortRows(filtered, sort);

  return {
    month,
    window: { from: facts.from, to: facts.to },
    live_deliveries: facts.liveDeliveries,
    min_active_days: DRIVER_LEVEL_MIN_ACTIVE_DAYS,
    rows: ordered.slice(offset, offset + limit),
    total: filtered.length,
    counts,
    offset,
    limit,
  };
});

/**
 * `admin_set_driver_level_override`.
 *
 * An override is a decision about a rider, so it is written on the driver
 * document with the admin's name and reason, and it notifies the rider — the
 * one thing worse than being marked D is being marked D silently.
 *
 * `level: "clear"` removes the override and hands the badge back to the maths.
 */
export const adminSetDriverLevelOverride = onCall(async (request) => {
  const staff = await requireStaffFresh(request, DRIVER_LEVEL_PERMISSION_MANAGE);
  const data = (request.data ?? {}) as Dict;

  const driverId = pickText(data, "driverId", "driver_id", "p_driver_id");
  if (!driverId) throw new Error("invalid_driver");
  const rawLevel = (pickText(data, "level", "p_level") ?? "").toLowerCase();
  const clear = rawLevel === "clear" || rawLevel === "auto" || rawLevel === "";

  const level: DriverLevelKey | null = clear
    ? null
    : rawLevel === DRIVER_LEVEL_D
      ? DRIVER_LEVEL_D
      : rawLevel === DRIVER_LEVEL_STANDARD
        ? DRIVER_LEVEL_STANDARD
        : null;
  if (!clear && level === null) throw new Error("invalid_level");

  const reason = textOrNull(pick(data, "reason", "note", "p_reason"));

  const db = getFirestore();
  const ref = db.collection(COLLECTIONS.drivers).doc(driverId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("driver_not_found");

  const [staffSnap, profileSnap] = await Promise.all([
    db.collection(COLLECTIONS.profiles).doc(staff.uid).get(),
    db.collection(COLLECTIONS.profiles).doc(driverId).get(),
  ]);
  const staffName = staffSnap.exists ? asString(staffSnap.get("full_name")) : null;
  const driverName = profileSnap.exists ? asString(profileSnap.get("full_name")) : null;

  await ref.set(
    {
      level_override: level,
      level_override_reason: level === null ? null : reason,
      level_override_updated_at: FieldValue.serverTimestamp(),
      level_override_by: level === null ? null : staff.uid,
      level_override_by_name: level === null ? null : staffName,
    },
    { merge: true },
  );

  await logAdminActivity({
    actorId: staff.uid,
    action: level === null ? "driver_level_override_cleared" : `driver_level_override_${level}`,
    entity: "drivers",
    entityId: driverId,
    detail: { level, reason, driver_name: driverName },
  });

  if (level === DRIVER_LEVEL_D) {
    await notifyDriverTransactional({
      driverId,
      title: "Performance level updated",
      body: reason
        ? `Your account has been placed on Level D. ${reason}`
        : "Your account has been placed on Level D. Please speak to your supervisor.",
      deepLink: "musallam:///profile/performance-level",
      category: "performance",
      priority: "high",
      actionParams: { record_type: "driver_level", record_id: driverId, level: "D" },
      createdBy: staff.uid,
    });
  } else if (level === DRIVER_LEVEL_STANDARD) {
    await notifyDriverTransactional({
      driverId,
      title: "Performance level updated",
      body: "Your account is back to the standard level.",
      deepLink: "musallam:///profile/performance-level",
      category: "performance",
      priority: "normal",
      actionParams: { record_type: "driver_level", record_id: driverId, level: "standard" },
      createdBy: staff.uid,
    });
  }

  return { ok: true, driver_id: driverId, level };
});

/**
 * `admin_evaluate_driver_levels_sweep` — the month's verdict, persisted.
 *
 * Persisting is what makes the transition detectable: a rider becomes D on the
 * day their gap opens, and that is the day worth telling them about, not every
 * day afterwards. With `notify: true` only riders whose stored level changes
 * *into* D are messaged.
 */
export const adminEvaluateDriverLevelsSweep = onCall(async (request) => {
  const staff = await requireStaffFresh(request, DRIVER_LEVEL_PERMISSION_MANAGE);
  const data = (request.data ?? {}) as Dict;
  const today = kuwaitDayString(new Date());
  const month = monthOf(pickText(data, "month", "p_month"), today.slice(0, 7));
  const notify = pick(data, "notify", "p_notify") === true;
  const dryRun = pick(data, "dryRun", "dry_run", "p_dry_run") === true;

  const { rows, facts } = await buildLevelRows({ month, today, driverId: null });

  const db = getFirestore();
  const existing = await loadSnapshotMap(
    month,
    rows.map((row) => row.driver_id),
  );

  const transitions: LevelRow[] = [];
  for (const row of rows) {
    if (row.level !== DRIVER_LEVEL_D) continue;
    const previous = parseDriverLevelKey(
      asString(existing.get(`${row.driver_id}_${month}`)?.["level"]),
    );
    if (previous !== DRIVER_LEVEL_D) transitions.push(row);
  }

  if (!dryRun) {
    const now = FieldValue.serverTimestamp();
    for (let index = 0; index < rows.length; index += SWEEP_WRITE_CHUNK) {
      const batch = db.batch();
      for (const row of rows.slice(index, index + SWEEP_WRITE_CHUNK)) {
        batch.set(
          db.collection(COLLECTIONS.driverLevelSnapshots).doc(`${row.driver_id}_${month}`),
          {
            driver_id: row.driver_id,
            month,
            day: today,
            auto_level: row.auto_level,
            level: row.level,
            override_level: row.override_level,
            classified: row.classified,
            metrics: row.metrics,
            window: { from: facts.from, to: facts.to },
            computed_at: now,
          },
          { merge: true },
        );
      }
      await batch.commit();
    }

    await logAdminActivity({
      actorId: staff.uid,
      action: "driver_level_sweep",
      entity: "drivers",
      detail: {
        month,
        rows: rows.length,
        level_d: rows.filter((row) => row.level === DRIVER_LEVEL_D).length,
        transitions: transitions.length,
        notified: notify,
        live_deliveries: facts.liveDeliveries,
      },
    });
  }

  if (notify && !dryRun) {
    for (const row of transitions) {
      const target = row.metrics.target_dpd;
      const gap = Math.max(0, Math.ceil(row.metrics.gap));
      const shortfall = `${gap} order${gap === 1 ? "" : "s"}`;
      await notifyDriverTransactional({
        driverId: row.driver_id,
        title: "Level D — orders below target",
        body: `You are ${shortfall} below your month-to-date target of ${row.metrics.required_orders} (${target} per working day). Please speak to your supervisor.`,
        deepLink: "musallam:///profile/performance-level",
        category: "performance",
        priority: "high",
        actionParams: {
          record_type: "driver_level",
          record_id: row.driver_id,
          month,
          level: "D",
        },
        createdBy: staff.uid,
      });
    }
  }

  return {
    ok: true,
    month,
    dry_run: dryRun,
    window: { from: facts.from, to: facts.to },
    rows: rows.length,
    level_d: rows.filter((row) => row.level === DRIVER_LEVEL_D).length,
    transitions: transitions.length,
    notified: notify && !dryRun ? transitions.length : 0,
    live_deliveries: facts.liveDeliveries,
    drivers: transitions.map((row) => ({
      driver_id: row.driver_id,
      driver_name: row.driver_name,
      driver_code: row.driver_code,
      gap: row.metrics.gap,
    })),
  };
});
