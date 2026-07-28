export const RESTAURANT_GEOFENCE_ERROR_KEYS = [
  "geometry_required",
  "invalid_circle",
  "invalid_radius",
  "invalid_polygon",
  "polygon_too_small",
  "polygon_self_intersect",
  "invalid_kind",
  "save_failed",
  "load_failed",
] as const;

export type RestaurantGeofenceErrorKey =
  (typeof RESTAURANT_GEOFENCE_ERROR_KEYS)[number];

export function isRestaurantGeofenceErrorKey(
  value: string,
): value is RestaurantGeofenceErrorKey {
  return (RESTAURANT_GEOFENCE_ERROR_KEYS as readonly string[]).includes(value);
}
