export const RESTAURANT_ERROR_KEYS = [
  "not_authorized",
  "missing_fields",
  "save_failed",
  "delete_failed",
  "restaurant_exists",
  "invalid_coordinates",
  "file_too_large",
  "invalid_type",
  "upload_failed",
] as const;

export type RestaurantErrorKey = (typeof RESTAURANT_ERROR_KEYS)[number];

export function isRestaurantErrorKey(value: string): value is RestaurantErrorKey {
  return (RESTAURANT_ERROR_KEYS as readonly string[]).includes(value);
}
