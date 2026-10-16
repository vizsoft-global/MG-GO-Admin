import { textOrNull } from "./_shared";

export type IntakeRestaurantFact = {
  exists: boolean;
  is_active: unknown;
  status: unknown;
};

/** Unique restaurant ids from either intake or live driver mapping docs. */
export function restaurantIdsFromEdges(
  edges: ReadonlyArray<Record<string, unknown>>,
): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const edge of edges) {
    const id = textOrNull(edge.restaurant_id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

/**
 * Zone is enough. Otherwise at least one mapping must be a live published
 * restaurant — the same gate `validateRestaurantsPublished` uses on Add Driver.
 */
export function intakeAssigned(input: {
  zoneId: string | null | undefined;
  restaurants: ReadonlyArray<IntakeRestaurantFact>;
}): boolean {
  if (textOrNull(input.zoneId) !== null) return true;
  return input.restaurants.some(
    (row) => row.exists && row.is_active === true && row.status === "published",
  );
}
