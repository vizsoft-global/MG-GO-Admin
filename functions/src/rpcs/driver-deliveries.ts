import { randomUUID } from "crypto";
import { onCall } from "firebase-functions/v2/https";
import { Timestamp, getFirestore } from "../core/fs";
import { COLLECTIONS } from "../core/collections";
import { kuwaitDayString } from "../core/kuwait";
import { applyDeliveryRollup } from "../core/rollups";
import { requireRider, riderError } from "../core/rider";
import {
  haversineMeters,
  pointWithinZoneProximity,
  type ZoneFeature,
  type ZoneGeometryType,
} from "../core/geo";
import { driverRestaurantIds } from "./deliveries-shared";
import { findActiveShift } from "./driver-shift";
import {
  IN_FILTER_LIMIT,
  chunk,
  isoTimestamp,
  loadDocMap,
  logDriverOperation,
  numberOrNull,
  pick,
  pickId,
  pickText,
  type Dict,
} from "./_shared";

const SCAN = 500;
const APP_SETTINGS_DOC = "1";
const MAX_PROOFS = 5;
const MAX_PROOF_LEN = 512;

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function asDate(value: unknown): Date | null {
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function pickOptionalNumber(data: Dict, ...names: string[]): number | null {
  return numberOrNull(pick(data, ...names));
}

function zoneTypeOf(value: unknown): ZoneGeometryType {
  return value === "circle" ? "circle" : "polygon";
}

function freezeActive(driver: Dict, at: Date): boolean {
  const from = asDate(driver["frozen_from"]);
  const until = asDate(driver["frozen_until"]);
  if (from && at < from) return false;
  if (until && at > until) return false;
  return Boolean(from || until);
}

export function normalizeExternalOrderId(raw: string | null | undefined): string {
  return (raw ?? "").trim().replace(/^#+|#+$/g, "").toLowerCase();
}

export function assertExternalOrderId(raw: string | null | undefined): string | null {
  const id = (raw ?? "").trim().replace(/^#+|#+$/g, "");
  if (!id) return null;
  if (!/^[0-9]{1,32}$/.test(id)) {
    throw riderError("invalid-argument", "invalid_order_id");
  }
  return id;
}

function parseProofList(items: unknown[]): string[] {
  const out: string[] = [];
  for (const item of items) {
    const elem = typeof item === "string" ? item.trim() : "";
    if (!elem) continue;
    if (elem.includes("..") || elem.length > MAX_PROOF_LEN) {
      throw riderError("invalid-argument", "invalid_proof_keys");
    }
    if (!out.includes(elem)) out.push(elem);
  }
  if (out.length > MAX_PROOFS) {
    throw riderError("invalid-argument", "too_many_proofs");
  }
  return out;
}

/** `_delivery_parse_proof_keys` — scalar key or JSON array, max 5. */
export function parseProofKeys(raw: unknown): string[] {
  if (raw == null || raw === "") return [];
  if (Array.isArray(raw)) return parseProofList(raw);
  if (typeof raw !== "string") {
    throw riderError("invalid-argument", "invalid_proof_keys");
  }
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw riderError("invalid-argument", "invalid_proof_keys");
    }
    if (!Array.isArray(parsed)) {
      throw riderError("invalid-argument", "invalid_proof_keys");
    }
    return parseProofList(parsed);
  }
  if (trimmed.includes("..") || trimmed.length > MAX_PROOF_LEN) {
    throw riderError("invalid-argument", "invalid_proof_keys");
  }
  return [trimmed];
}

/** `_driver_restaurant_delivery_allowed`. */
export function restaurantDeliveryAllowed(args: {
  lat: number;
  lng: number;
  restaurant: Dict;
  geofences: Dict[];
  proximityMeters: number;
}): boolean {
  const { lat, lng, restaurant, geofences, proximityMeters } = args;
  const contains = (fence: Dict) =>
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

  const pinLat = numberOrNull(restaurant["latitude"]);
  const pinLng = numberOrNull(restaurant["longitude"]);
  if (pinLat === null || pinLng === null) return false;
  return haversineMeters(lat, lng, pinLat, pinLng) <= Math.max(proximityMeters, 0);
}

/** `driver_resolve_pickup_restaurant` after published candidates are loaded. */
export function resolvePickupRestaurantId(args: {
  candidates: Array<{ id: string; restaurant: Dict; geofences: Dict[] }>;
  lat: number | null;
  lng: number | null;
  proximityMeters: number;
}): string | null {
  if (args.candidates.length === 1) return args.candidates[0].id;
  if (args.candidates.length === 0 || args.lat === null || args.lng === null) return null;

  const lat = args.lat;
  const lng = args.lng;
  const ranked = args.candidates
    .map((candidate) => {
      const pinLat = numberOrNull(candidate.restaurant["latitude"]);
      const pinLng = numberOrNull(candidate.restaurant["longitude"]);
      const distance =
        pinLat === null || pinLng === null ? null : haversineMeters(lat, lng, pinLat, pinLng);
      return { ...candidate, distance };
    })
    .sort((a, b) => {
      if (a.distance === null && b.distance === null) return 0;
      if (a.distance === null) return 1;
      if (b.distance === null) return -1;
      return a.distance - b.distance;
    });

  const allowed = ranked.find((candidate) =>
    restaurantDeliveryAllowed({
      lat,
      lng,
      restaurant: candidate.restaurant,
      geofences: candidate.geofences,
      proximityMeters: args.proximityMeters,
    }),
  );
  if (allowed) return allowed.id;
  return ranked.find((candidate) => candidate.distance !== null)?.id ?? null;
}

/** `driver_is_within_delivery_range`. */
export function isWithinDeliveryRange(args: {
  lat: number;
  lng: number;
  proximityMeters: number;
  zone: { geometry: unknown; zone_type: unknown } | null;
  restaurants: Array<{ restaurant: Dict; geofences: Dict[] }>;
}): boolean {
  if (args.proximityMeters <= 0) return true;
  if (
    args.zone &&
    pointWithinZoneProximity(
      args.lat,
      args.lng,
      args.zone.geometry as ZoneFeature,
      zoneTypeOf(args.zone.zone_type),
      args.proximityMeters,
    )
  ) {
    return true;
  }
  return args.restaurants.some((row) =>
    restaurantDeliveryAllowed({
      lat: args.lat,
      lng: args.lng,
      restaurant: row.restaurant,
      geofences: row.geofences,
      proximityMeters: args.proximityMeters,
    }),
  );
}

export async function loadProximitySettings(): Promise<{
  proximityMeters: number;
  minIntervalSeconds: number;
}> {
  const snap = await getFirestore().collection(COLLECTIONS.appSettings).doc(APP_SETTINGS_DOC).get();
  const data = (snap.data() ?? {}) as Dict;
  return {
    proximityMeters: numberOrNull(data["driver_app_delivery_proximity_meters"]) ?? 500,
    minIntervalSeconds: numberOrNull(data["driver_location_rpc_min_interval_seconds"]) ?? 15,
  };
}

export async function loadAssignedRestaurantContext(
  driverId: string,
  driver: Dict,
): Promise<Array<{ id: string; data: Dict; geofences: Dict[] }>> {
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
  const list = [...ids];
  if (list.length === 0) return [];

  const restaurants = await loadDocMap(COLLECTIONS.restaurants, list);
  const fences = new Map<string, Dict[]>();
  const db = getFirestore();
  for (const group of chunk(list, IN_FILTER_LIMIT)) {
    const snap = await db
      .collection(COLLECTIONS.restaurantGeofences)
      .where("restaurant_id", "in", group)
      .get();
    for (const doc of snap.docs) {
      const data = (doc.data() ?? {}) as Dict;
      const restaurantId = asString(data["restaurant_id"]);
      if (!restaurantId) continue;
      fences.set(restaurantId, [...(fences.get(restaurantId) ?? []), { id: doc.id, ...data }]);
    }
  }

  return list
    .filter((id) => restaurants.has(id))
    .map((id) => ({
      id,
      data: restaurants.get(id) as Dict,
      geofences: fences.get(id) ?? [],
    }));
}

export async function loadDriverZone(
  zoneId: string | null,
): Promise<{ geometry: unknown; zone_type: unknown } | null> {
  if (!zoneId) return null;
  const snap = await getFirestore().collection(COLLECTIONS.zones).doc(zoneId).get();
  if (!snap.exists) return null;
  const data = (snap.data() ?? {}) as Dict;
  return { geometry: data["geometry"], zone_type: data["zone_type"] };
}

function publishedCandidates(
  assigned: Array<{ id: string; data: Dict; geofences: Dict[] }>,
  partnerId: string | null,
): Array<{ id: string; restaurant: Dict; geofences: Dict[] }> {
  return assigned
    .filter((row) => {
      if (row.data["status"] !== "published" || row.data["is_active"] !== true) return false;
      if (partnerId === null) return true;
      return asString(row.data["partner_id"]) === partnerId;
    })
    .map((row) => ({ id: row.id, restaurant: row.data, geofences: row.geofences }));
}

function assertActiveOnDuty(driver: Dict, now: Date): void {
  if (driver["archived_at"] != null) {
    throw riderError("failed-precondition", "driver_archived");
  }
  if (asString(driver["status"]) !== "active") {
    throw riderError("failed-precondition", "driver_not_active");
  }
  if (freezeActive(driver, now)) {
    throw riderError("failed-precondition", "driver_blocked");
  }
  if (driver["is_on_duty"] !== true) {
    throw riderError("failed-precondition", "driver_off_duty");
  }
}

async function assertDeviceMatch(uid: string, driver: Dict, deviceId: string | null): Promise<void> {
  const active = asString(driver["active_device_id"]);
  if (!active) return;
  if (!deviceId) {
    throw riderError("failed-precondition", "device_id_required");
  }
  if (active === deviceId) return;

  const snap = await getFirestore()
    .collection(COLLECTIONS.driverDeviceSessions)
    .where("driver_id", "==", uid)
    .where("device_id", "==", deviceId)
    .limit(20)
    .get();
  const nowMs = Date.now();
  for (const doc of snap.docs) {
    const data = (doc.data() ?? {}) as Dict;
    if (data["revoked_reason"] !== "override" || data["flushed_at"] != null) continue;
    const deadline = asDate(data["flush_deadline_at"]);
    if (deadline && nowMs < deadline.getTime()) return;
  }
  throw riderError("failed-precondition", "device_revoked");
}

function serializeDelivery(id: string, raw: Dict): Dict {
  const proofUrls = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  return {
    id,
    driver_id: asString(raw["driver_id"]),
    partner_id: asString(raw["partner_id"]),
    zone_id: asString(raw["zone_id"]),
    restaurant_id: asString(raw["restaurant_id"]),
    external_order_id: typeof raw["external_order_id"] === "string" ? raw["external_order_id"] : null,
    status: asString(raw["status"]),
    pickup_at: isoTimestamp(raw["pickup_at"]),
    pickup_lat: numberOrNull(raw["pickup_lat"]),
    pickup_lng: numberOrNull(raw["pickup_lng"]),
    pickup_proof_url: asString(raw["pickup_proof_url"]),
    pickup_proof_urls: proofUrls(raw["pickup_proof_urls"]),
    delivered_at: isoTimestamp(raw["delivered_at"]),
    delivered_lat: numberOrNull(raw["delivered_lat"]),
    delivered_lng: numberOrNull(raw["delivered_lng"]),
    order_proof_url: asString(raw["order_proof_url"]),
    order_proof_urls: proofUrls(raw["order_proof_urls"]),
    cancelled_at: isoTimestamp(raw["cancelled_at"]),
    cancel_lat: numberOrNull(raw["cancel_lat"]),
    cancel_lng: numberOrNull(raw["cancel_lng"]),
    cancel_reason: asString(raw["cancel_reason"]),
    cancel_proof_url: asString(raw["cancel_proof_url"]),
    cancel_proof_urls: proofUrls(raw["cancel_proof_urls"]),
    rejection_reason: asString(raw["rejection_reason"]),
    shift_date: typeof raw["shift_date"] === "string" ? raw["shift_date"].slice(0, 10) : null,
    created_at: isoTimestamp(raw["created_at"]),
    updated_at: isoTimestamp(raw["updated_at"]),
  };
}

async function resolveShiftDate(driverId: string, now: Date): Promise<string> {
  const shift = await findActiveShift(driverId, now);
  return shift?.shift_date ?? kuwaitDayString(now);
}

async function findActivePickup(
  driverId: string,
): Promise<{ id: string; data: Dict } | null> {
  const snap = await getFirestore()
    .collection(COLLECTIONS.deliveries)
    .where("driver_id", "==", driverId)
    .where("status", "==", "in_transit")
    .limit(20)
    .get();
  let best: { id: string; data: Dict } | null = null;
  let bestAt = -1;
  for (const doc of snap.docs) {
    const data = (doc.data() ?? {}) as Dict;
    const at =
      asDate(data["pickup_at"])?.getTime() ??
      asDate(data["created_at"])?.getTime() ??
      0;
    if (at >= bestAt) {
      bestAt = at;
      best = { id: doc.id, data };
    }
  }
  return best;
}

export const driverGetActivePickup = onCall(async (request) => {
  const ctx = await requireRider(request);
  const row = await findActivePickup(ctx.uid);
  if (!row) return null;
  return serializeDelivery(row.id, row.data);
});

export const driverCreatePickup = onCall(async (request) => {
  const ctx = await requireRider(request);
  const data = (request.data ?? {}) as Dict;
  const now = new Date();
  const stamp = Timestamp.fromDate(now);
  const today = kuwaitDayString(now);

  assertActiveOnDuty(ctx.driver, now);
  await assertDeviceMatch(ctx.uid, ctx.driver, pickText(data, "p_device_id", "device_id", "deviceId"));

  const active = await findActivePickup(ctx.uid);
  if (active) {
    throw riderError("failed-precondition", "active_pickup_exists");
  }

  const orderId = assertExternalOrderId(
    pickText(data, "p_external_order_id", "external_order_id", "externalOrderId"),
  );
  const lat = pickOptionalNumber(data, "p_pickup_lat", "pickup_lat", "pickupLat");
  const lng = pickOptionalNumber(data, "p_pickup_lng", "pickup_lng", "pickupLng");
  if (lat === null || lng === null) {
    throw riderError("invalid-argument", "location_required");
  }

  const proofKeys = parseProofKeys(pick(data, "p_order_proof_url", "order_proof_url", "orderProofUrl"));
  const settings = await loadProximitySettings();
  const assigned = await loadAssignedRestaurantContext(ctx.uid, ctx.driver);
  const zone = await loadDriverZone(asString(ctx.driver["zone_id"]));

  if (
    settings.proximityMeters > 0 &&
    !isWithinDeliveryRange({
      lat,
      lng,
      proximityMeters: settings.proximityMeters,
      zone,
      restaurants: assigned.map((row) => ({ restaurant: row.data, geofences: row.geofences })),
    })
  ) {
    throw riderError("failed-precondition", "delivery_out_of_range");
  }

  const restaurantId = resolvePickupRestaurantId({
    candidates: publishedCandidates(assigned, asString(ctx.driver["partner_id"])),
    lat,
    lng,
    proximityMeters: settings.proximityMeters,
  });
  const normalized = normalizeExternalOrderId(orderId);

  if (normalized && restaurantId) {
    const dups = await getFirestore()
      .collection(COLLECTIONS.deliveries)
      .where("restaurant_id", "==", restaurantId)
      .where("pickup_day", "==", today)
      .limit(SCAN)
      .get();
    const taken = dups.docs.some((doc) => {
      const row = (doc.data() ?? {}) as Dict;
      if (row["status"] === "cancelled") return false;
      return normalizeExternalOrderId(asString(row["external_order_id"])) === normalized;
    });
    if (taken) {
      throw riderError("already-exists", "duplicate_order_id");
    }
  }

  const shiftDate = await resolveShiftDate(ctx.uid, now);
  const id = randomUUID();
  const row: Dict = {
    driver_id: ctx.uid,
    partner_id: asString(ctx.driver["partner_id"]),
    zone_id: asString(ctx.driver["zone_id"]),
    restaurant_id: restaurantId,
    external_order_id: orderId,
    pickup_proof_url: proofKeys[0] ?? null,
    pickup_proof_urls: proofKeys,
    status: "in_transit",
    pickup_at: stamp,
    pickup_lat: lat,
    pickup_lng: lng,
    pickup_day: today,
    created_day: today,
    shift_date: shiftDate,
    created_at: stamp,
    updated_at: stamp,
  };

  await getFirestore().collection(COLLECTIONS.deliveries).doc(id).set(row);
  await logDriverOperation({
    driverId: ctx.uid,
    module: "delivery",
    action: "delivery.pickup_create",
    actor: "driver_create_pickup",
    success: true,
    recordType: "delivery",
    recordId: id,
    detail: {
      order_id: orderId,
      restaurant_id: restaurantId,
      partner_id: row["partner_id"],
      proof_count: proofKeys.length,
    },
  });
  return serializeDelivery(id, row);
});

export const driverCompleteDelivery = onCall(async (request) => {
  const ctx = await requireRider(request);
  const data = (request.data ?? {}) as Dict;
  const now = new Date();
  const stamp = Timestamp.fromDate(now);

  assertActiveOnDuty(ctx.driver, now);
  await assertDeviceMatch(ctx.uid, ctx.driver, pickText(data, "p_device_id", "device_id", "deviceId"));

  const deliveryId = pickId(data, "p_delivery_id", "delivery_id", "deliveryId");
  if (!deliveryId) {
    throw riderError("invalid-argument", "delivery_id_required");
  }
  const lat = pickOptionalNumber(data, "p_delivered_lat", "delivered_lat", "deliveredLat");
  const lng = pickOptionalNumber(data, "p_delivered_lng", "delivered_lng", "deliveredLng");
  if (lat === null || lng === null) {
    throw riderError("invalid-argument", "location_required");
  }

  const snap = await getFirestore().collection(COLLECTIONS.deliveries).doc(deliveryId).get();
  if (!snap.exists || asString((snap.data() ?? {})["driver_id"]) !== ctx.uid) {
    throw riderError("not-found", "delivery_not_found");
  }
  const current = (snap.data() ?? {}) as Dict;
  const status = asString(current["status"]);
  if (status === "pending") {
    const retryDay = asString(current["shift_date"]) ?? asString(current["delivered_day"]);
    if (retryDay && /^\d{4}-\d{2}-\d{2}$/.test(retryDay)) {
      await applyDeliveryRollup(getFirestore(), {
        deliveryId,
        driverId: ctx.uid,
        zoneId: asString(current["zone_id"]) ?? asString(ctx.driver.zone_id),
        day: retryDay,
        status: "pending",
      });
    }
    return serializeDelivery(snap.id, current);
  }
  if (status === "verified") {
    return serializeDelivery(snap.id, current);
  }
  if (status !== "in_transit") {
    throw riderError("failed-precondition", "invalid_delivery_status");
  }

  const proofKeys = parseProofKeys(
    pick(data, "p_delivery_proof_url", "delivery_proof_url", "deliveryProofUrl"),
  );
  const shiftDate = await resolveShiftDate(ctx.uid, now);
  const patch: Dict = {
    order_proof_url: proofKeys[0] ?? null,
    order_proof_urls: proofKeys,
    delivered_at: stamp,
    delivered_lat: lat,
    delivered_lng: lng,
    delivered_day: kuwaitDayString(now),
    status: "pending",
    shift_date: shiftDate,
    updated_at: stamp,
  };
  await snap.ref.set(patch, { merge: true });
  await applyDeliveryRollup(getFirestore(), {
    deliveryId,
    driverId: ctx.uid,
    zoneId: asString(current["zone_id"]) ?? asString(ctx.driver.zone_id),
    day: shiftDate,
    status: "pending",
  });
  await logDriverOperation({
    driverId: ctx.uid,
    module: "delivery",
    action: "delivery.complete",
    actor: "driver_complete_delivery",
    success: true,
    recordType: "delivery",
    recordId: deliveryId,
    detail: {
      order_id: current["external_order_id"] ?? null,
      restaurant_id: current["restaurant_id"] ?? null,
      proof_count: proofKeys.length,
    },
  });
  return serializeDelivery(deliveryId, { ...current, ...patch });
});

export const driverCancelDelivery = onCall(async (request) => {
  const ctx = await requireRider(request);
  const data = (request.data ?? {}) as Dict;
  const now = new Date();
  const stamp = Timestamp.fromDate(now);

  assertActiveOnDuty(ctx.driver, now);
  await assertDeviceMatch(ctx.uid, ctx.driver, pickText(data, "p_device_id", "device_id", "deviceId"));

  const deliveryId = pickId(data, "p_delivery_id", "delivery_id", "deliveryId");
  if (!deliveryId) {
    throw riderError("invalid-argument", "delivery_id_required");
  }
  const reason = pickText(data, "p_cancel_reason", "cancel_reason", "cancelReason");
  if (!reason) {
    throw riderError("invalid-argument", "cancel_reason_required");
  }
  const lat = pickOptionalNumber(data, "p_cancel_lat", "cancel_lat", "cancelLat");
  const lng = pickOptionalNumber(data, "p_cancel_lng", "cancel_lng", "cancelLng");
  if (lat === null || lng === null) {
    throw riderError("invalid-argument", "location_required");
  }

  const snap = await getFirestore().collection(COLLECTIONS.deliveries).doc(deliveryId).get();
  if (!snap.exists || asString((snap.data() ?? {})["driver_id"]) !== ctx.uid) {
    throw riderError("not-found", "delivery_not_found");
  }
  const current = (snap.data() ?? {}) as Dict;
  const status = asString(current["status"]);
  if (status === "cancelled") {
    return serializeDelivery(snap.id, current);
  }
  if (status !== "in_transit") {
    throw riderError("failed-precondition", "invalid_delivery_status");
  }

  const proofKeys = parseProofKeys(pick(data, "p_cancel_proof_url", "cancel_proof_url", "cancelProofUrl"));
  const patch: Dict = {
    cancel_reason: reason,
    cancel_proof_url: proofKeys[0] ?? null,
    cancel_proof_urls: proofKeys,
    cancelled_at: stamp,
    cancel_lat: lat,
    cancel_lng: lng,
    status: "cancelled",
    updated_at: stamp,
  };
  await snap.ref.set(patch, { merge: true });
  await logDriverOperation({
    driverId: ctx.uid,
    module: "delivery",
    action: "delivery.cancel",
    actor: "driver_cancel_delivery",
    success: true,
    recordType: "delivery",
    recordId: deliveryId,
    detail: {
      order_id: current["external_order_id"] ?? null,
      cancel_reason: reason,
      proof_count: proofKeys.length,
    },
  });
  return serializeDelivery(deliveryId, { ...current, ...patch });
});

export const driverGetDeliveryProximityContext = onCall(async (request) => {
  const ctx = await requireRider(request);
  const settings = await loadProximitySettings();
  const zoneId = asString(ctx.driver["zone_id"]);
  const [zoneSnap, assigned] = await Promise.all([
    zoneId ? getFirestore().collection(COLLECTIONS.zones).doc(zoneId).get() : Promise.resolve(null),
    loadAssignedRestaurantContext(ctx.uid, ctx.driver),
  ]);
  const zoneData = zoneSnap?.exists ? ((zoneSnap.data() ?? {}) as Dict) : null;

  const restaurants = assigned
    .slice()
    .sort((a, b) => asString(a.data["name"])?.localeCompare(asString(b.data["name"]) ?? "") ?? 0)
    .map((row) => ({
      id: row.id,
      name: asString(row.data["name"]),
      latitude: numberOrNull(row.data["latitude"]),
      longitude: numberOrNull(row.data["longitude"]),
      geofences: row.geofences
        .slice()
        .sort((a, b) => (asDate(a["created_at"])?.getTime() ?? 0) - (asDate(b["created_at"])?.getTime() ?? 0))
        .map((fence) => ({
          id: asString(fence["id"]),
          kind: asString(fence["kind"]),
          zone_type: asString(fence["zone_type"]),
          geometry: fence["geometry"] ?? null,
          name: asString(fence["name"]),
          color: asString(fence["color"]),
        })),
    }));

  return {
    proximity_meters: settings.proximityMeters,
    zone_id: zoneId,
    zone_type: zoneData ? asString(zoneData["zone_type"]) : null,
    zone_geometry: zoneData ? (zoneData["geometry"] ?? null) : null,
    restaurants,
  };
});
