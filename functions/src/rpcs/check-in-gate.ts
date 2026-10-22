import { getFirestore } from "../core/fs";
import { COLLECTIONS } from "../core/collections";
import { pointWithinZoneProximity, type ZoneFeature } from "../core/geo";
import {
  nearestRestaurant,
  restaurantAllowed,
  restaurantDistanceMeters,
  restaurantReachableForPartner,
  zoneTypeOf,
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

/**
 * Project key for the Keeta fleet. Stored lowercase by the Admin driver form
 * (`parseDriverProjectKey` rejects `Keeta`), but the comparison is
 * case-insensitive so a hand-edited row cannot silently keep the photo gate.
 */
export function isKeetaDriver(driver: Dict): boolean {
  const key = driver["project_key"];
  return typeof key === "string" && key.trim().toLowerCase() === "keeta";
}

/** The rider's assigned zone, as the check-in gate needs it. */
export type CheckInZone = {
  id: string;
  name: string | null;
  geometry: unknown;
  zone_type: unknown;
};

/** `{ id, name }` — what the phone names in the refusal copy. */
export type CheckInZoneSummary = { id: string; name: string | null };

export type KeetaZoneOutcome = "in_range" | "outside_zone" | "no_zone";

/**
 * The rider's zone document, or null when the assignment is missing.
 *
 * `loadDriverZone` in `driver-deliveries` returns only geometry/type and that
 * module imports this one's sibling (`driver-home`), so importing it here would
 * create a cycle. The read is the same single document.
 */
export async function loadCheckInZone(zoneId: string | null): Promise<CheckInZone | null> {
  if (!zoneId) return null;
  const snap = await getFirestore().collection(COLLECTIONS.zones).doc(zoneId).get();
  if (!snap.exists) return null;
  const data = (snap.data() ?? {}) as Dict;
  const name = data["name"];
  return {
    id: zoneId,
    name: typeof name === "string" && name.trim() !== "" ? name.trim() : null,
    geometry: data["geometry"],
    zone_type: data["zone_type"],
  };
}

/**
 * Keeta clock-in gate: inside the assigned zone, with a zero buffer.
 *
 * A Keeta rider has no single store to prove, so the restaurant proximity test
 * would always refuse them. The zone is the promise instead: `no_zone` (no
 * assignment, a missing document or no stored shape) is the "ask your
 * administrator" case, and `outside_zone` is the "move inside your zone" case.
 * A shape that exists but cannot be parsed reads as outside rather than
 * no-zone, so a broken polygon cannot silently admit a rider.
 */
export function keetaZoneVerdict(args: {
  lat: number;
  lng: number;
  zone: CheckInZone | null;
}): { outcome: KeetaZoneOutcome; zone: CheckInZoneSummary | null } {
  const { lat, lng, zone } = args;
  if (!zone) return { outcome: "no_zone", zone: null };
  const summary: CheckInZoneSummary = { id: zone.id, name: zone.name };
  // No stored shape is the administrator case, not the "walk closer" case, so
  // the summary is dropped too and the phone shows the assignment copy.
  if (zone.geometry == null) return { outcome: "no_zone", zone: null };
  const inside = pointWithinZoneProximity(
    lat,
    lng,
    zone.geometry as ZoneFeature,
    zoneTypeOf(zone.zone_type),
    0,
  );
  return { outcome: inside ? "in_range" : "outside_zone", zone: summary };
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
