import { onCall, type CallableRequest } from "firebase-functions/v2/https";
import { getFirestore, Timestamp } from "../core/fs";
import { COLLECTIONS } from "../core/collections";
import { daysInMonth, kuwaitDayEnd, kuwaitDayStart, kuwaitDayString } from "../core/kuwait";
import { computeSourceCompanyIncentive, periodStart, roundKwd } from "../core/money";
import {
  companyConfigApplies,
  computeIncentiveAmount,
  deliveryMatchesRules,
  incentiveBandStart,
  restaurantDailyDpdTarget,
  type IncentiveTier,
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

function matchesRuleScope(
  scopeType: string,
  scopes: Array<{ zone_id: string | null; partner_id: string | null; restaurant_id: string | null }>,
  delivery: { zone_id: string | null; partner_id: string | null; restaurant_id: string | null },
): boolean {
  if (scopeType === "zone") {
    return scopes.some((scope) => scope.zone_id !== null && scope.zone_id === delivery.zone_id);
  }
  if (scopeType === "partner") {
    return scopes.some((scope) => scope.partner_id !== null && scope.partner_id === delivery.partner_id);
  }
  return scopes.some(
    (scope) => scope.restaurant_id !== null && scope.restaurant_id === delivery.restaurant_id,
  );
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
    return matchesRuleScope(rule.scope_type, scopes, {
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

function restaurantOwnTarget(
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

function zoneOwnTarget(zoneId: string, onDate: string, context: IncentiveContext): number | null {
  const candidates = context.deliveryRules.filter((rule) => {
    if (rule.status !== "active" || rule.scope_type !== "zone") return false;
    if ((rule.dpd_target ?? 0) <= 0) return false;
    if (rule.dpd_period !== null && rule.dpd_period !== undefined && rule.dpd_period !== "daily") {
      return false;
    }
    if (onDate < rule.start_date || onDate > rule.end_date) return false;
    if (rule.zone_id === zoneId) return true;
    return (context.deliveryScopesByRule.get(rule.id) ?? []).some((scope) => scope.zone_id === zoneId);
  });
  if (candidates.length === 0) return null;
  const sorted = [...candidates].sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority;
    return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0;
  });
  return Math.ceil(sorted[0].dpd_target as number);
}

async function buildDailyDpdTargets(args: {
  driverId: string;
  today: string;
  zoneId: string | null;
  restaurantIds: readonly string[];
  deliveries: readonly RawDelivery[];
  context: IncentiveContext;
}): Promise<Dict[]> {
  const { driverId, today, zoneId, restaurantIds, deliveries, context } = args;
  const restaurantMap = await loadDocMap(COLLECTIONS.restaurants, restaurantIds);
  const cards: Dict[] = [];

  const named = restaurantIds
    .map((id) => ({ id, name: asString(restaurantMap.get(id)?.["name"]) ?? "" }))
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const restaurant of named) {
    const target = restaurantOwnTarget(restaurant.id, today, context);
    if (target === null || target <= 0) continue;
    const ofRestaurant = deliveries.filter((delivery) => delivery.restaurant_id === restaurant.id);
    const completed = ofRestaurant.filter(
      (delivery) => delivery.status === "verified" && inDriverDay(delivery, today, false),
    ).length;
    const progress = ofRestaurant.filter(
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

  if (zoneId) {
    const target = zoneOwnTarget(zoneId, today, context);
    if (target !== null && target > 0) {
      const zoneDoc = (await loadDocMap(COLLECTIONS.zones, [zoneId])).get(zoneId);
      const zoneName = asString(zoneDoc?.["name"]);
      if (zoneName) {
        const completed = deliveries.filter((delivery) => {
          if (delivery.status !== "verified" || !inDriverDay(delivery, today, false)) return false;
          const deliveryZone = delivery.zone_id ?? context.restaurantZoneById.get(delivery.restaurant_id ?? "") ?? null;
          return deliveryZone === zoneId;
        }).length;
        const progress = deliveries.filter((delivery) => {
          if (!PROGRESS_STATUSES.has(delivery.status) || !inDriverDay(delivery, today, true)) return false;
          const deliveryZone = delivery.zone_id ?? context.restaurantZoneById.get(delivery.restaurant_id ?? "") ?? null;
          return deliveryZone === zoneId;
        }).length;
        cards.push({
          kind: "zone",
          name: zoneName,
          target,
          completed_today: completed,
          progress_today: progress,
        });
      }
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
  companyApplies: boolean;
  deliveries: readonly RawDelivery[];
  context: IncentiveContext;
}): Promise<Dict | null> {
  const { driverId, today, restaurantIds, company, companyApplies, deliveries, context } = args;

  if (companyApplies) {
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
          scopeType: rule.scope_type,
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
    getFirestore()
      .collection(DRIVER_ATTENDANCE)
      .where("driver_id", "==", ctx.uid)
      .limit(400)
      .get(),
    loadRiderDeliveries(ctx.uid, LIFETIME_STATUSES),
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
  const [context, restaurantIds, company, deliveries] = await Promise.all([
    loadIncentiveContext(),
    assignedRestaurantIds(ctx.uid, ctx.driver as Dict),
    loadSourceCompany(asString(ctx.driver["source_company"])),
    loadRiderDeliveries(ctx.uid, [...PROGRESS_STATUSES]),
  ]);

  const companyApplies = companyConfigApplies({
    riderCategory: asString(ctx.driver["rider_category"]),
    company,
    onDate: today,
  });

  let companyScheme: Dict | null = null;
  const offers: Dict[] = [];

  if (companyApplies) {
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
            scopeType: rule.scope_type,
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
      (context.incentiveScopesByRule.get(rule.id) ?? [])
        .map((scope) => scope.restaurant_id)
        .filter((id): id is string => Boolean(id)),
    );
    const partnerScopeIds = matching.flatMap((rule) =>
      (context.incentiveScopesByRule.get(rule.id) ?? [])
        .map((scope) => scope.partner_id)
        .filter((id): id is string => Boolean(id)),
    );
    const zoneScopeIds = matching.flatMap((rule) =>
      (context.incentiveScopesByRule.get(rule.id) ?? [])
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
      const scopes = context.incentiveScopesByRule.get(rule.id) ?? [];
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
      companyApplies,
      deliveries,
      context,
    }),
    buildDailyDpdTargets({
      driverId: ctx.uid,
      today,
      zoneId: asString(ctx.driver["zone_id"]),
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

export const driverGetEarningsDetail = onCall(riderEarningsDetail);
