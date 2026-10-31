/**
 * Shared delivery context, cached in one Firestore document.
 *
 * `driverGetDeliveryProximityContext` used to assemble this per rider per call —
 * the settings doc, the zone, the rider's restaurant rows and every geofence on
 * them, a dozen reads for data that is identical for every rider on the same
 * stores. `deliveryProximitySweep` rebuilds this document every ten minutes,
 * every admin write that changes its inputs rebuilds it inline, and the callable
 * serves from it, so a call costs the rider's two auth reads, the rider's
 * restaurant id list and this one document.
 *
 * This module deliberately does not import `driver-deliveries.ts`: the builder
 * needs that module's loaders, and importing it back would make the pair
 * circular. The builder lives in `delivery-context-build.ts` instead.
 */
import { getFirestore } from "../core/fs";
import { COLLECTIONS } from "../core/collections";
import type { ProofOcrMode } from "../core/delivery-flags";
import { driverRestaurantIds } from "./deliveries-shared";
import { numberOrNull, type Dict } from "./_shared";

export const DELIVERY_CONTEXT_COLLECTION = "delivery_context_cache";
export const DELIVERY_CONTEXT_DOC = "current";

/** Bumped when the stored shape changes, so an old doc is treated as missing. */
export const DELIVERY_CONTEXT_VERSION = 1;

/**
 * How long a snapshot stays authoritative.
 *
 * The sweep runs every ten minutes, so two missed passes means something is
 * broken. Past that the callable reads live rather than serve a stale gate —
 * a wrong radius blocks a rider at the store door.
 */
export const DELIVERY_CONTEXT_MAX_AGE_MS = 25 * 60 * 1000;

/** The rider's restaurant ids, scanned to the same bound as `loadAssignedRestaurantContext`. */
const SCAN = 500;

export type CachedGeofence = {
  id: string | null;
  kind: string | null;
  zone_type: string | null;
  geometry: unknown;
  name: string | null;
  color: string | null;
};

/** One restaurant exactly as the callable returns it: already sorted. */
export type CachedRestaurant = {
  id: string;
  name: string | null;
  latitude: number | null;
  longitude: number | null;
  geofences: CachedGeofence[];
};

export type CachedDeliverySettings = {
  proximityMeters: number;
  earlyDropMeters: number;
  proofOcrMode: ProofOcrMode;
};

export type DeliveryContextSnapshot = {
  builtAt: Date;
  settings: CachedDeliverySettings;
  /** Keyed by zone id: `{ name, zone_type, geometry }`. */
  zones: Record<string, Dict>;
  /** Keyed by restaurant id. */
  restaurants: Record<string, CachedRestaurant>;
  /** True when the build hit its size or row cap; the rest falls back to live. */
  truncated: boolean;
};

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function asDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (value && typeof (value as { toDate?: unknown }).toDate === "function") {
    const date = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function parseGeofence(raw: unknown): CachedGeofence | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Dict;
  return {
    id: asString(row["id"]),
    kind: asString(row["kind"]),
    zone_type: asString(row["zone_type"]),
    geometry: row["geometry"] ?? null,
    name: asString(row["name"]),
    color: asString(row["color"]),
  };
}

function parseRestaurant(raw: unknown, id: string): CachedRestaurant | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Dict;
  const geofences: CachedGeofence[] = [];
  if (Array.isArray(row["geofences"])) {
    for (const fence of row["geofences"]) {
      const parsed = parseGeofence(fence);
      if (parsed) geofences.push(parsed);
    }
  }
  return {
    id,
    name: asString(row["name"]),
    latitude: numberOrNull(row["latitude"]),
    longitude: numberOrNull(row["longitude"]),
    geofences,
  };
}

/**
 * The cached context, or null when the document is absent or was written by an
 * older shape. A null answer is the caller's cue to assemble from Firestore.
 */
