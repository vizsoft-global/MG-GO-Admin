import {
  haversineMeters,
  pointWithinZoneProximity,
  type ZoneFeature,
  type ZoneGeometryType,
} from "./geo";

export function zoneTypeOf(value: unknown): ZoneGeometryType {
  return value === "circle" ? "circle" : "polygon";
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export type RestaurantCandidate = {
  id: string;
  restaurant: Record<string, unknown>;
  geofences: Record<string, unknown>[];
};

/**
 * Inclusion/exclusion fences first; a restaurant with no fences falls back to
 * its pin and the fleet proximity allowance. This is the one rule both pickup
 * creation and the check-in gate use.
 */
export function restaurantAllowed(args: {
  lat: number;
  lng: number;
  restaurant: Record<string, unknown>;
  geofences: Record<string, unknown>[];
  proximityMeters: number;
}): boolean {
  const { lat, lng, restaurant, geofences, proximityMeters } = args;
  const contains = (fence: Record<string, unknown>) =>
    pointWithinZoneProximity(
      lat,
      lng,
      fence["geometry"] as ZoneFeature,
      zoneTypeOf(fence["zone_type"]),
      0,
    );
  const inclusions = geofences.filter((fence) => fence["kind"] === "inclusion");
  if (geofences.some((fence) => fence["kind"] === "exclusion" && contains(fence))) {
    return false;
  }
  if (inclusions.length > 0) return inclusions.some(contains);

  const pinLat = num(restaurant["latitude"]);
  const pinLng = num(restaurant["longitude"]);
  if (pinLat === null || pinLng === null) return false;
  return haversineMeters(lat, lng, pinLat, pinLng) <= Math.max(proximityMeters, 0);
}

export function restaurantDistanceMeters(
  lat: number,
  lng: number,
  restaurant: Record<string, unknown>,
): number | null {
  const pinLat = num(restaurant["latitude"]);
  const pinLng = num(restaurant["longitude"]);
  if (pinLat === null || pinLng === null) return null;
  return haversineMeters(lat, lng, pinLat, pinLng);
}

export function nearestRestaurant(
  lat: number,
  lng: number,
  candidates: RestaurantCandidate[],
): { id: string; name: string | null; distanceM: number } | null {
  let best: { id: string; name: string | null; distanceM: number } | null = null;
  for (const candidate of candidates) {
    const distanceM = restaurantDistanceMeters(lat, lng, candidate.restaurant);
    if (distanceM === null) continue;
    if (!best || distanceM < best.distanceM) {
      const name = candidate.restaurant["name"];
      best = {
        id: candidate.id,
        name: typeof name === "string" && name.trim() !== "" ? name.trim() : null,
        distanceM,
      };
    }
  }
  return best;
}
