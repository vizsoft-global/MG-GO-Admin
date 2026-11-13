/**
 * Targeted mirror push for writes that bypass the admin RPCs.
 *
 * Bites-Admin cannot read `musallam-delivery-prod`, so the delivery side copies the
 * store→rider links and the restaurant catalogue into `bites-4f514` (see
 * `bites-mirror.ts`). The admin RPCs that own a write push inline. The panel's own
 * server actions write Firestore directly instead, so they call this callable with
 * only the rows they touched.
 *
 * A trigger cannot do this job: the live database is the named `default` in
 * me-central2, where this project's agreement blocks compute.
 *
 * Every push is best effort and every list is bounded. A caller names the rows it
 * changed, so one call is a handful of document reads and writes rather than a scan.
 */
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { getBitesFirestore } from "../core/bites";
import { getFirestore, type Firestore } from "../core/fs";
import { requireStaffAny } from "../core/staff";
import { pushDriverIdentityMirror, pushRestaurantMirror } from "./bites-mirror";

/**
 * One page of the panel's own bulk edits.
 *
 * The drivers import and the purge RPCs are the only callers that could exceed this,
 * and they push per batch. A larger list belongs on `adminBackfillBitesMirror`, which
 * reconciles the whole catalogue and can clear orphans this callable cannot see.
 */
const MAX_TARGETS = 200;

export type MirrorTargets = {
  restaurantIds: readonly string[];
  driverIds: readonly string[];
};

/** Dedupes and bounds one id list. A malformed list is a caller bug, not a retry. */
export function mirrorIdList(raw: unknown): string[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw new HttpsError("invalid-argument", "invalid_ids");
  const ids: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") throw new HttpsError("invalid-argument", "invalid_ids");
    const id = item.trim();
    if (id !== "" && !ids.includes(id)) ids.push(id);
  }
  if (ids.length > MAX_TARGETS) throw new HttpsError("out-of-range", "too_many_ids");
  return ids;
}

/**
 * Fans one target list out over the mirror writers.
 *
 * Restaurants go first: `pushRestaurantMirror` also recomputes that store's rider link
 * from `driver_restaurants`, so a restaurant whose rider set changed is repaired even
 * when the caller could not name the rider. The driver pass then covers a name or
 * number change on a store that did not move.
 *
 * The counts are riders and stores repaired, not links touched: `syncDriverIdentity`
 * refreshes every store a rider holds in one call.
 */
export async function pushMirrorTargets(
  db: Firestore,
  targets: MirrorTargets,
  at: Date = new Date(),
  bites: Firestore = getBitesFirestore(),
): Promise<{ restaurants: number; drivers: number }> {
  let restaurants = 0;
  for (const restaurantId of targets.restaurantIds) {
    if (await pushRestaurantMirror(db, restaurantId, at, bites)) restaurants += 1;
  }

  let drivers = 0;
  for (const driverId of targets.driverIds) {
    if (await pushDriverIdentityMirror(db, driverId, at, bites)) drivers += 1;
  }

  return { restaurants, drivers };
}

/**
 * The panel's push after a direct write.
 *
 * Gated on either module because the callers are: the driver assign sheet and the
 * driver form hold `drivers.manage`, the store form holds `restaurants.manage`.
 */
export const adminSyncBitesMirror = onCall(async (request) => {
  await requireStaffAny(request, ["drivers.manage", "restaurants.manage"]);

  const data = (request.data ?? {}) as Record<string, unknown>;
  const restaurantIds = mirrorIdList(data.p_restaurant_ids ?? data.restaurantIds);
  const driverIds = mirrorIdList(data.p_driver_ids ?? data.driverIds);
  if (restaurantIds.length === 0 && driverIds.length === 0) {
    return { ok: true, restaurants: 0, drivers: 0 };
  }

  const counts = await pushMirrorTargets(getFirestore(), { restaurantIds, driverIds });
  return { ok: true, ...counts };
});
