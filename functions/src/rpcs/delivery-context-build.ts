/**
 * The single writer of `delivery_context_cache/current`.
 *
 * Two callers, one build: `deliveryProximitySweep` (the ten-minute backstop) and
 * every admin write that changes what the rider's proximity gate reads — the
 * fleet settings, a zone shape, a restaurant or its geofences. Those call
 * `rebuildDeliveryContextSafe` inline so an operator's edit is live on the next
 * rider poll instead of the next sweep. The scheduler stays because writes leak:
 * console edits, purges and bulk imports never pass through an RPC.
 *
 * No `onSchedule` in this module on purpose. A callable module that imported the
 * scheduler file would construct a scheduled endpoint inside an instance that
 * must not have one.
 */
import { logger } from "firebase-functions";
import { Timestamp, getFirestore } from "../core/fs";
import { COLLECTIONS } from "../core/collections";
import { numberOrNull, type Dict } from "./_shared";
import { loadProximitySettings } from "./driver-deliveries";
import {
  DELIVERY_CONTEXT_COLLECTION,
  DELIVERY_CONTEXT_DOC,
  DELIVERY_CONTEXT_VERSION,
  type CachedGeofence,
  type CachedRestaurant,
} from "./delivery-context";

/**
 * Row caps. A pass that hits one still writes what it has and marks the document
 * truncated; every restaurant it skipped is served live by the callable.
 */
const MAX_RESTAURANTS = 2_000;
const MAX_ZONES = 2_000;
const MAX_GEOFENCES = 5_000;

/** Firestore rejects a document over 1 MiB, so the build stops short of it. */
const BYTE_BUDGET = 800_000;

export type DeliveryContextBuildCounts = {
  restaurants: number;
  zones: number;
  geofences: number;
  bytes: number;
  truncated: boolean;
};

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function asDate(value: unknown): Date | null {
  if (value && typeof (value as { toDate?: unknown }).toDate === "function") {
    const date = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  return null;
}

/** Same order the callable produced before caching: oldest fence first. */
function geofencePayload(id: string, data: Dict): CachedGeofence {
  return {
    id,
    kind: asString(data["kind"]),
    zone_type: asString(data["zone_type"]),
    geometry: data["geometry"] ?? null,
    name: asString(data["name"]),
    color: asString(data["color"]),
  };
}

/**
 * One pass: settings, zone shapes, then every restaurant with its geofences.
 *
 * Restaurants go last so the byte budget can stop the build without leaving the
 * zones half-written; a truncated build is still useful to every rider whose
 * stores made it in.
 */
export async function buildDeliveryContextCore(
  at: Date = new Date(),
): Promise<DeliveryContextBuildCounts> {
  const db = getFirestore();
  const settings = await loadProximitySettings();

  const [zoneSnap, geofenceSnap, restaurantSnap] = await Promise.all([
    db.collection(COLLECTIONS.zones).limit(MAX_ZONES).get(),
    db.collection(COLLECTIONS.restaurantGeofences).limit(MAX_GEOFENCES).get(),
    db.collection(COLLECTIONS.restaurants).limit(MAX_RESTAURANTS).get(),
  ]);

  const zones: Record<string, Dict> = {};
  for (const doc of zoneSnap.docs) {
    const data = (doc.data() ?? {}) as Dict;
    zones[doc.id] = {
      name: asString(data["name"]),
      zone_type: data["zone_type"] ?? null,
      geometry: data["geometry"] ?? null,
    };
  }

  const fencesByRestaurant = new Map<string, Array<{ at: number; fence: CachedGeofence }>>();
  for (const doc of geofenceSnap.docs) {
    const data = (doc.data() ?? {}) as Dict;
    const restaurantId = asString(data["restaurant_id"]);
    if (!restaurantId) continue;
    const createdAt = asDate(data["created_at"])?.getTime() ?? 0;
    const group = fencesByRestaurant.get(restaurantId) ?? [];
    group.push({ at: createdAt, fence: geofencePayload(doc.id, data) });
    fencesByRestaurant.set(restaurantId, group);
  }

  const restaurants: Record<string, CachedRestaurant> = {};
  let bytes = JSON.stringify({ zones }).length;
  let truncated = zoneSnap.size >= MAX_ZONES || geofenceSnap.size >= MAX_GEOFENCES;
  let built = 0;

  for (const doc of restaurantSnap.docs) {
    const data = (doc.data() ?? {}) as Dict;
    const group = (fencesByRestaurant.get(doc.id) ?? [])
      .slice()
      .sort((left, right) => left.at - right.at)
      .map((entry) => entry.fence);
    const row: CachedRestaurant = {
      id: doc.id,
      name: asString(data["name"]),
      latitude: numberOrNull(data["latitude"]),
      longitude: numberOrNull(data["longitude"]),
      geofences: group,
    };
    const size = JSON.stringify(row).length;
    if (bytes + size > BYTE_BUDGET) {
      truncated = true;
      break;
    }
    bytes += size;
    restaurants[doc.id] = row;
    built += 1;
  }

  if (restaurantSnap.size >= MAX_RESTAURANTS) truncated = true;

  await db
    .collection(DELIVERY_CONTEXT_COLLECTION)
    .doc(DELIVERY_CONTEXT_DOC)
    .set({
      version: DELIVERY_CONTEXT_VERSION,
      built_at: Timestamp.fromDate(at),
      proximity_meters: settings.proximityMeters,
      early_drop_meters: settings.earlyDropMeters,
      proof_ocr_mode: settings.proofOcrMode,
      zones,
      restaurants,
      truncated,
    });

  return {
    restaurants: built,
    zones: zoneSnap.size,
    geofences: geofenceSnap.size,
    bytes,
    truncated,
  };
}

/**
 * Inline rebuild for a write that has already committed.
 *
 * Swallowed on purpose: the operator's row is saved either way, and a failed
 * rebuild only costs reads — the callable serves live once the document is stale,
 * and the next sweep pass is the retry.
 */
export async function rebuildDeliveryContextSafe(reason: string): Promise<void> {
  const startedAt = Date.now();
  try {
    const counts = await buildDeliveryContextCore();
    logger.info("delivery context rebuilt", { reason, ...counts, ms: Date.now() - startedAt });
  } catch (err) {
    logger.error("delivery context rebuild failed", { reason, err, ms: Date.now() - startedAt });
  }
}
