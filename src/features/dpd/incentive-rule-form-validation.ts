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

export function validateIncentiveRuleForm(
  input: ValidateIncentiveRuleFormInput,
): IncentiveRuleFormErrors {
  const errors: IncentiveRuleFormErrors = {};

  if (!input.name.trim()) {
    errors.name = "missing_fields";
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
      if (!Number.isFinite(reward) || reward < 0) {
        errors.rewardKwd = "invalid_reward";
      }
    } else {
      const rate = Number(input.rewardPerDeliveryKwd);
      if (!Number.isFinite(rate) || rate < 0) {
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
          return !Number.isFinite(reward) || reward < 0;
        }
        const rate = Number(tier.reward_per_delivery_kwd);
        return !Number.isFinite(rate) || rate < 0;
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
