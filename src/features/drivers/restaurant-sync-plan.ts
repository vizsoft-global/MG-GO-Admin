import type { DriverAccountStatus } from "./types";

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

/** `driver_restaurants_sync_status` sets pending when mappings go empty, and
 * does not put Active back after a later insert. Re-assert Active when that
 * was still the intended Login Status.
 */
export function accountStatusToRestoreAfterRestaurantSync(input: {
  statusBefore: DriverAccountStatus | null;
  intended: DriverAccountStatus | null;
  statusNow: DriverAccountStatus | null;
}): DriverAccountStatus | null {
  const keep = input.intended ?? input.statusBefore;
  if ((keep === "active" || keep === "suspended") && input.statusNow !== keep) {
    return keep;
  }
  return null;
}
