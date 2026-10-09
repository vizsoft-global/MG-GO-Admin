/**
 * Firestore reads for the incentive engine, loaded once per recalculation.
 *
 * The rule set is small (production holds ~120 incentive rules and a handful of
 * delivery rules), so every calculation reads it whole rather than filtering per
 * driver. That is deliberate: `count_eligible_deliveries` is called once per
 * rule per driver-day, and the SQL version paid for a fresh rule lookup inside
 * every one of those calls. One read per invocation is both fewer round trips
 * and the only way the per-rule answers are guaranteed to describe the same
 * rule set.
 */

import { getFirestore } from "firebase-admin/firestore";
import { COLLECTIONS } from "./collections";
import { loadAppSettings } from "./settings";
import { kuwaitDayEnd, kuwaitDayStart } from "./kuwait";
import { periodStart } from "./money";
import {
  deliveryMatchesRules,
  incentiveRuleDpdTarget,
  restaurantDailyDpdTarget,
  ruleRestaurantIds,
  type DeliveryRule,
  type IncentiveRule,
  type IncentiveTier,
  type RuleScope,
} from "./incentive";

const SCAN_CAP = 20_000;

function asString(value: unknown): string | null {
  if (typeof value === "string") return value.length ? value : null;
  if (value && typeof value === "object" && "toDate" in (value as Record<string, unknown>)) {
    const date = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
}

function asDayString(value: unknown): string | null {
  const text = asString(value);
  return text ? text.slice(0, 10) : null;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asBool(value: unknown): boolean {
  return value === true;
}

function normaliseScope(raw: Record<string, unknown>): RuleScope {
  return {
    zone_id: asString(raw["zone_id"]),
    partner_id: asString(raw["partner_id"]),
    restaurant_id: asString(raw["restaurant_id"]),
  };
}

function normaliseRule(id: string, raw: Record<string, unknown>): IncentiveRule {
  return {
    id,
    name: asString(raw["name"]) ?? "—",
    period: (asString(raw["period"]) ?? "daily") as IncentiveRule["period"],
    status: (asString(raw["status"]) ?? "draft") as IncentiveRule["status"],
    start_date: asDayString(raw["start_date"]) ?? "1970-01-01",
    end_date: asDayString(raw["end_date"]) ?? "9999-12-31",
    priority: asNumber(raw["priority"]),
    created_at: asString(raw["created_at"]) ?? "",
    scope_type: (asString(raw["scope_type"]) ?? "restaurant") as IncentiveRule["scope_type"],
    target_mode: (asString(raw["target_mode"]) ?? "single") as IncentiveRule["target_mode"],
    base_minimum_deliveries: asNullableNumber(raw["base_minimum_deliveries"]),
    target_deliveries: asNullableNumber(raw["target_deliveries"]),
    reward_mode: (asString(raw["reward_mode"]) ?? "per_delivery") as IncentiveRule["reward_mode"],
    reward_kwd: asNullableNumber(raw["reward_kwd"]),
    reward_per_delivery_kwd: asNullableNumber(raw["reward_per_delivery_kwd"]),
    payout_mode: (asString(raw["payout_mode"]) ?? "per_tier") as IncentiveRule["payout_mode"],
    overrides_others: asBool(raw["overrides_others"]),
    zone_id: asString(raw["zone_id"]),
    partner_id: asString(raw["partner_id"]),
    restaurant_id: asString(raw["restaurant_id"]),
  };
}

function normaliseDeliveryRule(id: string, raw: Record<string, unknown>): DeliveryRule {
  return {
    id,
    status: asString(raw["status"]) ?? "draft",
    scope_type: (asString(raw["scope_type"]) ?? "restaurant") as DeliveryRule["scope_type"],
    priority: asNumber(raw["priority"]),
    created_at: asString(raw["created_at"]) ?? "",
    start_date: asDayString(raw["start_date"]) ?? "1970-01-01",
    end_date: asDayString(raw["end_date"]) ?? "9999-12-31",
    dpd_target: asNullableNumber(raw["dpd_target"]),
    dpd_period: asString(raw["dpd_period"]),
    zone_id: asString(raw["zone_id"]),
    partner_id: asString(raw["partner_id"]),
    restaurant_id: asString(raw["restaurant_id"]),
  };
}

export type IncentiveContext = {
  rules: IncentiveRule[];
  ruleById: Map<string, IncentiveRule>;
  tiersByRule: Map<string, IncentiveTier[]>;
  incentiveScopesByRule: Map<string, RuleScope[]>;
  restaurantIdsOf: (ruleId: string) => string[];
  deliveryRules: DeliveryRule[];
  deliveryScopesByRule: Map<string, RuleScope[]>;
  restaurantZoneById: Map<string, string | null>;
  bandMathFrom: string | null;
};

/**
 * Every rule, tier, scope and delivery rule, plus the `app_settings` row that
 * decides whether the band gate applies at all.
 */
export async function loadIncentiveContext(): Promise<IncentiveContext> {
  const db = getFirestore();

  const [rulesSnap, tiersSnap, incentiveScopesSnap, deliveryRulesSnap, deliveryScopesSnap, settings] =
    await Promise.all([
      db.collection(COLLECTIONS.incentiveRules).limit(SCAN_CAP).get(),
      db.collection(COLLECTIONS.incentiveRuleTiers).limit(SCAN_CAP).get(),
      db.collection(COLLECTIONS.incentiveRuleScopes).limit(SCAN_CAP).get(),
      db.collection(COLLECTIONS.deliveryRules).limit(SCAN_CAP).get(),
      db.collection(COLLECTIONS.deliveryRuleScopes).limit(SCAN_CAP).get(),
      loadAppSettings(),
    ]);

  const rules = rulesSnap.docs.map((doc) => normaliseRule(doc.id, doc.data() ?? {}));
  const ruleById = new Map(rules.map((rule) => [rule.id, rule]));

  const tiersByRule = new Map<string, IncentiveTier[]>();
  for (const doc of tiersSnap.docs) {
    const raw = doc.data() ?? {};
    const ruleId = asString(raw["incentive_rule_id"]);
    if (!ruleId) continue;
    const tier: IncentiveTier = {
      threshold_deliveries: asNumber(raw["threshold_deliveries"]),
      reward_mode: (asString(raw["reward_mode"]) ?? "per_delivery") as IncentiveTier["reward_mode"],
      reward_kwd: asNullableNumber(raw["reward_kwd"]),
      reward_per_delivery_kwd: asNullableNumber(raw["reward_per_delivery_kwd"]),
    };
    tiersByRule.set(ruleId, [...(tiersByRule.get(ruleId) ?? []), tier]);
  }

  const incentiveScopesByRule = new Map<string, RuleScope[]>();
  for (const doc of incentiveScopesSnap.docs) {
    const raw = doc.data() ?? {};
    const ruleId = asString(raw["incentive_rule_id"]);
    if (!ruleId) continue;
    incentiveScopesByRule.set(ruleId, [
      ...(incentiveScopesByRule.get(ruleId) ?? []),
      normaliseScope(raw),
    ]);
  }

  const deliveryRules = deliveryRulesSnap.docs.map((doc) =>
    normaliseDeliveryRule(doc.id, doc.data() ?? {}),
  );

  const deliveryScopesByRule = new Map<string, RuleScope[]>();
  for (const doc of deliveryScopesSnap.docs) {
    const raw = doc.data() ?? {};
    const ruleId = asString(raw["delivery_rule_id"]);
    if (!ruleId) continue;
    deliveryScopesByRule.set(ruleId, [
      ...(deliveryScopesByRule.get(ruleId) ?? []),
      normaliseScope(raw),
    ]);
  }

  // Zone fallback needs only the restaurant's own `zone_id`, so the read is
  // narrowed to the two fields the engine can use.
  const restaurantZoneById = new Map<string, string | null>();
  const restaurantSnap = await db
    .collection(COLLECTIONS.restaurants)
    .select("zone_id")
    .limit(SCAN_CAP)
    .get();
  for (const doc of restaurantSnap.docs) {
    restaurantZoneById.set(doc.id, asString(doc.data()?.["zone_id"]));
  }

  return {
    rules,
    ruleById,
    tiersByRule,
    incentiveScopesByRule,
    restaurantIdsOf: (ruleId) => {
      const rule = ruleById.get(ruleId);
      if (!rule) return [];
      return ruleRestaurantIds(rule, incentiveScopesByRule.get(ruleId) ?? []);
    },
    deliveryRules,
    deliveryScopesByRule,
    restaurantZoneById,
    bandMathFrom: settings.incentive_band_math_from,
  };
}

/** The daily target that gates one rule on one date. */
export function dpdTargetForRule(context: IncentiveContext, ruleId: string, onDate: string): number | null {
  const targetCache = new Map<string, number | null>();
  return incentiveRuleDpdTarget({
    ruleRestaurantIds: context.restaurantIdsOf(ruleId),
    onDate,
    bandMathFrom: context.bandMathFrom,
    targetForRestaurant: (restaurantId) => {
      if (!targetCache.has(restaurantId)) {
        targetCache.set(
          restaurantId,
          restaurantDailyDpdTarget({
            restaurantId,
            onDate,
            restaurantZoneId: context.restaurantZoneById.get(restaurantId) ?? null,
            deliveryRules: context.deliveryRules,
            deliveryScopesByRule: context.deliveryScopesByRule,
          }),
        );
      }
      return targetCache.get(restaurantId) ?? null;
    },
  });
}

/**
 * `count_eligible_deliveries`, priced for one rule in one period.
 *
 * The window is the rule's own period (daily / ISO week / month) ending on the
 * earn date, and attribution is `shift_date` first with a Kuwait-timestamp
 * fallback for rows written before `shift_date` existed. Both halves matter: a
 * 14:00–02:00 shift's post-midnight orders belong to the shift's day, but rows
 * carried over from the old schema have no `shift_date` and would otherwise
 * vanish.
 */
export function countEligibleDeliveries(args: {
  driverId: string;
  earnDate: string;
  ruleId: string;
  context: IncentiveContext;
  deliveries: readonly RawDelivery[];
  scopeRestaurantIdOf: (delivery: RawDelivery) => string | null;
}): number {
  const { driverId, earnDate, ruleId, context, deliveries, scopeRestaurantIdOf } = args;
  const rule = context.ruleById.get(ruleId);
  if (!rule) return 0;

  const periodStartDay = periodStart(rule.period, earnDate);
  const periodEnd = earnDate;

  return deliveries.filter((delivery) => {
    if (delivery.driver_id !== driverId) return false;
    if (!deliveryInPeriod(delivery, periodStartDay, periodEnd)) return false;

    const scopeRestaurantId = scopeRestaurantIdOf(delivery);

    if (
      !deliveryMatchesRules({
        delivery: {
          status: delivery.status,
          zone_id: delivery.zone_id,
          partner_id: delivery.partner_id,
          scope_restaurant_id: scopeRestaurantId,
        },
        checkDate: earnDate,
        deliveryRules: context.deliveryRules,
        deliveryScopesByRule: context.deliveryScopesByRule,
      })
    ) {
      return false;
    }

    return matchesRuleScope(rule, context.incentiveScopesByRule.get(ruleId) ?? [], {
      zone_id: delivery.zone_id,
      partner_id: delivery.partner_id,
      restaurant_id: scopeRestaurantId,
    });
  }).length;
}

/** One `deliveries` document, already normalised. */
export type RawDelivery = {
  id: string;
  driver_id: string;
  status: string;
  shift_date: string | null;
  delivered_at: Date | null;
  zone_id: string | null;
  partner_id: string | null;
  restaurant_id: string | null;
  external_order_id: string | null;
  pickup_at: Date | null;
};

export function normaliseDelivery(id: string, raw: Record<string, unknown>): RawDelivery {
  const delivered = raw["delivered_at"];
  const pickup = raw["pickup_at"];
  return {
    id,
    driver_id: asString(raw["driver_id"]) ?? "",
    status: asString(raw["status"]) ?? "",
    shift_date: asDayString(raw["shift_date"]),
    delivered_at:
      delivered && typeof delivered === "object" && "toDate" in (delivered as object)
        ? (delivered as { toDate: () => Date }).toDate()
        : null,
    zone_id: asString(raw["zone_id"]),
    partner_id: asString(raw["partner_id"]),
    restaurant_id: asString(raw["restaurant_id"]),
    external_order_id: asString(raw["external_order_id"]),
    pickup_at:
      pickup && typeof pickup === "object" && "toDate" in (pickup as object)
        ? (pickup as { toDate: () => Date }).toDate()
        : null,
  };
}

function deliveryInPeriod(delivery: RawDelivery, startDay: string, endDay: string): boolean {
  if (delivery.shift_date) {
    return delivery.shift_date >= startDay && delivery.shift_date <= endDay;
  }
  if (!delivery.delivered_at) return false;
  const at = delivery.delivered_at.getTime();
  return at >= kuwaitDayStart(startDay).getTime() && at < kuwaitDayEnd(endDay).getTime();
}

function matchesRuleScope(
  rule: IncentiveRule,
  scopes: readonly RuleScope[],
  delivery: { zone_id: string | null; partner_id: string | null; restaurant_id: string | null },
): boolean {
  if (rule.scope_type === "zone") {
    return scopes.some((scope) => scope.zone_id === delivery.zone_id && scope.zone_id !== null);
  }
  if (rule.scope_type === "partner") {
    return scopes.some(
      (scope) => scope.partner_id === delivery.partner_id && scope.partner_id !== null,
    );
  }
  return scopes.some(
    (scope) => scope.restaurant_id === delivery.restaurant_id && scope.restaurant_id !== null,
  );
}

/**
 * Verified deliveries for a driver on a Kuwait day, with the legacy fallback.
 *
 * Two queries rather than one: Firestore cannot express an `OR` across
 * `shift_date == day` and "`shift_date` absent and the timestamp falls in the
 * day", and an `!= null` filter would silently drop the legacy rows this branch
 * exists to keep.
 */
export async function loadVerifiedDeliveriesForDriverDay(
  driverId: string,
  day: string,
): Promise<RawDelivery[]> {
  const db = getFirestore();
  const base = db
    .collection(COLLECTIONS.deliveries)
    .where("driver_id", "==", driverId)
    .where("status", "==", "verified");

  const [shiftSnap, legacySnap] = await Promise.all([
    base.where("shift_date", "==", day).limit(SCAN_CAP).get(),
    base
      .where("shift_date", "==", null)
      .where("delivered_at", ">=", kuwaitDayStart(day))
      .where("delivered_at", "<", kuwaitDayEnd(day))
      .limit(SCAN_CAP)
      .get(),
  ]);

  const out = new Map<string, RawDelivery>();
  for (const doc of [...shiftSnap.docs, ...legacySnap.docs]) {
    out.set(doc.id, normaliseDelivery(doc.id, doc.data() ?? {}));
  }
  return [...out.values()];
}

/** Every driver with a verified delivery on a day, for the range/date sweeps. */
export async function loadVerifiedDriverIdsForDay(day: string): Promise<string[]> {
  const db = getFirestore();
  const base = db
    .collection(COLLECTIONS.deliveries)
    .where("status", "==", "verified");

  const [shiftSnap, legacySnap] = await Promise.all([
    base.where("shift_date", "==", day).select("driver_id").limit(SCAN_CAP).get(),
    base
      .where("shift_date", "==", null)
      .where("delivered_at", ">=", kuwaitDayStart(day))
      .where("delivered_at", "<", kuwaitDayEnd(day))
      .select("driver_id")
      .limit(SCAN_CAP)
      .get(),
  ]);

  const ids = new Set<string>();
  for (const doc of [...shiftSnap.docs, ...legacySnap.docs]) {
    const driverId = asString(doc.data()?.["driver_id"]);
    if (driverId) ids.add(driverId);
  }
  return [...ids];
}

/**
 * Verified deliveries for a driver on the **Kuwait civil day of `delivered_at`**.
 *
 * This is the timestamp-day predicate the earnings RPCs use
 * (`(delivered_at AT TIME ZONE 'Asia/Kuwait')::date = p_earn_date`), and it is
 * deliberately not the same query as `loadVerifiedDeliveriesForDriverDay` above:
 * that one attributes by `shift_date` first, which is what
 * `count_eligible_deliveries` does. Both live side by side because the deployed
 * earnings functions use both — the `deliveries` figure on a day is counted one
 * way and the eligible count for an incentive rule the other — and collapsing
 * them would change a payout.
 *
 * A denormalised `delivered_day` field exists in `FIELDS`, but nothing populates
 * it, so filtering on it would return zero deliveries and quietly zero a
 * rider's pay. The window is therefore built from the timestamp the field is
 * derived from.
 */
export async function loadVerifiedDeliveriesForDeliveredDay(
  driverId: string,
  day: string,
): Promise<RawDelivery[]> {
  const db = getFirestore();
  const snap = await db
    .collection(COLLECTIONS.deliveries)
    .where("driver_id", "==", driverId)
    .where("status", "==", "verified")
    .where("delivered_at", ">=", kuwaitDayStart(day))
    .where("delivered_at", "<", kuwaitDayEnd(day))
    .limit(SCAN_CAP)
    .get();

  return snap.docs.map((doc) => normaliseDelivery(doc.id, doc.data() ?? {}));
}

/** Every driver with a verified delivery on the civil day, for the day sweeps. */
export async function loadVerifiedDriverIdsForDeliveredDay(day: string): Promise<string[]> {
  const db = getFirestore();
  const snap = await db
    .collection(COLLECTIONS.deliveries)
    .where("status", "==", "verified")
    .where("delivered_at", ">=", kuwaitDayStart(day))
    .where("delivered_at", "<", kuwaitDayEnd(day))
    .select("driver_id")
    .limit(SCAN_CAP)
    .get();

  const ids = new Set<string>();
  for (const doc of snap.docs) {
    const driverId = asString(doc.data()?.["driver_id"]);
    if (driverId) ids.add(driverId);
  }
  return [...ids];
}
