import type { Database } from "@/types/database";
import type { RestaurantStatus } from "@/features/restaurants/restaurant-status";

export type RuleScopeType = Database["public"]["Enums"]["rule_scope_type"];
export type RuleStatus = Database["public"]["Enums"]["rule_status"];
export type IncentivePeriod = Database["public"]["Enums"]["incentive_period"];
export type IncentiveTargetMode = Database["public"]["Enums"]["incentive_target_mode"];
export type IncentiveRewardMode = Database["public"]["Enums"]["incentive_reward_mode"];
export type IncentivePayoutMode = Database["public"]["Enums"]["incentive_payout_mode"];

export const RULE_SCOPE_TYPES: RuleScopeType[] = ["zone", "partner", "restaurant"];
export const RULE_STATUSES: RuleStatus[] = ["draft", "active", "ended"];
export const INCENTIVE_PERIODS: IncentivePeriod[] = ["daily", "weekly", "monthly"];
export const INCENTIVE_TARGET_MODES: IncentiveTargetMode[] = ["single", "tiered"];
export const INCENTIVE_REWARD_MODES: IncentiveRewardMode[] = ["fixed", "per_delivery"];

export type RestaurantRow = {
  id: string;
  partner_id: string | null;
  partner_name: string;
  zone_id: string | null;
  zone_name: string;
  name: string;
  logo_url: string | null;
  logo_display_url: string | null;
  external_merchant_id: string | null;
  map_link: string | null;
  latitude: number | null;
  longitude: number | null;
  status: RestaurantStatus;
  is_active: boolean;
  created_at: string;
};

export type DeliveryRuleRow = {
  id: string;
  name: string;
  status: RuleStatus;
  scope_type: RuleScopeType;
  zone_id: string | null;
  partner_id: string | null;
  restaurant_id: string | null;
  zone_ids: string[];
  partner_ids: string[];
  restaurant_ids: string[];
  scope_label: string;
  start_date: string;
  end_date: string;
  priority: number;
};

export type IncentiveRuleTierRow = {
  id: string;
  threshold_deliveries: number;
  reward_mode: IncentiveRewardMode;
  reward_kwd: number | null;
  reward_per_delivery_kwd: number | null;
  sort_order: number;
};

export type IncentiveRuleRow = {
  id: string;
  name: string;
  status: RuleStatus;
  scope_type: RuleScopeType;
  zone_id: string | null;
  partner_id: string | null;
  restaurant_id: string | null;
  zone_ids: string[];
  partner_ids: string[];
  restaurant_ids: string[];
  scope_label: string;
  period: IncentivePeriod;
  target_mode: IncentiveTargetMode;
  base_minimum_deliveries: number;
  target_deliveries: number | null;
  reward_mode: IncentiveRewardMode;
  reward_kwd: number;
  reward_per_delivery_kwd: number | null;
  payout_mode: IncentivePayoutMode;
  overrides_others: boolean;
  tiers: IncentiveRuleTierRow[];
  start_date: string;
  end_date: string;
  priority: number;
};

export type DpdScopeOptions = {
  zones: { id: string; name: string; code: string }[];
  partners: { id: string; name: string }[];
  restaurants: { id: string; name: string; partner_id: string | null; partner_name: string }[];
};

export type DeliveryValidationResult = {
  eligible: boolean;
  matchedRuleIds: string[];
  reasons: string[];
};

export type EarningsPreviewRuleBreakdown = {
  rule_id?: string;
  rule_name?: string;
  period?: string;
  eligible_count?: number;
  target_mode?: string;
  base_minimum?: number;
  target?: number | null;
  reward_mode?: string;
  reward_kwd?: number;
  amount_kwd?: number;
  tiers?: { threshold: number; reward_mode: string; met: boolean }[];
  note?: string;
  override_rule_id?: string;
};

export type EarningsPreviewRow = {
  driver_id: string;
  deliveries: number;
  incentive_kwd: number;
  rules: EarningsPreviewRuleBreakdown[];
};

export type EarningsPreviewResult = {
  earn_date: string;
  drivers: EarningsPreviewRow[];
};

export type EarningsDailyListRow = {
  id: string;
  driver_id: string;
  driver_code: string;
  driver_name: string;
  earn_date: string;
  deliveries: number;
  base_kwd: number;
  incentive_kwd: number;
  loan_deduction_kwd: number;
  penalty_kwd: number;
  reimbursement_kwd: number;
  net_kwd: number;
  wallet_amount_kwd: number | null;
  wallet_status: string | null;
};

