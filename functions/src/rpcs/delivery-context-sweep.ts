/**
 * Ten-minute rebuild of the shared delivery context.
 *
 * The rider's proximity gate needs the fleet settings, the rider's zone shape and
 * the geofences on the rider's stores. None of that changes minute to minute, so
 * it is assembled once here and the callable reads the one document instead of
 * repeating a dozen reads on every 60-second poll.
 *
 * A failed pass is retried by the next interval rather than an immediate re-run,
 * and the callable falls back to a live read once the document is stale, so a
 * broken sweep costs reads, never a wrong gate.
 */
import "../core/init";
import { logger } from "firebase-functions";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { Timestamp, getFirestore } from "../core/fs";
import { COLLECTIONS } from "../core/collections";
import { FUNCTIONS_REGION } from "../router/lanes";
import { numberOrNull, type Dict } from "./_shared";
import { loadProximitySettings } from "./driver-deliveries";
import {
  DELIVERY_CONTEXT_COLLECTION,
  DELIVERY_CONTEXT_DOC,
  DELIVERY_CONTEXT_VERSION,
  type CachedGeofence,
  type CachedRestaurant,
} from "./delivery-context";

/** The rider app polls every minute; ten keeps a settings change prompt and the sweep trivial. */
export const DELIVERY_CONTEXT_SCHEDULE = "every 10 minutes";

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

export const deliveryProximitySweep = onSchedule(
  {
    schedule: DELIVERY_CONTEXT_SCHEDULE,
    region: FUNCTIONS_REGION,
    timeoutSeconds: 120,
    memory: "512MiB",
    cpu: 1,
    concurrency: 1,
    maxInstances: 1,
    retryCount: 0,
  },
  async () => {
    const startedAt = Date.now();
    try {
      const counts = await buildDeliveryContextCore();
      logger.info("delivery context sweep", { ...counts, ms: Date.now() - startedAt });
    } catch (err) {
      // Swallowed on purpose: the previous snapshot keeps serving until it goes
      // stale, and the next interval is the retry.
      logger.error("delivery context sweep failed", { err, ms: Date.now() - startedAt });
    }
  },
);
