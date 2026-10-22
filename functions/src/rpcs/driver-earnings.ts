import { onCall, type CallableRequest } from "firebase-functions/v2/https";
import { measureOnCall } from "../core/fs-metrics";
import { getFirestore, Timestamp } from "../core/fs";
import { COLLECTIONS } from "../core/collections";
import { daysInMonth, kuwaitDayEnd, kuwaitDayStart, kuwaitDayString } from "../core/kuwait";
import { computeSourceCompanyIncentive, periodStart, roundKwd } from "../core/money";
import {
  companySchemeGoverns,
  computeIncentiveAmount,
  deliveryMatchesRules,
  incentiveBandStart,
  partnerDailyDpdTarget,
  restaurantDailyDpdTarget,
  ruleMatchesScope,
  ruleScopeRows,
  zoneDailyDpdTarget,
  type IncentiveRule,
  type IncentiveTier,
  type RuleScope,
  type SourceCompanyConfig,
} from "../core/incentive";
import {
  countEligibleDeliveries,
  dpdTargetForRule,
  loadIncentiveContext,
  loadVerifiedDeliveriesForDeliveredDay,
  normaliseDelivery,
  type IncentiveContext,
  type RawDelivery,
} from "../core/incentive-store";
import { requireRider, riderError } from "../core/rider";
import { driverRestaurantIds } from "./deliveries-shared";
import {
  isoTimestamp,
  loadDocMap,
  numberOrNull,
  pick,
  pickDay,
  pickId,
  type Dict,
} from "./_shared";

const DRIVER_ATTENDANCE = "driver_attendance";
const SCAN = 20_000;
const PROGRESS_STATUSES = new Set(["in_transit", "pending", "under_review", "verified"]);
const LIFETIME_STATUSES = ["pending", "in_transit", "under_review", "verified", "rejected"] as const;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TRAILING_ISO_DATE = /\s+\d{4}-\d{2}-\d{2}$/;

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function asDay(value: unknown): string | null {
  const text = asString(value);
  return text ? text.slice(0, 10) : null;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
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

export function earningsDocId(driverId: string, earnDate: string): string {
  return `${driverId}_${earnDate}`;
}

export function stripDisplayName(name: string): string {
  return name.trim().replace(TRAILING_ISO_DATE, "");
}

export type ExtraEarningsPath = "company_scheme" | "rules";

/**
 * Which pricing path `driverGetExtraEarnings` shows a rider.
 *
 * `company_scheme` only when the outsourced company's own scheme is live, enabled
 * and carries a target (`companySchemeGoverns`). Everything else — in-house, a
 * staged company, or a company with the incentive flag off — reads the
 * restaurant/zone/partner rules, so an Active rule can never be silently
 * swallowed by a company row that prices nothing.
 */
export function extraEarningsPath(args: {
  riderCategory: string | null;
  company: SourceCompanyConfig | null;
  onDate: string;
}): ExtraEarningsPath {
  return companySchemeGoverns(args) ? "company_scheme" : "rules";
}

export function elapsedDays(today: string, year: number, month: number): number {
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const last = daysInMonth(year, month);
  const end = `${start.slice(0, 7)}-${String(last).padStart(2, "0")}`;
  if (today < start) return 0;
  if (today > end) return last;
  return Number(today.slice(8, 10));
}

export function attendancePct(present: number, elapsed: number): number {
  if (elapsed <= 0) return 0;
  return Math.min(100, Math.round((present / elapsed) * 100));
}

export function parseWorkPeriod(year: unknown, month: unknown): { year: number; month: number } | null {
  const y = typeof year === "number" ? year : typeof year === "string" ? Number(year) : NaN;
  const m = typeof month === "number" ? month : typeof month === "string" ? Number(month) : NaN;
  if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) return null;
  return { year: y, month: m };
}

export function remainingDeliveries(target: number, eligible: number): number {
  return Math.max(0, target - eligible);
}

export function offerCompleted(target: number, eligible: number): boolean {
  return target <= 0 || eligible >= target;
}

export function offerPendingVerification(target: number, progress: number, eligible: number): boolean {
  return target > 0 && progress >= target && eligible < target;
}

export function offerTarget(args: {
  targetMode: string;
  targetDeliveries: number | null;
  baseMinimum: number | null;
  tiers: readonly IncentiveTier[];
}): number {
  if (args.targetMode === "tiered") {
    const maxTier = args.tiers.reduce((max, tier) => Math.max(max, tier.threshold_deliveries), 0);
    return Math.max(maxTier, args.baseMinimum ?? 0, 0);
  }
  return args.targetDeliveries ?? 0;
}

export function bandFields(args: {
  bandStart: number | null;
  eligible: number;
  tiers: readonly IncentiveTier[];
}): Dict {
  const { bandStart, eligible, tiers } = args;
  if (bandStart === null) return { band_start: null };
  const sorted = [...tiers].sort((a, b) => a.threshold_deliveries - b.threshold_deliveries);
  const floor = Math.max(eligible, bandStart);
  const current = sorted.find((tier) => tier.threshold_deliveries > floor) ?? null;
  const next =
    current === null
      ? null
      : (sorted.find((tier) => tier.threshold_deliveries > current.threshold_deliveries) ?? null);
  return {
    band_start: bandStart,
    locked: eligible < bandStart,
    extra_orders: Math.max(0, eligible - bandStart),
    current_rate_kwd: current?.reward_per_delivery_kwd ?? null,
    next_rate_kwd: next?.reward_per_delivery_kwd ?? null,
    orders_to_next_rate:
      next !== null && current !== null ? current.threshold_deliveries - floor : null,
  };
}

/**
 * `incentive_rule_matches_driver`: whether a rule names this rider, through the
 * rider's own zone/partner or through any restaurant they deliver for.
 *
 * Delegates to the canonical matcher (`ruleMatchesScope`) so the legacy
 * single-FK column is honoured exactly as `countEligibleDeliveries` honours it —
 * an older rule that never got a junction row must still reach the phone.
 */
