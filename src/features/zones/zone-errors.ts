/** Known `pages.zones.errors.*` keys returned from zone server actions */
export const ZONE_ERROR_KEYS = [
  "not_authorized",
  "missing_fields",
  "geometry_required",
  "invalid_circle",
  "invalid_polygon",
  "invalid_radius",
  "polygon_too_small",
  "polygon_self_intersect",
  "code_exists",
  "has_drivers",
  "save_failed",
] as const;

export type ZoneErrorKey = (typeof ZONE_ERROR_KEYS)[number];

export function isZoneErrorKey(value: string | undefined): value is ZoneErrorKey {
  return ZONE_ERROR_KEYS.includes(value as ZoneErrorKey);
}

export function mapZoneDbError(error: {
  code?: string;
  message?: string;
}): ZoneErrorKey {
  if (error.code === "23505") return "code_exists";
  return "save_failed";
}
