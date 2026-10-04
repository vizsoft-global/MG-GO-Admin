import type { DpdErrorKey } from "./dpd-errors";
import type {
  IncentiveRewardMode,
  IncentiveTargetMode,
  RuleScopeType,
} from "./types";

type TierDraft = {
  threshold_deliveries: string;
  reward_mode: IncentiveRewardMode;
  reward_kwd: string;
  reward_per_delivery_kwd: string;
};

export type IncentiveRuleFormField =
  | "name"
  | "period"
  | "scopeIds"
  | "startDate"
  | "endDate"
  | "baseMinimum"
  | "targetDeliveries"
  | "rewardKwd"
  | "rewardPerDeliveryKwd"
  | "tiers";

export type IncentiveRuleFormErrors = Partial<
  Record<IncentiveRuleFormField, DpdErrorKey>
>;

export type ValidateIncentiveRuleFormInput = {
  name: string;
  period: string;
  scopeType: RuleScopeType;
  zoneIds: string[];
  partnerIds: string[];
  restaurantIds: string[];
  startDate: string;
  endDate: string;
  targetMode: IncentiveTargetMode;
  baseMinimum: string;
  targetDeliveries: string;
  rewardMode: IncentiveRewardMode;
  rewardKwd: string;
  rewardPerDeliveryKwd: string;
  tiers: TierDraft[];
};

function scopeIdsForType(input: ValidateIncentiveRuleFormInput): string[] {
  if (input.scopeType === "zone") return input.zoneIds;
  if (input.scopeType === "partner") return input.partnerIds;
  return input.restaurantIds;
}

/**
 * A fixed Reward (KD) is cash paid out in whole and half dinars — QA asked for
 * `1`, `1.5`, `2`, `2.5` and a rejection of `0.001` / `1.25`.
 */
export const FIXED_REWARD_STEP_KWD = 0.5;

/**
 * A per-delivery rate is *not* a cash amount rounded to half a dinar: the
 * production `DPD 5` rule pays 0.250 / 0.350 / 0.500 per order, and those rates
 * are what the SOP band math is built on. It still refuses `0.001` — the QA
 * complaint — by snapping to 0.05, which every seeded rate already satisfies.
 */
export const PER_DELIVERY_REWARD_STEP_KWD = 0.05;

/**
 * True when `value` sits on a `step` grid (step 0.5 → 0, 0.5, 1, 1.5 …).
 * Uses a tolerance rather than `% 1` because a decimal step such as 0.05 is not
 * exactly representable in binary floating point (`0.35 / 0.05` is 6.999…).
 */
export function isOnRewardStep(value: number, step: number): boolean {
  if (!Number.isFinite(value) || value < 0 || step <= 0) return false;
  const units = value / step;
  return Math.abs(units - Math.round(units)) < 1e-6;
}

export function validateIncentiveRuleForm(
  input: ValidateIncentiveRuleFormInput,
): IncentiveRuleFormErrors {
  const errors: IncentiveRuleFormErrors = {};

  if (!input.name.trim()) {
    errors.name = "name_required";
  }

  if (!input.period.trim()) {
    errors.period = "missing_fields";
  }

  if (scopeIdsForType(input).length === 0) {
    errors.scopeIds = "invalid_scope";
  }

  if (!input.startDate.trim()) {
    errors.startDate = "missing_fields";
  }
  if (!input.endDate.trim()) {
    errors.endDate = "missing_fields";
  } else if (
    input.startDate.trim() &&
    input.endDate.trim() &&
    input.endDate < input.startDate
  ) {
    errors.endDate = "invalid_dates";
  }

  const baseMinimum = Number(input.baseMinimum);
  if (!Number.isFinite(baseMinimum) || baseMinimum < 0) {
    errors.baseMinimum = "invalid_base";
  }

  if (input.targetMode === "single") {
    const target = Number(input.targetDeliveries);
    if (!Number.isFinite(target) || target <= baseMinimum) {
      errors.targetDeliveries = "invalid_target";
    }

    if (input.rewardMode === "fixed") {
      const reward = Number(input.rewardKwd);
      if (
        !Number.isFinite(reward) ||
        reward < 0 ||
        !isOnRewardStep(reward, FIXED_REWARD_STEP_KWD)
      ) {
        errors.rewardKwd = "invalid_reward";
      }
    } else {
      const rate = Number(input.rewardPerDeliveryKwd);
      if (
        !Number.isFinite(rate) ||
        rate < 0 ||
        !isOnRewardStep(rate, PER_DELIVERY_REWARD_STEP_KWD)
      ) {
        errors.rewardPerDeliveryKwd = "invalid_reward";
      }
    }
  } else {
    if (input.tiers.length === 0) {
      errors.tiers = "invalid_tiers";
    } else {
      const thresholds = input.tiers.map((tier) => Number(tier.threshold_deliveries));
      const hasInvalidThreshold = thresholds.some(
        (threshold) => !Number.isFinite(threshold) || threshold < 1,
      );
      const hasInvalidReward = input.tiers.some((tier) => {
        if (tier.reward_mode === "fixed") {
          const reward = Number(tier.reward_kwd);
          return (
            !Number.isFinite(reward) ||
            reward < 0 ||
            !isOnRewardStep(reward, FIXED_REWARD_STEP_KWD)
          );
        }
        const rate = Number(tier.reward_per_delivery_kwd);
        return (
          !Number.isFinite(rate) ||
          rate < 0 ||
          !isOnRewardStep(rate, PER_DELIVERY_REWARD_STEP_KWD)
        );
      });
      const sorted = [...thresholds].sort((a, b) => a - b);
      const hasDuplicateOrDecreasing = sorted.some(
        (threshold, index) =>
          index > 0 && threshold <= sorted[index - 1],
      );

      if (
        hasInvalidThreshold ||
        hasInvalidReward ||
        hasDuplicateOrDecreasing ||
        sorted[0] <= baseMinimum
      ) {
        errors.tiers = "invalid_tiers";
      }
    }
  }

  return errors;
}

export function hasIncentiveRuleValidationErrors(
  errors: IncentiveRuleFormErrors,
): boolean {
  return Object.keys(errors).length > 0;
}