function ruleMatchesDriver(args: {
  rule: IncentiveRule;
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
  if (rule.scope_type === "restaurant") {
    return restaurantIds.some((id) =>
      ruleMatchesScope(rule, scopes, {
        zone_id: null,
        partner_id: null,
        restaurant_id: id,
      }),
    );
  }
  return false;
}

function deliveryProgressMatchesRules(args: {
  delivery: {
    status: string;
    zone_id: string | null;
    partner_id: string | null;
    scope_restaurant_id: string | null;
  };
  checkDate: string;
  context: IncentiveContext;
}): boolean {
  if (!PROGRESS_STATUSES.has(args.delivery.status)) return false;
  return deliveryMatchesRules({
    delivery: { ...args.delivery, status: "verified" },
    checkDate: args.checkDate,
    deliveryRules: args.context.deliveryRules,
    deliveryScopesByRule: args.context.deliveryScopesByRule,
  });
}

export function deliveryInProgressPeriod(
  delivery: RawDelivery,
  startDay: string,
  endDay: string,
): boolean {
  if (delivery.shift_date) {
    return delivery.shift_date >= startDay && delivery.shift_date <= endDay;
  }
  const startMs = kuwaitDayStart(startDay).getTime();
  const endMs = kuwaitDayEnd(endDay).getTime();
  if (delivery.delivered_at) {
    const at = delivery.delivered_at.getTime();
    return at >= startMs && at < endMs;
  }
  if (delivery.pickup_at) {
    const at = delivery.pickup_at.getTime();
    return at >= startMs && at < endMs;
  }
  return false;
}

export function countProgressDeliveries(args: {
  driverId: string;
  earnDate: string;
  ruleId: string;
  context: IncentiveContext;
  deliveries: readonly RawDelivery[];
}): number {
  const { driverId, earnDate, ruleId, context, deliveries } = args;
  const rule = context.ruleById.get(ruleId);
  if (!rule) return 0;
  const startDay = periodStart(rule.period, earnDate);
  const scopes = context.incentiveScopesByRule.get(ruleId) ?? [];
  return deliveries.filter((delivery) => {
    if (delivery.driver_id !== driverId) return false;
    if (!PROGRESS_STATUSES.has(delivery.status)) return false;
    if (!deliveryInProgressPeriod(delivery, startDay, earnDate)) return false;
    if (
      !deliveryProgressMatchesRules({
        delivery: {
          status: delivery.status,
          zone_id: delivery.zone_id,
          partner_id: delivery.partner_id,
          scope_restaurant_id: delivery.restaurant_id,
        },
        checkDate: earnDate,
        context,
      })
    ) {
      return false;
    }
    return ruleMatchesScope(rule, scopes, {
      zone_id: delivery.zone_id,
      partner_id: delivery.partner_id,
      restaurant_id: delivery.restaurant_id,
    });
  }).length;
}

function inDriverDay(delivery: RawDelivery, day: string, allowPickup: boolean): boolean {
  if (delivery.shift_date) return delivery.shift_date === day;
  const startMs = kuwaitDayStart(day).getTime();
  const endMs = kuwaitDayEnd(day).getTime();
  if (delivery.delivered_at) {
    const at = delivery.delivered_at.getTime();
    return at >= startMs && at < endMs;
  }
  if (allowPickup && delivery.pickup_at) {
    const at = delivery.pickup_at.getTime();
    return at >= startMs && at < endMs;
  }
  return false;
}

function workingDayOf(delivery: RawDelivery): string | null {
  if (delivery.shift_date) return delivery.shift_date;
  const instant = delivery.delivered_at ?? delivery.pickup_at;
  return instant ? kuwaitDayString(instant) : null;
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

async function loadSourceCompany(key: string | null): Promise<SourceCompanyConfig | null> {
  if (!key) return null;
  const db = getFirestore();
  const byId = await db.collection(COLLECTIONS.sourceCompanies).doc(key).get();
  let raw: Dict | null = byId.exists ? ((byId.data() ?? {}) as Dict) : null;
  if (raw === null) {
    const snap = await db.collection(COLLECTIONS.sourceCompanies).where("key", "==", key).limit(1).get();
    if (!snap.empty) raw = (snap.docs[0].data() ?? {}) as Dict;
  }
  if (raw === null) return null;
  return {
    key: asString(raw["key"]) ?? key,
    name: asString(raw["name"]) ?? key,
    incentive_enabled: raw["incentive_enabled"] === true,
    dpd_target: numberOrNull(raw["dpd_target"]),
    incentive_above_kwd: numberOrNull(raw["incentive_above_kwd"]),
    incentive_below_kwd: numberOrNull(raw["incentive_below_kwd"]),
    effective_from: asDay(raw["effective_from"]),
  };
}

async function loadRiderDeliveries(driverId: string, statuses: readonly string[]): Promise<RawDelivery[]> {
  const db = getFirestore();
  const snap = await db
    .collection(COLLECTIONS.deliveries)
    .where("driver_id", "==", driverId)
    .where("status", "in", [...statuses])
    .limit(SCAN)
    .get();
  return snap.docs.map((doc) => normaliseDelivery(doc.id, doc.data() ?? {}));
}

/** One window page per range field: a month of one rider's deliveries. */
const RANGE_SCAN = 1_000;

/**
 * A rider's deliveries inside a Kuwait day window.
 *
 * This replaces a lifetime `limit(20_000)` read that every rider paid on every
 * call, to answer a question that is only ever about one day, week or month.
 * The day test has to follow `shift_date` → `delivered_at` → `pickup_at`, so two
 * range prefilters cover the stored range fields and the existing in-memory test
 * still decides. A rider with nothing in the window at all falls back to the
 * lifetime page, so a pre-trigger row that only carries `pickup_at` is not
 * silently dropped. An index that is not deployed yet also takes that path.
 */
async function loadRiderDeliveriesInRange(
  driverId: string,
  statuses: readonly string[],
  fromDay: string,
  toDay: string,
): Promise<RawDelivery[]> {
  const db = getFirestore();
  const page = async (field: string) => {
    try {
      return await db
        .collection(COLLECTIONS.deliveries)
        .where("driver_id", "==", driverId)
        .where("status", "in", [...statuses])
        .where(field, ">=", fromDay)
        .where(field, "<=", toDay)
        .limit(RANGE_SCAN)
        .get();
    } catch {
      return null;
    }
  };

  const [byShift, byDelivered] = await Promise.all([page("shift_date"), page("delivered_day")]);
  if (!byShift || !byDelivered) return loadRiderDeliveries(driverId, statuses);
  if (byShift.empty && byDelivered.empty) return loadRiderDeliveries(driverId, statuses);

  const rows = new Map<string, RawDelivery>();
  for (const snap of [byShift, byDelivered]) {
    for (const doc of snap.docs) rows.set(doc.id, normaliseDelivery(doc.id, doc.data() ?? {}));
  }
  return [...rows.values()];
}

/**
 * One month of `driver_attendance` day rows.
 *
 * A `YYYY-MM-DD` string range is the normal case — rows are written with a
 * string day. A `Timestamp`-valued `attendance_date` cannot match that range, so
 * an empty range falls back to the rider page the range replaced.
 */
async function monthAttendancePage(driverId: string, fromDay: string, toDay: string) {
  const db = getFirestore();
  try {
    const ranged = await db
      .collection(DRIVER_ATTENDANCE)
      .where("driver_id", "==", driverId)
      .where("attendance_date", ">=", fromDay)
      .where("attendance_date", "<=", toDay)
      .limit(60)
      .get();
    if (!ranged.empty) return ranged;
  } catch {
    /* fall through to the rider page */
  }
  return db.collection(DRIVER_ATTENDANCE).where("driver_id", "==", driverId).limit(400).get();
}

async function countByStatuses(driverId: string, statuses: readonly string[]): Promise<number> {
  const snap = await getFirestore()
    .collection(COLLECTIONS.deliveries)
    .where("driver_id", "==", driverId)
    .where("status", "in", [...statuses])
    .count()
    .get();
  return snap.data().count;
}

async function countStatus(driverId: string, status: string): Promise<number> {
  const snap = await getFirestore()
    .collection(COLLECTIONS.deliveries)
    .where("driver_id", "==", driverId)
    .where("status", "==", status)
    .count()
    .get();
  return snap.data().count;
}

function scopeNames(
  scopeType: string,
  scopes: Array<{ zone_id: string | null; partner_id: string | null; restaurant_id: string | null }>,
  names: { restaurant: Map<string, Dict>; partner: Map<string, Dict>; zone: Map<string, Dict> },
): string | null {
  const labels: string[] = [];
  for (const scope of scopes) {
    if (scopeType === "restaurant" && scope.restaurant_id) {
      const name = asString(names.restaurant.get(scope.restaurant_id)?.["name"]);
      if (name) labels.push(name);
    } else if (scopeType === "partner" && scope.partner_id) {
      const name = asString(names.partner.get(scope.partner_id)?.["name"]);
      if (name) labels.push(name);
    } else if (scopeType === "zone" && scope.zone_id) {
      const name = asString(names.zone.get(scope.zone_id)?.["name"]);
      if (name) labels.push(name);
    }
  }
  labels.sort((a, b) => a.localeCompare(b));
  return labels.length ? labels.join(", ") : null;
}

function liveIncentiveDetail(args: {
  driverId: string;
  earnDate: string;
  dayDeliveries: readonly RawDelivery[];
  context: IncentiveContext;
}): { incentive: number; lines: Dict[] } {
  const { driverId, earnDate, dayDeliveries, context } = args;
  const rules = context.rules
    .filter((rule) => rule.status === "active" && earnDate >= rule.start_date && earnDate <= rule.end_date)
    .sort((a, b) => {
      if (a.priority !== b.priority) return b.priority - a.priority;
      if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

  let incentive = 0;
  let overrideAmount = -1;
  let overridePriority = -1;
  let overrideRuleId: string | null = null;
  const lines: Dict[] = [];

  for (const rule of rules) {
    const tiers = context.tiersByRule.get(rule.id) ?? [];
    const eligible = countEligibleDeliveries({
      driverId,
      earnDate,
      ruleId: rule.id,
      context,
      deliveries: dayDeliveries,
      scopeRestaurantIdOf: (delivery) => delivery.restaurant_id,
    });
    const amount = roundKwd(
      computeIncentiveAmount({
        rule,
        tiers,
        eligibleCount: eligible,
        gateTarget: dpdTargetForRule(context, rule.id, earnDate),
      }),
    );
    if (amount <= 0) continue;
    incentive = roundKwd(incentive + amount);
    if (rule.overrides_others && rule.priority > overridePriority) {
      overrideAmount = amount;
      overridePriority = rule.priority;
      overrideRuleId = rule.id;
    }
    lines.push({
      rule_id: rule.id,
      rule_name: rule.name,
      period: rule.period,
      eligible_count: eligible,
      target_mode: rule.target_mode,
      base_minimum: rule.base_minimum_deliveries,
      target: rule.target_deliveries,
      reward_mode: rule.reward_mode,
      payout_mode: rule.payout_mode,
      overrides_others: rule.overrides_others,
      priority: rule.priority,
      amount_kwd: amount,
      tiers:
        rule.target_mode === "tiered"
          ? [...tiers]
              .sort((a, b) => a.threshold_deliveries - b.threshold_deliveries)
              .map((tier) => ({
                threshold: tier.threshold_deliveries,
                reward_mode: tier.reward_mode,
                met: eligible >= tier.threshold_deliveries,
              }))
          : [],
    });
  }

  if (overrideAmount >= 0) {
    incentive = overrideAmount;
    lines.push({
      override_rule_id: overrideRuleId,
      note: "override_applied",
      final_incentive_kwd: overrideAmount,
    });
  }
  return { incentive, lines };
}

/**
 * The store's **own** restaurant-scoped daily target, or null when no
 * restaurant-scoped rule names it. Used only to tell whether a store card
 * inherited its target from a zone/partner rule.
 */
function restaurantScopeTarget(
  restaurantId: string,
  onDate: string,
  context: IncentiveContext,
): number | null {
  const isDaily = (rule: { status: string; dpd_target: number | null; dpd_period?: string | null; start_date: string; end_date: string }) =>
    rule.status === "active" &&
    (rule.dpd_target ?? 0) > 0 &&
    (rule.dpd_period === null || rule.dpd_period === undefined || rule.dpd_period === "daily") &&
    onDate >= rule.start_date &&
    onDate <= rule.end_date;

  const candidates = context.deliveryRules.filter((rule) => {
    if (!isDaily(rule) || rule.scope_type !== "restaurant") return false;
    if (rule.restaurant_id === restaurantId) return true;
    return (context.deliveryScopesByRule.get(rule.id) ?? []).some(
      (scope) => scope.restaurant_id === restaurantId,
    );
  });
  if (candidates.length === 0) return null;
  const sorted = [...candidates].sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority;
    return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0;
  });
  return Math.ceil(sorted[0].dpd_target as number);
}

/**
 * The daily target a store card shows: the store's own rule, then the zone it
 * sits in, then its partner.
 *
 * This is `restaurantDailyDpdTarget` (the same chain the primary `daily_dpd`
 * card, the offer gate and Performance DPD read), so a rule written at zone or
 * partner level reaches the per-store card too. Before, this function only
 * looked at restaurant-scoped rules and an operator's zone/partner target showed
 * up as a card with no store name — or not at all.
 */
function restaurantOwnTarget(
  restaurantId: string,
  onDate: string,
  context: IncentiveContext,
): number | null {
  return restaurantDailyDpdTarget({
    restaurantId,
    onDate,
    restaurantZoneId: context.restaurantZoneById.get(restaurantId) ?? null,
    restaurantPartnerId: context.restaurantPartnerById.get(restaurantId) ?? null,
    deliveryRules: context.deliveryRules,
    deliveryScopesByRule: context.deliveryScopesByRule,
  });
}

/**
 * Zones that can carry this rider's target: their assigned zone first, then the
 * zones of the stores they deliver for.
 *
 * The second half is the fallback that lets a zone-scoped rule reach a rider
 * whose own `zone_id` was never filled in. The admin writes the rule against a
 * zone, not against a rider, so the rider has to be resolved from where they
 * actually work.
 */
function zoneCandidates(
  driver: Dict,
  restaurantIds: readonly string[],
  context: IncentiveContext,
): string[] {
  const ids = new Set<string>();
  const assigned = asString(driver["zone_id"]);
  if (assigned) ids.add(assigned);
  const fromStores = [...new Set(restaurantIds)]
    .map((id) => context.restaurantZoneById.get(id) ?? null)
    .filter((id): id is string => Boolean(id))
    .sort();
  for (const id of fromStores) ids.add(id);
  return [...ids];
}

/** The same chain for partner-scoped rules: own partner first, then the stores'. */
function partnerCandidates(
  driver: Dict,
  restaurantIds: readonly string[],
  context: IncentiveContext,
): string[] {
  const ids = new Set<string>();
  const assigned = asString(driver["partner_id"]);
  if (assigned) ids.add(assigned);
  const fromStores = [...new Set(restaurantIds)]
    .map((id) => context.restaurantPartnerById.get(id) ?? null)
    .filter((id): id is string => Boolean(id))
    .sort();
  for (const id of fromStores) ids.add(id);
  return [...ids];
}

/** The first candidate id that resolves a daily target, or null when none does. */
function firstTarget(
  ids: readonly string[],
  resolve: (id: string) => number | null,
): { id: string; target: number } | null {
  for (const id of ids) {
    const target = resolve(id);
    if (target !== null && target > 0) return { id, target };
  }
  return null;
}

function zoneOwnTarget(zoneId: string, onDate: string, context: IncentiveContext): number | null {
  return zoneDailyDpdTarget({
    zoneId,
    onDate,
    deliveryRules: context.deliveryRules,
    deliveryScopesByRule: context.deliveryScopesByRule,
  });
}

function partnerOwnTarget(
  partnerId: string,
  onDate: string,
  context: IncentiveContext,
): number | null {
  return partnerDailyDpdTarget({
    partnerId,
    onDate,
    deliveryRules: context.deliveryRules,
    deliveryScopesByRule: context.deliveryScopesByRule,
  });
}

async function buildDailyDpdTargets(args: {
  driverId: string;
  driver: Dict;
  today: string;
  restaurantIds: readonly string[];
  deliveries: readonly RawDelivery[];
  context: IncentiveContext;
}): Promise<Dict[]> {
  const { driverId, driver, today, restaurantIds, deliveries, context } = args;
  const restaurantMap = await loadDocMap(COLLECTIONS.restaurants, restaurantIds);
  const cards: Dict[] = [];

  const named = restaurantIds
    .map((id) => ({ id, name: asString(restaurantMap.get(id)?.["name"]) ?? "" }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const inheritedZones = new Set<string>();
  const inheritedPartners = new Set<string>();

  for (const restaurant of named) {
    const target = restaurantOwnTarget(restaurant.id, today, context);
    if (target === null || target <= 0) continue;
    // A store without its own rule inherits the zone/partner target. Remember
    // which zone/partner already reaches the phone through a store card so the
    // aggregate card below is not painted a second time, and count the inherited
    // target against the scope it was written for — a zone goal shown as "2/21"
    // for one store would be a lie.
    const zoneId = context.restaurantZoneById.get(restaurant.id) ?? null;
    const partnerId = context.restaurantPartnerById.get(restaurant.id) ?? null;
    const ownTarget = restaurantScopeTarget(restaurant.id, today, context);
    const inheritedZone =
      ownTarget === null && zoneId !== null && zoneOwnTarget(zoneId, today, context) === target
        ? zoneId
        : null;
    const inheritedPartner =
      inheritedZone === null &&
      ownTarget === null &&
      partnerId !== null &&
      partnerOwnTarget(partnerId, today, context) === target
        ? partnerId
        : null;
    if (inheritedZone !== null) inheritedZones.add(inheritedZone);
    if (inheritedPartner !== null) inheritedPartners.add(inheritedPartner);

    const ofScope =
      inheritedZone !== null
        ? deliveries.filter(
            (delivery) =>
              (delivery.zone_id ??
                context.restaurantZoneById.get(delivery.restaurant_id ?? "") ??
                null) === inheritedZone,
          )
        : inheritedPartner !== null
          ? deliveries.filter(
              (delivery) =>
                (delivery.partner_id ??
                  context.restaurantPartnerById.get(delivery.restaurant_id ?? "") ??
                  null) === inheritedPartner,
            )
          : deliveries.filter((delivery) => delivery.restaurant_id === restaurant.id);
    const completed = ofScope.filter(
      (delivery) => delivery.status === "verified" && inDriverDay(delivery, today, false),
    ).length;
    const progress = ofScope.filter(
      (delivery) => PROGRESS_STATUSES.has(delivery.status) && inDriverDay(delivery, today, true),
    ).length;
    cards.push({
      kind: "restaurant",
      name: restaurant.name,
      target,
      completed_today: completed,
      progress_today: progress,
    });
  }

  // Zone, then partner: two rule scopes the rider inherits rather than owns.
  // Both resolve through the rider's own assignment first and fall back to the
  // stores they deliver for, so a rule written above the store level still
  // reaches the phone (QA: "Delivery rule > Target").
  const zone = firstTarget(zoneCandidates(driver, restaurantIds, context), (id) =>
    zoneOwnTarget(id, today, context),
  );
  if (zone && !inheritedZones.has(zone.id)) {
    const zoneDoc = (await loadDocMap(COLLECTIONS.zones, [zone.id])).get(zone.id);
    const zoneName = asString(zoneDoc?.["name"]);
    if (zoneName) {
      const zoneOf = (delivery: RawDelivery) =>
        delivery.zone_id ?? context.restaurantZoneById.get(delivery.restaurant_id ?? "") ?? null;
      const completed = deliveries.filter(
        (delivery) =>
          delivery.status === "verified" &&
          inDriverDay(delivery, today, false) &&
          zoneOf(delivery) === zone.id,
      ).length;
      const progress = deliveries.filter(
        (delivery) =>
          PROGRESS_STATUSES.has(delivery.status) &&
          inDriverDay(delivery, today, true) &&
          zoneOf(delivery) === zone.id,
      ).length;
      cards.push({
        kind: "zone",
        name: zoneName,
        target: zone.target,
        completed_today: completed,
        progress_today: progress,
      });
    }
  }

  const partner = firstTarget(partnerCandidates(driver, restaurantIds, context), (id) =>
    partnerOwnTarget(id, today, context),
  );
  if (partner && !inheritedPartners.has(partner.id)) {
    const partnerDoc = (await loadDocMap(COLLECTIONS.partners, [partner.id])).get(partner.id);
    const partnerName = asString(partnerDoc?.["name"]);
    if (partnerName) {
      const partnerOf = (delivery: RawDelivery) =>
        delivery.partner_id ??
        context.restaurantPartnerById.get(delivery.restaurant_id ?? "") ??
        null;
      const completed = deliveries.filter(
        (delivery) =>
          delivery.status === "verified" &&
          inDriverDay(delivery, today, false) &&
          partnerOf(delivery) === partner.id,
      ).length;
      const progress = deliveries.filter(
        (delivery) =>
          PROGRESS_STATUSES.has(delivery.status) &&
          inDriverDay(delivery, today, true) &&
          partnerOf(delivery) === partner.id,
      ).length;
      cards.push({
        kind: "partner",
        name: partnerName,
        target: partner.target,
        completed_today: completed,
        progress_today: progress,
      });
    }
  }

  void driverId;
  return cards;
}

async function buildDailyDpd(args: {
  driverId: string;
  driver: Dict;
  today: string;
  restaurantIds: readonly string[];
  company: SourceCompanyConfig | null;
  companyGoverns: boolean;
  deliveries: readonly RawDelivery[];
  context: IncentiveContext;
}): Promise<Dict | null> {
  const { driverId, driver, today, restaurantIds, company, companyGoverns, deliveries, context } = args;

  if (companyGoverns) {
    const target = company?.dpd_target ?? null;
    if (target === null || target <= 0) return null;
    const completed = deliveries.filter(
      (delivery) => delivery.status === "verified" && inDriverDay(delivery, today, false),
    ).length;
    const progress = deliveries.filter(
      (delivery) => PROGRESS_STATUSES.has(delivery.status) && inDriverDay(delivery, today, true),
    ).length;
    return {
      target,
      completed_today: completed,
      progress_today: progress,
      remaining: Math.max(0, target - completed),
      achieved: completed >= target,
      rule_id: null,
      restaurant_id: null,
      restaurant_name: null,
      company_name: company?.name ?? null,
      shift_date: today,
    };
  }

  const zoneId = asString(args.driver["zone_id"]);
  const partnerId = asString(args.driver["partner_id"]);
  const matching = context.rules
    .filter(
      (rule) =>
        rule.status === "active" &&
        today >= rule.start_date &&
        today <= rule.end_date &&
        ruleMatchesDriver({
          rule,
          scopes: context.incentiveScopesByRule.get(rule.id) ?? [],
          zoneId,
          partnerId,
          restaurantIds,
        }),
    )
    .sort((a, b) => {
      if (a.priority !== b.priority) return b.priority - a.priority;
      if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

  let ruleId: string | null = null;
  let target: number | null = null;
  for (const rule of matching) {
    const band = incentiveBandStart(
      rule,
      context.tiersByRule.get(rule.id) ?? [],
      dpdTargetForRule(context, rule.id, today),
    );
    if (band !== null) {
      ruleId = rule.id;
      target = band;
      break;
    }
  }

  if (ruleId !== null && target !== null) {
    const completed = countEligibleDeliveries({
      driverId,
      earnDate: today,
      ruleId,
      context,
      deliveries,
      scopeRestaurantIdOf: (delivery) => delivery.restaurant_id,
    });
    const progress = countProgressDeliveries({
      driverId,
      earnDate: today,
      ruleId,
      context,
      deliveries,
    });
    const restaurantIdsOfRule = context.restaurantIdsOf(ruleId);
    const restaurantMap = await loadDocMap(COLLECTIONS.restaurants, restaurantIdsOfRule);
    const ranked = restaurantIdsOfRule
      .map((id) => ({
        id,
        name: asString(restaurantMap.get(id)?.["name"]),
        match: restaurantDailyDpdTarget({
          restaurantId: id,
          onDate: today,
          restaurantZoneId: context.restaurantZoneById.get(id) ?? null,
          restaurantPartnerId: context.restaurantPartnerById.get(id) ?? null,
          deliveryRules: context.deliveryRules,
          deliveryScopesByRule: context.deliveryScopesByRule,
        }) === target,
      }))
      .sort((a, b) => Number(b.match) - Number(a.match) || (a.name ?? "").localeCompare(b.name ?? ""));
    const picked = ranked[0];
    return {
      target,
      completed_today: completed,
      progress_today: progress,
      remaining: Math.max(0, target - completed),
      achieved: completed >= target,
      rule_id: ruleId,
      restaurant_id: picked?.id ?? null,
      restaurant_name: picked?.name ?? null,
      shift_date: today,
    };
  }

  for (const restaurantId of restaurantIds) {
    const restaurantTarget = restaurantDailyDpdTarget({
      restaurantId,
      onDate: today,
      restaurantZoneId: context.restaurantZoneById.get(restaurantId) ?? null,
      restaurantPartnerId: context.restaurantPartnerById.get(restaurantId) ?? null,
      deliveryRules: context.deliveryRules,
      deliveryScopesByRule: context.deliveryScopesByRule,
    });
    if (restaurantTarget === null || restaurantTarget <= 0) continue;
    const ofRestaurant = deliveries.filter((delivery) => delivery.restaurant_id === restaurantId);
    const completed = ofRestaurant.filter(
      (delivery) => delivery.status === "verified" && inDriverDay(delivery, today, false),
    ).length;
    const progress = ofRestaurant.filter(
      (delivery) => PROGRESS_STATUSES.has(delivery.status) && inDriverDay(delivery, today, true),
    ).length;
    const restaurantMap = await loadDocMap(COLLECTIONS.restaurants, [restaurantId]);
    return {
      target: restaurantTarget,
      completed_today: completed,
      progress_today: progress,
      remaining: Math.max(0, restaurantTarget - completed),
      achieved: completed >= restaurantTarget,
      rule_id: null,
      restaurant_id: restaurantId,
      restaurant_name: asString(restaurantMap.get(restaurantId)?.["name"]),
      shift_date: today,
    };
  }

  // Nothing at store level, so the scopes above the store get their say: a rider
  // with no store rule — or no store at all — still resolves the target their
  // zone or partner was given, which keeps an active rule visible on the phone
  // (QA: "Delivery rule > Target").
  const dailyRow = (
    target: number,
    of: (delivery: RawDelivery) => boolean,
    names: Dict,
  ): Dict => {
    const completed = deliveries.filter(
      (delivery) =>
        delivery.status === "verified" && inDriverDay(delivery, today, false) && of(delivery),
    ).length;
    const progress = deliveries.filter(
      (delivery) =>
        PROGRESS_STATUSES.has(delivery.status) && inDriverDay(delivery, today, true) && of(delivery),
    ).length;
    return {
      target,
      completed_today: completed,
      progress_today: progress,
      remaining: Math.max(0, target - completed),
      achieved: completed >= target,
      rule_id: null,
      ...names,
      shift_date: today,
    };
  };

  const zone = firstTarget(zoneCandidates(driver, restaurantIds, context), (id) =>
    zoneOwnTarget(id, today, context),
  );
  if (zone) {
    const zoneName = asString(
      (await loadDocMap(COLLECTIONS.zones, [zone.id])).get(zone.id)?.["name"],
    );
    if (zoneName) {
      return dailyRow(
        zone.target,
        (delivery) =>
          (delivery.zone_id ??
            context.restaurantZoneById.get(delivery.restaurant_id ?? "") ??
            null) === zone.id,
        {
          restaurant_id: null,
          restaurant_name: null,
          zone_id: zone.id,
          zone_name: zoneName,
        },
      );
    }
  }

  const partner = firstTarget(partnerCandidates(driver, restaurantIds, context), (id) =>
    partnerOwnTarget(id, today, context),
  );
  if (partner) {
    const partnerName = asString(
      (await loadDocMap(COLLECTIONS.partners, [partner.id])).get(partner.id)?.["name"],
    );
    if (partnerName) {
      return dailyRow(
        partner.target,
        (delivery) =>
          (delivery.partner_id ??
            context.restaurantPartnerById.get(delivery.restaurant_id ?? "") ??
            null) === partner.id,
        {
          restaurant_id: null,
          restaurant_name: null,
          partner_id: partner.id,
          partner_name: partnerName,
        },
      );
    }
  }

  return null;
}

export const driverGetEarningsSummary = onCall(async (request) => {
  const ctx = await requireRider(request);
  const [total, verified, pending, inTransit, rejected] = await Promise.all([
    countByStatuses(ctx.uid, LIFETIME_STATUSES),
    countStatus(ctx.uid, "verified"),
    countStatus(ctx.uid, "pending"),
    countStatus(ctx.uid, "in_transit"),
    countStatus(ctx.uid, "rejected"),
  ]);
  return {
    total_deliveries: total,
    verified_deliveries: verified,
    pending_deliveries: pending + inTransit,
    rejected_deliveries: rejected,
    ok: true,
  };
});

export const driverGetWorkSummary = onCall(async (request) => {
  const ctx = await requireRider(request);
  const data = (request.data ?? {}) as Dict;
  const period = parseWorkPeriod(
    pick(data, "p_year", "year"),
    pick(data, "p_month", "month"),
  );
  if (!period) throw riderError("invalid-argument", "invalid_period");

  const today = kuwaitDayString(new Date());
  const start = `${period.year}-${String(period.month).padStart(2, "0")}-01`;
  const end = `${start.slice(0, 7)}-${String(daysInMonth(period.year, period.month)).padStart(2, "0")}`;
  const elapsed = elapsedDays(today, period.year, period.month);
  const presentUntil = today < end ? today : end;

  const [attendanceSnap, deliveries] = await Promise.all([
    monthAttendancePage(ctx.uid, start, presentUntil),
    loadRiderDeliveriesInRange(ctx.uid, LIFETIME_STATUSES, start, end),
  ]);

  let present = 0;
  for (const doc of attendanceSnap.docs) {
    const raw = (doc.data() ?? {}) as Dict;
    const day = asDay(raw["attendance_date"]);
    const status = asString(raw["status"]);
    if (!day || day < start || day > presentUntil) continue;
    if (status === "present" || status === "online_unvalidated") present += 1;
  }

  const days = new Set<string>();
  for (const delivery of deliveries) {
    if (delivery.status === "cancelled") continue;
    const day = workingDayOf(delivery);
    if (day && day >= start && day <= end) days.add(day);
  }

  return {
    year: period.year,
    month: period.month,
    present_days: present,
    elapsed_days: elapsed,
    working_days: days.size,
    attendance_pct: attendancePct(present, elapsed),
  };
});

export const driverGetExtraEarnings = onCall(async (request) => {
  const ctx = await requireRider(request);
  const today = kuwaitDayString(new Date());
  // The widest window any rule can need: a monthly plan counts from the 1st, a
  // weekly one from the week start, and the company scheme only counts today.
  const monthStart = periodStart("monthly", today);
  const [context, restaurantIds, company, deliveries] = await Promise.all([
    loadIncentiveContext(),
    assignedRestaurantIds(ctx.uid, ctx.driver as Dict),
    loadSourceCompany(asString(ctx.driver["source_company"])),
    loadRiderDeliveriesInRange(ctx.uid, [...PROGRESS_STATUSES], monthStart, today),
  ]);

  // The company scheme replaces the rules only when it can actually pay:
  // outsourced, live from today, `incentive_enabled` and carrying a target. A
  // staged company row with the flag off must not blank the rider's rules — that
  // is the black hole where an Active incentive rule reached nobody.
  const extraPath = extraEarningsPath({
    riderCategory: asString(ctx.driver["rider_category"]),
    company,
    onDate: today,
  });
  const companyGoverns = extraPath === "company_scheme";

  let companyScheme: Dict | null = null;
  const offers: Dict[] = [];

  if (companyGoverns) {
    if (company?.incentive_enabled) {
      const completed = deliveries.filter(
        (delivery) => delivery.status === "verified" && inDriverDay(delivery, today, false),
      ).length;
      const progress = deliveries.filter(
        (delivery) => PROGRESS_STATUSES.has(delivery.status) && inDriverDay(delivery, today, true),
      ).length;
      const scheme = computeSourceCompanyIncentive(
        completed,
        company.dpd_target ?? 0,
        company.incentive_above_kwd,
        company.incentive_below_kwd,
      );
      companyScheme = {
        company_name: company.name,
        target: company.dpd_target,
        above_kwd: company.incentive_above_kwd,
        below_kwd: company.incentive_below_kwd,
        completed_today: completed,
        progress_today: progress,
        incentive_kwd: scheme.incentive_kwd,
        deduction_kwd: scheme.deduction_kwd,
        net_kwd: scheme.net_kwd,
      };
    }
  } else {
    const zoneId = asString(ctx.driver["zone_id"]);
    const partnerId = asString(ctx.driver["partner_id"]);
    const matching = context.rules
      .filter(
        (rule) =>
          rule.status === "active" &&
          today >= rule.start_date &&
          today <= rule.end_date &&
          ruleMatchesDriver({
            rule,
            scopes: context.incentiveScopesByRule.get(rule.id) ?? [],
            zoneId,
            partnerId,
            restaurantIds,
          }),
      )
      .sort((a, b) => {
        if (a.priority !== b.priority) return b.priority - a.priority;
        if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      });

    const restaurantScopeIds = matching.flatMap((rule) =>
      ruleScopeRows(rule, context.incentiveScopesByRule.get(rule.id) ?? [])
        .map((scope) => scope.restaurant_id)
        .filter((id): id is string => Boolean(id)),
    );
    const partnerScopeIds = matching.flatMap((rule) =>
      ruleScopeRows(rule, context.incentiveScopesByRule.get(rule.id) ?? [])
        .map((scope) => scope.partner_id)
        .filter((id): id is string => Boolean(id)),
    );
    const zoneScopeIds = matching.flatMap((rule) =>
      ruleScopeRows(rule, context.incentiveScopesByRule.get(rule.id) ?? [])
        .map((scope) => scope.zone_id)
        .filter((id): id is string => Boolean(id)),
    );
    const [restaurantMap, partnerMap, zoneMap] = await Promise.all([
      loadDocMap(COLLECTIONS.restaurants, restaurantScopeIds),
      loadDocMap(COLLECTIONS.partners, partnerScopeIds),
      loadDocMap(COLLECTIONS.zones, zoneScopeIds),
    ]);

    let overridePriority: number | null = null;
    for (const rule of matching) {
      const tiers = context.tiersByRule.get(rule.id) ?? [];
      const scopes = ruleScopeRows(rule, context.incentiveScopesByRule.get(rule.id) ?? []);
      const eligible = countEligibleDeliveries({
        driverId: ctx.uid,
        earnDate: today,
        ruleId: rule.id,
        context,
        deliveries,
        scopeRestaurantIdOf: (delivery) => delivery.restaurant_id,
      });
      const progress = countProgressDeliveries({
        driverId: ctx.uid,
        earnDate: today,
        ruleId: rule.id,
        context,
        deliveries,
      });
      const target = offerTarget({
        targetMode: rule.target_mode,
        targetDeliveries: rule.target_deliveries,
        baseMinimum: rule.base_minimum_deliveries,
        tiers,
      });
      const remaining = remainingDeliveries(target, eligible);
      const gateTarget = dpdTargetForRule(context, rule.id, today);
      const fullReward = roundKwd(
        rule.reward_kwd ??
          computeIncentiveAmount({ rule, tiers, eligibleCount: target, gateTarget }),
      );
      const currentReward = roundKwd(
        computeIncentiveAmount({ rule, tiers, eligibleCount: eligible, gateTarget }),
      );
      const overridden = overridePriority !== null && rule.priority < overridePriority;
      const bandStart = incentiveBandStart(rule, tiers, gateTarget);
      offers.push({
        rule_id: rule.id,
        name: rule.name,
        display_name: stripDisplayName(rule.name),
        period: rule.period,
        scope_type: rule.scope_type,
        scope_label: scopeNames(rule.scope_type, scopes, {
          restaurant: restaurantMap,
          partner: partnerMap,
          zone: zoneMap,
        }),
        current_count: eligible,
        progress_count: progress,
        eligible_count: eligible,
        target,
        remaining_deliveries: remaining,
        base_minimum_deliveries: rule.base_minimum_deliveries ?? 0,
        reward_kwd: fullReward,
        current_payout_kwd: currentReward,
        reward_per_delivery_kwd: rule.reward_per_delivery_kwd,
        reward_mode: rule.reward_mode,
        target_mode: rule.target_mode,
        payout_mode: rule.payout_mode,
        start_date: rule.start_date,
        end_date: rule.end_date,
        completed: offerCompleted(target, eligible),
        pending_verification: offerPendingVerification(target, progress, eligible),
        overridden,
        priority: rule.priority,
        overrides_others: rule.overrides_others,
        tiers: [...tiers]
          .sort((a, b) => a.threshold_deliveries - b.threshold_deliveries)
          .map((tier) => ({
            threshold: tier.threshold_deliveries,
            reward_kwd: tier.reward_kwd,
            reward_per_delivery_kwd: tier.reward_per_delivery_kwd,
          })),
        ...bandFields({ bandStart, eligible, tiers }),
      });
      if (rule.overrides_others && currentReward > 0) {
        overridePriority = rule.priority;
      }
    }
  }

  const [dailyDpd, dailyDpdTargets] = await Promise.all([
    buildDailyDpd({
      driverId: ctx.uid,
      driver: ctx.driver as Dict,
      today,
      restaurantIds,
      company,
      companyGoverns,
      deliveries,
      context,
    }),
    buildDailyDpdTargets({
      driverId: ctx.uid,
      driver: ctx.driver as Dict,
      today,
      restaurantIds,
      deliveries,
      context,
    }),
  ]);

  return {
    active_offers: offers,
    daily_dpd: dailyDpd,
    daily_dpd_targets: dailyDpdTargets,
    rider_setup: {
      project_key: asString(ctx.driver["project_key"]),
      rider_category: asString(ctx.driver["rider_category"]),
      company_name: company?.name ?? null,
    },
    company_scheme: companyScheme,
  };
});

async function riderEarningsDetail(request: CallableRequest<unknown>) {
  const ctx = await requireRider(request);
  const data = (request.data ?? {}) as Dict;
  const requestedId = pickId(data, "p_driver_id", "driverId", "driver_id");
  if (requestedId && requestedId !== ctx.uid) {
    throw riderError("permission-denied", "not_authorized");
  }
  const earnDate = pickDay(data, "p_earn_date", "earnDate", "earn_date");
  if (!earnDate || !DAY_RE.test(earnDate)) {
    throw riderError("invalid-argument", "invalid_earn_date");
  }

  const db = getFirestore();
  const context = await loadIncentiveContext();
  const [dailySnap, walletSnap, dayDeliveries] = await Promise.all([
    db.collection(COLLECTIONS.driverEarningsDaily).doc(earningsDocId(ctx.uid, earnDate)).get(),
    db
      .collection(COLLECTIONS.driverWalletEntries)
      .where("driver_id", "==", ctx.uid)
      .where("earn_date", "==", earnDate)
      .where("entry_type", "==", "earning_credit")
      .limit(1)
      .get(),
    loadVerifiedDeliveriesForDeliveredDay(ctx.uid, earnDate),
  ]);

  const dailyRaw = dailySnap.exists ? ((dailySnap.data() ?? {}) as Dict) : null;
  const walletDoc = walletSnap.docs[0] ?? null;
  const walletRaw = walletDoc ? ((walletDoc.data() ?? {}) as Dict) : null;
  const live = liveIncentiveDetail({
    driverId: ctx.uid,
    earnDate,
    dayDeliveries,
    context,
  });

  const [partnerById, restaurantById, zoneById] = await Promise.all([
    loadDocMap(
      COLLECTIONS.partners,
      dayDeliveries.map((delivery) => delivery.partner_id).filter((id): id is string => Boolean(id)),
    ),
    loadDocMap(
      COLLECTIONS.restaurants,
      dayDeliveries.map((delivery) => delivery.restaurant_id).filter((id): id is string => Boolean(id)),
    ),
    loadDocMap(
      COLLECTIONS.zones,
      dayDeliveries.map((delivery) => delivery.zone_id).filter((id): id is string => Boolean(id)),
    ),
  ]);

  const eligible = dayDeliveries.filter((delivery) =>
    deliveryMatchesRules({
      delivery: {
        status: delivery.status,
        zone_id: delivery.zone_id,
        partner_id: delivery.partner_id,
        scope_restaurant_id: delivery.restaurant_id,
      },
      checkDate: earnDate,
      deliveryRules: context.deliveryRules,
      deliveryScopesByRule: context.deliveryScopesByRule,
    }),
  ).length;

  return {
    driver_id: ctx.uid,
    earn_date: earnDate,
    daily: dailyRaw
      ? {
          driver_id: ctx.uid,
          earn_date: earnDate,
          deliveries: asNumber(dailyRaw["deliveries"]),
          base_kwd: asNumber(dailyRaw["base_kwd"]),
          incentive_kwd: asNumber(dailyRaw["incentive_kwd"]),
          loan_deduction_kwd: asNumber(dailyRaw["loan_deduction_kwd"]),
          penalty_kwd: asNumber(dailyRaw["penalty_kwd"]),
          reimbursement_kwd: asNumber(dailyRaw["reimbursement_kwd"]),
          net_kwd: asNumber(dailyRaw["net_kwd"]),
          breakdown: dailyRaw["breakdown"] ?? [],
          calculated_at: isoTimestamp(dailyRaw["calculated_at"]) ?? (asDate(dailyRaw["calculated_at"])?.toISOString() ?? null),
          updated_at: isoTimestamp(dailyRaw["updated_at"]) ?? (asDate(dailyRaw["updated_at"])?.toISOString() ?? null),
        }
      : null,
    wallet: walletRaw
      ? {
          id: walletDoc?.id ?? `earning:${ctx.uid}:${earnDate}`,
          amount_kwd: asNumber(walletRaw["amount_kwd"]),
          status: asString(walletRaw["status"]),
          approved_at: isoTimestamp(walletRaw["approved_at"]),
          source_ref: asString(walletRaw["source_ref"]) ?? `earning:${ctx.uid}:${earnDate}`,
        }
      : null,
    eligible_deliveries_count: eligible,
    computed_incentive_kwd: live.incentive,
    deliveries: [...dayDeliveries]
      .sort((a, b) => {
        const aAt = a.delivered_at ? a.delivered_at.getTime() : 0;
        const bAt = b.delivered_at ? b.delivered_at.getTime() : 0;
        if (aAt !== bAt) return bAt - aAt;
        return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
      })
      .map((delivery) => ({
        id: delivery.id,
        external_order_id: delivery.external_order_id,
        status: delivery.status,
        delivered_at: delivery.delivered_at ? delivery.delivered_at.toISOString() : null,
        partner_id: delivery.partner_id,
        partner_name: delivery.partner_id ? asString(partnerById.get(delivery.partner_id)?.["name"]) : null,
        restaurant_id: delivery.restaurant_id,
        restaurant_name: delivery.restaurant_id
          ? asString(restaurantById.get(delivery.restaurant_id)?.["name"])
          : null,
        zone_id: delivery.zone_id,
        zone_name: delivery.zone_id ? asString(zoneById.get(delivery.zone_id)?.["name"]) : null,
        counts_for_earnings: deliveryMatchesRules({
          delivery: {
            status: delivery.status,
            zone_id: delivery.zone_id,
            partner_id: delivery.partner_id,
            scope_restaurant_id: delivery.restaurant_id,
          },
          checkDate: earnDate,
          deliveryRules: context.deliveryRules,
          deliveryScopesByRule: context.deliveryScopesByRule,
        }),
      })),
    rules: live.lines,
  };
}

export const driverGetEarningsDetail = measureOnCall("driverGetEarningsDetail", riderEarningsDetail);
