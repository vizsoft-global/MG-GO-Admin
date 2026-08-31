/** Same sentinel the zone picker writes when the field is cleared. */
export const NONE_ZONE = "__none_zone__";

/**
 * A driver is assigned when they have a zone, or at least one restaurant.
 * Neither is enough on its own to refuse; both is fine. The empty zone
 * sentinels are the same "no zone" the form writes when the picker is cleared.
 */
export function isAssignedZone(zoneId: string | null | undefined): boolean {
  const value = (zoneId ?? "").trim();
  return value.length > 0 && value !== NONE_ZONE;
}

export function hasOpsAssignment(
  zoneId: string | null | undefined,
  restaurants: number | readonly string[],
): boolean {
  if (isAssignedZone(zoneId)) return true;
  return typeof restaurants === "number" ? restaurants > 0 : restaurants.length > 0;
}
