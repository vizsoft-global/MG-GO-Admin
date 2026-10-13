/**
 * The incentive band engine, ported from `compute_incentive_amount` and its two
 * helpers.
 *
 * Pure on purpose: every input is a plain object the caller already read, so the
 * decision that sets a rider's pay can be exercised without Firestore. Each
 * function below names the SQL function it replaces, and the port is literal —
 * the band loop, the override precedence and the target gate are the exact
 * arithmetic the database was running, and a "cleaner" restatement would be a
 * different payout wearing the same name.
 */

import { roundKwd, type IncentivePeriod, type IncentivePayoutMode } from "./money";

export type IncentiveRewardMode = "fixed" | "per_delivery";
export type IncentiveTargetMode = "single" | "tiered";
export type RuleScopeType = "zone" | "partner" | "restaurant";

/** One row of `incentive_rules`, as Firestore stores it. */
export type IncentiveRule = {
  id: string;
  name: string;
  period: IncentivePeriod;
  status: "draft" | "active" | "ended";
  start_date: string;
  end_date: string;
  priority: number;
  created_at: string;
  scope_type: RuleScopeType;
  target_mode: IncentiveTargetMode;
  base_minimum_deliveries: number | null;
  target_deliveries: number | null;
  reward_mode: IncentiveRewardMode;
  reward_kwd: number | null;
  reward_per_delivery_kwd: number | null;
  payout_mode: IncentivePayoutMode;
  overrides_others: boolean;
  zone_id: string | null;
  partner_id: string | null;
  restaurant_id: string | null;
};

/** One row of `incentive_rule_tiers`. */
export type IncentiveTier = {
  threshold_deliveries: number;
  reward_mode: IncentiveRewardMode;
  reward_kwd: number | null;
  reward_per_delivery_kwd: number | null;
};

/** One row of `incentive_rule_scopes` / `delivery_rule_scopes`. */
export type RuleScope = {
  zone_id: string | null;
  partner_id: string | null;
  restaurant_id: string | null;
};

/** One row of `delivery_rules`. */
export type DeliveryRule = {
  id: string;
  status: string;
  scope_type: RuleScopeType;
  priority: number;
  created_at: string;
  start_date: string;
  end_date: string;
  dpd_target: number | null;
  dpd_period?: string | null;
  zone_id: string | null;
  partner_id: string | null;
  restaurant_id: string | null;
};

/**
 * `incentive_rule_restaurant_ids`: the rule's own legacy column unioned with
 * every restaurant scope, deduplicated.
 */
export function ruleRestaurantIds(rule: IncentiveRule, scopes: readonly RuleScope[]): string[] {
  const ids = new Set<string>();
  if (rule.restaurant_id) ids.add(rule.restaurant_id);
  for (const scope of scopes) if (scope.restaurant_id) ids.add(scope.restaurant_id);
  return [...ids];
}

/**
 * `incentive_rules_share_restaurant`: whether two rules overlap on any
 * restaurant. An empty id list never intersects.
 */
export function rulesShareRestaurant(aIds: readonly string[], bIds: readonly string[]): boolean {
  const set = new Set(aIds);
  return bIds.some((id) => set.has(id));
}

/**
 * The SQL's `ORDER BY priority DESC, created_at DESC, id DESC` — the tie-break
 * that decides which ended rule is the authority for a shared restaurant.
 */
