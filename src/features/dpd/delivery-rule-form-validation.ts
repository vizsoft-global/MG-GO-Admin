import type { DpdErrorKey } from "./dpd-errors";
import type { RuleScopeType } from "./types";

export type DeliveryRuleFormField =
  | "name"
  | "scopeIds"
  | "startDate"
  | "endDate"
  | "dpdTarget"
  | "priority";

export type DeliveryRuleFormErrors = Partial<
  Record<DeliveryRuleFormField, DpdErrorKey>
>;

export type ValidateDeliveryRuleFormInput = {
  name: string;
  scopeType: RuleScopeType;
  zoneIds: string[];
  partnerIds: string[];
  restaurantIds: string[];
  startDate: string;
  endDate: string;
  dpdTarget: string;
  priority: string;
};

function scopeIdsForType(input: ValidateDeliveryRuleFormInput): string[] {
  if (input.scopeType === "zone") return input.zoneIds;
  if (input.scopeType === "partner") return input.partnerIds;
  return input.restaurantIds;
}

/**
 * The same per-field rules `saveDeliveryRule` enforces server-side, run before
 * the round trip so a missing scope or a reversed window is named on the field
 * that caused it instead of surfacing as one generic failure. The keys are the
 * shared `pages.dpd.errors.*` keys, so the inline message and the toast cannot
 * disagree about what went wrong.
 */
export function validateDeliveryRuleForm(
  input: ValidateDeliveryRuleFormInput,
): DeliveryRuleFormErrors {
  const errors: DeliveryRuleFormErrors = {};

  if (!input.name.trim()) errors.name = "name_required";

  if (scopeIdsForType(input).length === 0) errors.scopeIds = "invalid_scope";

  if (!input.startDate.trim()) {
    errors.startDate = "missing_fields";
  }
  if (!input.endDate.trim()) {
    errors.endDate = "missing_fields";
  } else if (input.startDate.trim() && input.endDate < input.startDate) {
    errors.endDate = "invalid_dates";
  }

  if (input.dpdTarget.trim()) {
    const target = Number(input.dpdTarget);
    if (!Number.isFinite(target) || target <= 0) {
      errors.dpdTarget = "invalid_target";
    }
  }

  if (input.priority.trim() && !Number.isFinite(Number(input.priority))) {
    errors.priority = "invalid_priority";
  }

  return errors;
}

export function hasDeliveryRuleValidationErrors(
  errors: DeliveryRuleFormErrors,
): boolean {
  return Object.keys(errors).length > 0;
}

/**
 * Which field a server rejection belongs to, so a value the client could not
 * prove wrong on its own still lands on the right input. `missing_fields` and
 * `save_failed` are deliberately unmapped: they are reported as a toast rather
 * than pinned to a field that may be perfectly fine.
 */
export function deliveryRuleFieldForError(
  error: string,
): DeliveryRuleFormField | null {
  switch (error) {
    case "name_required":
      return "name";
    case "invalid_scope":
      return "scopeIds";
    case "invalid_dates":
      return "endDate";
    case "invalid_target":
      return "dpdTarget";
    case "invalid_priority":
      return "priority";
    default:
      return null;
  }
}