export async function readDeliveryContextSnapshot(): Promise<DeliveryContextSnapshot | null> {
  const snap = await getFirestore()
    .collection(DELIVERY_CONTEXT_COLLECTION)
    .doc(DELIVERY_CONTEXT_DOC)
    .get();
  if (!snap.exists) return null;

  const data = (snap.data() ?? {}) as Dict;
  if (numberOrNull(data["version"]) !== DELIVERY_CONTEXT_VERSION) return null;

  const builtAt = asDate(data["built_at"]);
  const proximityMeters = numberOrNull(data["proximity_meters"]);
  const earlyDropMeters = numberOrNull(data["early_drop_meters"]);
  const proofOcrMode = asString(data["proof_ocr_mode"]);
  if (!builtAt || proximityMeters === null || earlyDropMeters === null) return null;
  if (proofOcrMode !== "warn" && proofOcrMode !== "off" && proofOcrMode !== "block") return null;

  const zones: Record<string, Dict> = {};
  const rawZones = data["zones"];
  if (rawZones && typeof rawZones === "object") {
    for (const [id, value] of Object.entries(rawZones as Dict)) {
      if (!value || typeof value !== "object") continue;
      const row = value as Dict;
      zones[id] = {
        name: asString(row["name"]),
        zone_type: row["zone_type"] ?? null,
        geometry: row["geometry"] ?? null,
      };
    }
  }

  const restaurants: Record<string, CachedRestaurant> = {};
  const rawRestaurants = data["restaurants"];
  if (rawRestaurants && typeof rawRestaurants === "object") {
    for (const [id, value] of Object.entries(rawRestaurants as Dict)) {
      const parsed = parseRestaurant(value, id);
      if (parsed) restaurants[id] = parsed;
    }
  }

  return {
    builtAt,
    settings: { proximityMeters, earlyDropMeters, proofOcrMode },
    zones,
    restaurants,
    truncated: data["truncated"] === true,
  };
}

/** Whether the sweep has abandoned this document for longer than it may. */
export function isDeliveryContextStale(
  snapshot: DeliveryContextSnapshot,
  now: Date = new Date(),
): boolean {
  return now.getTime() - snapshot.builtAt.getTime() > DELIVERY_CONTEXT_MAX_AGE_MS;
}

/**
 * The riders' assigned restaurants, served from the snapshot.
 *
 * Null means at least one assigned restaurant is not in the snapshot — a store
 * created since the last build, or a build that stopped at its cap. The caller
 * then falls back to the live read rather than silently dropping a store, which
 * would make the proximity gate refuse a pickup it should allow.
 */
export function cachedRestaurantsFor(
  restaurantIds: readonly string[],
  snapshot: DeliveryContextSnapshot,
): CachedRestaurant[] | null {
  const out: CachedRestaurant[] = [];
  for (const id of restaurantIds) {
    const row = snapshot.restaurants[id];
    if (!row) return null;
    out.push(row);
  }
  return out
    .slice()
    .sort((a, b) => a.name?.localeCompare(b.name ?? "") ?? 0);
}

/** The rider's restaurant ids: the driver row's own list plus the junction table. */
export async function assignedRestaurantIds(
  driverId: string,
  driver: Dict,
): Promise<string[]> {
  const ids = new Set(driverRestaurantIds(driver));
  const junction = await getFirestore()
    .collection(COLLECTIONS.driverRestaurants)
    .where("driver_id", "==", driverId)
    .limit(SCAN)
    .get();
  for (const doc of junction.docs) {
    const restaurantId = asString((doc.data() ?? {})["restaurant_id"]);
    if (restaurantId) ids.add(restaurantId);
  }
  return [...ids];
}

/** Assigned restaurants from the snapshot, or null when the caller must read live. */
export async function deliveryContextRestaurants(
  driverId: string,
  driver: Dict,
  snapshot: DeliveryContextSnapshot,
): Promise<CachedRestaurant[] | null> {
  const ids = await assignedRestaurantIds(driverId, driver);
  return cachedRestaurantsFor(ids, snapshot);
}