function compareRuleForOverride(a: IncentiveRule, b: IncentiveRule): number {
  if (a.priority !== b.priority) return b.priority - a.priority;
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/** The rule iteration order the SQL loops in: active first, then priority. */
export function compareRulesForLoop(a: IncentiveRule, b: IncentiveRule): number {
  const aActive = a.status === "active" ? 0 : 1;
  const bActive = b.status === "active" ? 0 : 1;
  if (aActive !== bActive) return aActive - bActive;
  if (a.priority !== b.priority) return b.priority - a.priority;
  if (aActive === 0 && a.created_at !== b.created_at) {
    return a.created_at < b.created_at ? -1 : 1;
  }
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/**
 * `incentive_rule_applies_on_date`, resolved against the whole rule set.
 *
 * An `active` rule inside its window applies. An `ended` rule still applies for
 * the days it originally covered **until** a replacement that shares one of its
 * restaurants becomes active — and when several ended rules could match, the
 * highest-priority one wins, so the clamp is decided by exactly one rule rather
 * than by whichever row the loop happened to reach.
 */
export function ruleAppliesOnDate(
  rule: IncentiveRule,
  onDate: string,
  allRules: readonly IncentiveRule[],
  restaurantIdsOf: (ruleId: string) => string[],
): boolean {
  if (onDate < rule.start_date || onDate > rule.end_date) return false;
  if (rule.status === "active") return true;
  if (rule.status !== "ended") return false;

  const myIds = restaurantIdsOf(rule.id);

  for (const other of allRules) {
    if (other.id === rule.id) continue;
    if (other.status !== "active") continue;
    if (onDate < other.start_date || onDate > other.end_date) continue;
    if (rulesShareRestaurant(myIds, restaurantIdsOf(other.id))) return false;
  }

  // A rule with no restaurant scope cannot be displaced by a restaurant
  // replacement, so it stays authoritative for its own window.
  if (myIds.length === 0) return true;

  const candidates = allRules.filter(
    (other) =>
      other.status === "ended" &&
      onDate >= other.start_date &&
      onDate <= other.end_date &&
      rulesShareRestaurant(restaurantIdsOf(other.id), myIds) &&
      !allRules.some(
        (active) =>
          active.status === "active" &&
          onDate >= active.start_date &&
          onDate <= active.end_date &&
          rulesShareRestaurant(restaurantIdsOf(other.id), restaurantIdsOf(active.id)),
      ),
  );

  if (candidates.length === 0) return false;

  const winner = [...candidates].sort(compareRuleForOverride)[0];
  return winner.id === rule.id;
}

/**
 * `_incentive_band_start`: where a rule's per-order bands begin, or null when
 * the rule is not a band rule on that date.
 *
 * Non-null requires a tiered rule whose every tier pays per delivery, because
 * the band loop can only price per-order rates. When a target resolved, the
 * target **is** the gate but the rule's own base stays the floor — a target
 * below the base must not undercut the rule's stated minimum.
 */
export function incentiveBandStart(
  rule: IncentiveRule,
  tiers: readonly IncentiveTier[],
  gateTarget: number | null,
): number | null {
  if (rule.target_mode !== "tiered") return null;
  if (tiers.length === 0) return null;
  if (
    tiers.some(
      (tier) => tier.reward_mode !== "per_delivery" || (tier.reward_per_delivery_kwd ?? 0) <= 0,
    )
  ) {
    return null;
  }

  if (gateTarget !== null) {
    return Math.max(gateTarget, rule.base_minimum_deliveries ?? 0);
  }

  const first = Math.min(...tiers.map((tier) => tier.threshold_deliveries));
  const above = tiers
    .map((tier) => tier.threshold_deliveries)
    .filter((threshold) => threshold > first);
  const second = above.length ? Math.min(...above) : null;

  const base = rule.base_minimum_deliveries ?? 0;
  if (base > 0 && base < first) return base;
  if (second !== null && first - (second - first) >= 0) return first - (second - first);
  return null;
}

/**
 * `compute_incentive_amount(p_rule_id, p_eligible_count, p_on_date)`.
 *
 * The target gate sits above every branch on purpose: a rule with a daily DPD
 * target pays nothing below it whatever its `reward_mode`, `payout_mode` or
 * `overrides_others` says, which is the whole point of the gate — the band path
 * alone used to let a fixed or overriding rule pay under target.
 */
export function computeIncentiveAmount(args: {
  rule: IncentiveRule;
  tiers: readonly IncentiveTier[];
  eligibleCount: number;
  gateTarget: number | null;
}): number {
  const { rule, tiers, eligibleCount, gateTarget } = args;

  if (!Number.isFinite(eligibleCount) || eligibleCount <= 0) return 0;
  if (gateTarget !== null && eligibleCount < gateTarget) return 0;

  const bandStart = incentiveBandStart(rule, tiers, gateTarget);
  if (bandStart !== null) {
    let amount = 0;
    let prev = bandStart;
    for (const tier of [...tiers].sort((a, b) => a.threshold_deliveries - b.threshold_deliveries)) {
      if (tier.threshold_deliveries <= prev) continue;
      const band = Math.min(eligibleCount, tier.threshold_deliveries) - prev;
      if (band > 0) amount += (tier.reward_per_delivery_kwd ?? 0) * band;
      prev = tier.threshold_deliveries;
    }
    return roundKwd(amount);
  }

  const base = rule.base_minimum_deliveries ?? 0;
  const cumulative = rule.payout_mode === "cumulative";

  if (eligibleCount <= base) return 0;

  if (rule.target_mode === "single") {
    if (!cumulative && (rule.target_deliveries === null || eligibleCount < rule.target_deliveries)) {
      return 0;
    }

    if (rule.reward_mode === "fixed") return roundKwd(rule.reward_kwd ?? 0);

    let band = eligibleCount - base;
    if (rule.target_deliveries !== null) {
      band = Math.min(band, rule.target_deliveries - base);
    }
    return roundKwd((rule.reward_per_delivery_kwd ?? 0) * Math.max(band, 0));
  }

  let amount = 0;
  for (const tier of [...tiers].sort((a, b) => a.threshold_deliveries - b.threshold_deliveries)) {
    if (!cumulative && eligibleCount < tier.threshold_deliveries) continue;
    if (tier.reward_mode === "fixed") {
      amount += tier.reward_kwd ?? 0;
    } else {
      const band = Math.min(eligibleCount - base, tier.threshold_deliveries - base);
      amount += (tier.reward_per_delivery_kwd ?? 0) * Math.max(band, 0);
    }
  }

  return roundKwd(amount);
}

/**
 * `_restaurant_daily_dpd_target`: the restaurant's own daily target, falling
 * back to the target of the zone that restaurant sits in, `ceil`-ed and picked
 * by the SQL's `priority DESC, created_at ASC`.
 *
 * Both halves read `delivery_rules`, and both accept the legacy single-FK
 * column *or* a scope row — the schema carried two places for one fact while the
 * junction table was being introduced, and a port that read only the junction
 * would silently drop every rule written before the split.
 */
export function restaurantDailyDpdTarget(args: {
  restaurantId: string;
  onDate: string;
  restaurantZoneId: string | null;
  deliveryRules: readonly DeliveryRule[];
  deliveryScopesByRule: ReadonlyMap<string, readonly RuleScope[]>;
}): number | null {
  const { restaurantId, onDate, restaurantZoneId, deliveryRules, deliveryScopesByRule } = args;

  const isDaily = (rule: DeliveryRule) =>
    rule.status === "active" &&
    (rule.dpd_target ?? 0) > 0 &&
    (rule.dpd_period === null || rule.dpd_period === undefined || rule.dpd_period === "daily") &&
    onDate >= rule.start_date &&
    onDate <= rule.end_date;

  const scopesOf = (ruleId: string) => deliveryScopesByRule.get(ruleId) ?? [];

  const pick = (candidates: DeliveryRule[]): number | null => {
    if (!candidates.length) return null;
    const sorted = [...candidates].sort((a, b) => {
      if (a.priority !== b.priority) return b.priority - a.priority;
      return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0;
    });
    return Math.ceil(sorted[0].dpd_target as number);
  };

  const restaurantRules = deliveryRules.filter(
    (rule) =>
      isDaily(rule) &&
      rule.scope_type === "restaurant" &&
      (rule.restaurant_id === restaurantId ||
        scopesOf(rule.id).some((scope) => scope.restaurant_id === restaurantId)),
  );

  const zoneRules = restaurantZoneId
    ? deliveryRules.filter(
        (rule) =>
          isDaily(rule) &&
          rule.scope_type === "zone" &&
          (rule.zone_id === restaurantZoneId ||
            scopesOf(rule.id).some((scope) => scope.zone_id === restaurantZoneId)),
      )
    : [];

  return pick(restaurantRules) ?? pick(zoneRules);
}

/**
 * `_incentive_rule_dpd_target`: the highest daily target across the rule's
 * restaurants, so a rule spanning several stores is gated by the strictest one.
 *
 * Returns null before the band-math cutover (`incentive_band_math_from`), which
 * is what keeps a recalculated historical day priced under the legacy math
 * instead of being repriced by a rule that did not exist when it was paid.
 */
export function incentiveRuleDpdTarget(args: {
  ruleRestaurantIds: readonly string[];
  onDate: string;
  bandMathFrom: string | null;
  targetForRestaurant: (restaurantId: string) => number | null;
}): number | null {
  const { ruleRestaurantIds: ids, onDate, bandMathFrom, targetForRestaurant } = args;

  if (bandMathFrom === null || onDate < bandMathFrom) return null;

  const targets = ids
    .map((id) => targetForRestaurant(id))
    .filter((target): target is number => target !== null && target > 0);

  return targets.length ? Math.max(...targets) : null;
}

/**
 * `delivery_matches_rules`: whether a verified delivery counts for earnings on
 * a date.
 *
 * The subtle half is the zero-rule case: with no delivery rule active on the
 * date, **every** delivery matches. Reading it the other way round would make a
 * fleet with no rules configured earn nothing, which is not what the rule is
 * for — it narrows a set, it does not gate one.
 *
 * Scope is the junction table only here, unlike `_restaurant_daily_dpd_target`:
 * the SQL reads `delivery_rule_scopes` for this predicate, and a rule that
 * carries a legacy `restaurant_id` but no scope row genuinely matches nothing.
 * Widening it to the legacy column would make this disagree with the database
 * about which deliveries were paid.
 */
export function deliveryMatchesRules(args: {
  delivery: {
    status: string;
    zone_id: string | null;
    partner_id: string | null;
    scope_restaurant_id: string | null;
  };
  checkDate: string;
  deliveryRules: readonly DeliveryRule[];
  deliveryScopesByRule: ReadonlyMap<string, readonly RuleScope[]>;
}): boolean {
  const { delivery, checkDate, deliveryRules, deliveryScopesByRule } = args;

  if (delivery.status !== "verified") return false;

  const active = deliveryRules.filter(
    (rule) => rule.status === "active" && checkDate >= rule.start_date && checkDate <= rule.end_date,
  );

  if (active.length === 0) return true;

  return active.some((rule) => {
    const scopes = deliveryScopesByRule.get(rule.id) ?? [];
    if (rule.scope_type === "zone") {
      return scopes.some((s) => s.zone_id !== null && s.zone_id === delivery.zone_id);
    }
    if (rule.scope_type === "partner") {
      return scopes.some((s) => s.partner_id !== null && s.partner_id === delivery.partner_id);
    }
    return scopes.some(
      (s) => s.restaurant_id !== null && s.restaurant_id === delivery.scope_restaurant_id,
    );
  });
}

/** One `source_companies` document, as it decides an outsourced rider's pay. */
export type SourceCompanyConfig = {
  key: string;
  name: string;
  incentive_enabled: boolean;
  dpd_target: number | null;
  incentive_above_kwd: number | null;
  incentive_below_kwd: number | null;
  effective_from: string | null;
};

/**
 * `company_config_applies`: whether the outsourced company's own scheme — flat
 * above/below per order — replaces the restaurant incentive rules on a date.
 *
 * The predicate is deliberately strict about `source_company` and
 * `effective_from`, because it selects the **whole** pricing path: a rider whose
 * company has no start date keeps restaurant rules, which is the SOP's own
 * staging ("DPD only" before Ops enables rates). An outsourced rider resolves
 * their order count across every restaurant, so treating a half-configured
 * company as governing would price a day against a target nobody set.
 */
export function companyConfigApplies(args: {
  riderCategory: string | null;
  company: SourceCompanyConfig | null;
  onDate: string;
}): boolean {
  const { riderCategory, company, onDate } = args;
  if (riderCategory !== "outsourced") return false;
  if (company === null) return false;
  if (company.effective_from === null) return false;
  return onDate >= company.effective_from;
}
