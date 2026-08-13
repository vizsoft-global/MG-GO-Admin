/** Diff for driver_restaurants so we never empty an active mapping mid-save.
 * Add first, then remove — otherwise AFTER DELETE sets drivers.status = pending.
 */
export function restaurantSyncPlan(
  current: string[],
  next: string[],
): { toAdd: string[]; toRemove: string[] } {
  const currentSet = new Set(current);
  const nextSet = new Set(next);
  return {
    toAdd: next.filter((id) => !currentSet.has(id)),
    toRemove: current.filter((id) => !nextSet.has(id)),
  };
}
