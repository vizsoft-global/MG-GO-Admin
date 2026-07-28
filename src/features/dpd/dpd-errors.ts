export const DPD_ERROR_KEYS = [
  "not_authorized",
  "missing_fields",
  "invalid_dates",
  "invalid_scope",
  "invalid_target",
  "invalid_base",
  "invalid_tiers",
  "invalid_reward_mode",
  "invalid_reward",
  "save_failed",
  "delete_failed",
  "restaurant_exists",
  "invalid_coordinates",
  "delivery_not_found",
] as const;

export type DpdErrorKey = (typeof DPD_ERROR_KEYS)[number];

export function isDpdErrorKey(value: string): value is DpdErrorKey {
  return (DPD_ERROR_KEYS as readonly string[]).includes(value);
}
