import { getFirestore } from "../core/fs";
import { COLLECTIONS } from "../core/collections";
import {
  nearestRestaurant,
  restaurantAllowed,
  restaurantDistanceMeters,
  restaurantReachableForPartner,
  type RestaurantCandidate,
} from "../core/restaurant-proximity";
import { chunk, IN_FILTER_LIMIT, loadDocMap, type Dict } from "./_shared";
import { driverRestaurantIds } from "./deliveries-shared";

const SCAN = 500;

export type CheckInCandidate = RestaurantCandidate;

export type CheckInMatch = {
  id: string;
  name: string | null;
  distanceM: number | null;
};

export function isCheckInPhotoKeyForKey(driverId: string, key: string): boolean {
  const prefix = `drivers/${driverId}/check_in/`;
  if (!key.startsWith(prefix)) return false;
  if (key.includes("..")) return false;
  return key.length <= 512;
}

/**
 * Whether the rider still owes a check-in for `day`.
 *
 * This is the exact expression `driverSetDutyState` refuses on
 * (`!log || log.check_in_at == null`) and the same one `driverCheckInContext`
 * reports to the phone. Kept pure and shared so the precheck can never tell a
 * rider "already checked in" while the write still wants a selfie.
 */
export function needsCheckIn(log: Dict | null | undefined): boolean {
  return !log || log["check_in_at"] == null;
}

function candidateName(candidate: CheckInCandidate): string | null {
  const name = candidate.restaurant["name"];
  return typeof name === "string" && name.trim() !== "" ? name.trim() : null;
}

/**
 * The nearest assigned restaurant the rider may clock in at.
 *
 * `requestedId` is honoured only when that restaurant is actually in range — a
 * client cannot pin a check-in to a restaurant the rider is not standing at.
 */
export function matchCheckInRestaurant(input: {
  candidates: CheckInCandidate[];
  lat: number;
  lng: number;
  proximityMeters: number;
  requestedId?: string | null;
}): CheckInMatch | null {
  const { candidates, lat, lng, proximityMeters } = input;
  const ranked = candidates
    .map((candidate) => ({
      candidate,
      distanceM: restaurantDistanceMeters(lat, lng, candidate.restaurant),
    }))
    .sort((a, b) => {
      if (a.distanceM === null && b.distanceM === null) return 0;
      if (a.distanceM === null) return 1;
      if (b.distanceM === null) return -1;
      return a.distanceM - b.distanceM;
    });

  const allowed = (candidate: CheckInCandidate) =>
    restaurantAllowed({
      lat,
      lng,
      restaurant: candidate.restaurant,
      geofences: candidate.geofences,
      proximityMeters,
    });

  if (input.requestedId) {
    const requested = ranked.find((row) => row.candidate.id === input.requestedId);
    if (requested && allowed(requested.candidate)) {
      return {
        id: requested.candidate.id,
        name: candidateName(requested.candidate),
        distanceM: requested.distanceM,
      };
    }
  }

  const hit = ranked.find((row) => allowed(row.candidate));
  if (!hit) return null;
  return { id: hit.candidate.id, name: candidateName(hit.candidate), distanceM: hit.distanceM };
}

export function nearestCheckInRestaurant(input: {
  candidates: CheckInCandidate[];
  lat: number;
  lng: number;
}): { id: string; name: string | null; distanceM: number } | null {
  return nearestRestaurant(input.lat, input.lng, input.candidates);
}

/**
 * Published restaurants assigned to the rider. A partner-scoped rider reaches
 * the restaurants of their own partner plus the unowned shared ones.
 */
export async function loadCheckInCandidates(
  driverId: string,
  driver: Dict,
): Promise<CheckInCandidate[]> {
  const ids = new Set(driverRestaurantIds(driver));
  const db = getFirestore();
  const junction = await db
    .collection(COLLECTIONS.driverRestaurants)
    .where("driver_id", "==", driverId)
    .limit(SCAN)
    .get();
  for (const doc of junction.docs) {
    const restaurantId = doc.data()["restaurant_id"];
    if (typeof restaurantId === "string" && restaurantId.trim() !== "") {
      ids.add(restaurantId.trim());
    }
  }
  const list = [...ids];
  if (list.length === 0) return [];

  const restaurants = await loadDocMap(COLLECTIONS.restaurants, list);
  const partnerId =
    typeof driver["partner_id"] === "string" && driver["partner_id"].trim() !== ""
      ? driver["partner_id"].trim()
      : null;

  const published = list
    .filter((id) => {
      const row = restaurants.get(id);
      if (!row) return false;
      if (row["status"] !== "published" || row["is_active"] !== true) return false;
      return restaurantReachableForPartner(row, partnerId);
    })
    .map((id) => ({ id, data: restaurants.get(id) as Dict }));
  if (published.length === 0) return [];

  const fences = new Map<string, Dict[]>();
  for (const group of chunk(published.map((row) => row.id), IN_FILTER_LIMIT)) {
    const snap = await db
      .collection(COLLECTIONS.restaurantGeofences)
      .where("restaurant_id", "in", group)
      .get();
    for (const doc of snap.docs) {
      const data = (doc.data() ?? {}) as Dict;
      const restaurantId = typeof data["restaurant_id"] === "string" ? data["restaurant_id"] : null;
      if (!restaurantId) continue;
      fences.set(restaurantId, [...(fences.get(restaurantId) ?? []), { id: doc.id, ...data }]);
    }
  }

  return published.map((row) => ({
    id: row.id,
    restaurant: row.data,
    geofences: fences.get(row.id) ?? [],
  }));
}