export type EarningsDailyListResult = {
  start_date: string;
  end_date: string;
  rows: EarningsDailyListRow[];
};

export type EarningsDetailDelivery = {
  id: string;
  external_order_id: string | null;
  status: string;
  delivered_at: string;
  partner_id: string | null;
  partner_name: string | null;
  restaurant_id: string | null;
  restaurant_name: string | null;
  zone_id: string | null;
  zone_name: string | null;
  counts_for_earnings: boolean;
};

export type EarningsDetailRule = EarningsPreviewRuleBreakdown & {
  priority?: number;
  note?: string;
  override_rule_id?: string;
  final_incentive_kwd?: number;
};

export type EarningsDetailResult = {
  driver_id: string;
  earn_date: string;
  daily: {
    driver_id: string;
    earn_date: string;
    deliveries: number;
    base_kwd: number;
    incentive_kwd: number;
    loan_deduction_kwd: number;
    penalty_kwd: number;
    reimbursement_kwd: number;
    net_kwd: number;
    updated_at: string;
  } | null;
  wallet: {
    id: string;
    amount_kwd: number;
    status: string;
    approved_at: string;
    source_ref: string;
  } | null;
  eligible_deliveries_count: number;
  computed_incentive_kwd: number;
  deliveries: EarningsDetailDelivery[];
  rules: EarningsDetailRule[];
};

/** Client-side payout estimate (matches SQL compute_incentive_amount). */
export function computeIncentivePreview(
  rule: Pick<
    IncentiveRuleRow,
    | "target_mode"
    | "base_minimum_deliveries"
    | "target_deliveries"
    | "reward_mode"
    | "reward_kwd"
    | "reward_per_delivery_kwd"
    | "payout_mode"
    | "tiers"
  >,
  eligibleCount: number,
): number {
  const base = rule.base_minimum_deliveries;
  if (eligibleCount <= base) return 0;
  const cumulative = rule.payout_mode === "cumulative";

  if (rule.target_mode === "single") {
    const target = rule.target_deliveries;
    if (!cumulative && (target == null || eligibleCount < target)) return 0;
    if (rule.reward_mode === "fixed") return rule.reward_kwd;
    const rate = rule.reward_per_delivery_kwd ?? 0;
    let band = eligibleCount - base;
    if (target != null) band = Math.min(band, target - base);
    return rate * Math.max(band, 0);
  }

  let total = 0;
  const tiers = [...rule.tiers].sort(
    (a, b) => a.threshold_deliveries - b.threshold_deliveries,
  );
  for (const tier of tiers) {
    if (!cumulative && eligibleCount < tier.threshold_deliveries) continue;
    if (tier.reward_mode === "fixed") {
      total += tier.reward_kwd ?? 0;
    } else {
      const rate = tier.reward_per_delivery_kwd ?? 0;
      const band = Math.min(
        eligibleCount - base,
        tier.threshold_deliveries - base,
      );
      total += rate * Math.max(band, 0);
    }
  }
  return total;
}

export function formatIncentiveTargetSummary(
  rule: IncentiveRuleRow,
  t: (key: string, values?: Record<string, string | number>) => string,
): string {
  if (rule.target_mode === "tiered") {
    const thresholds = rule.tiers.map((x) => x.threshold_deliveries).join(", ");
    return t("targetSummaryTiered", {
      count: rule.tiers.length,
      thresholds: thresholds || "—",
    });
  }
  const base = rule.base_minimum_deliveries;
  const target = rule.target_deliveries ?? 0;
  if (base > 0) {
    return t("targetSummarySingleRange", { base, target });
  }
  return String(target);
}

export function formatIncentiveRewardSummary(
  rule: IncentiveRuleRow,
  t: (key: string, values?: Record<string, string | number>) => string,
): string {
  if (rule.target_mode === "tiered") {
    const parts = rule.tiers.map((tier) => {
      if (tier.reward_mode === "fixed") {
        return `${tier.threshold_deliveries}: ${tier.reward_kwd ?? 0}`;
      }
      return `${tier.threshold_deliveries}: ${tier.reward_per_delivery_kwd ?? 0}/${t("perDeliveryShort")}`;
    });
    return parts.join(" + ") || "—";
  }
  if (rule.reward_mode === "per_delivery") {
    return t("rewardSummaryPerDelivery", {
      rate: rule.reward_per_delivery_kwd ?? 0,
    });
  }
  return String(rule.reward_kwd);
}
