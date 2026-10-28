import { randomUUID } from "crypto";
import { onCall } from "firebase-functions/v2/https";
import { Timestamp, getFirestore } from "../core/fs";
import { COLLECTIONS } from "../core/collections";
import { kuwaitDayString } from "../core/kuwait";
import { applyDeliveryRollup } from "../core/rollups";
import { stampStoredRow } from "../core/search-text";
import { requireRider, riderError } from "../core/rider";
import {
  haversineMeters,
  pointWithinZoneProximity,
  type ZoneFeature,
} from "../core/geo";
import { restaurantAllowed, restaurantReachableForPartner, zoneTypeOf } from "../core/restaurant-proximity";
import {
  evaluateDeliveryZone,
  flagLabelsFor,
  evaluateRosterEarlyDrop,
  isEarlyDrop,
  normalizeOrderIdForProof,
  orderIdsMatch,
  proofOcrDecision,
  type ProofOcrMode,
} from "../core/delivery-flags";
import { driverRestaurantIds } from "./deliveries-shared";
import { findActiveShift } from "./driver-shift";
import { invalidateDriverHomeDailySafe } from "./driver-home";
import { syncBitesOrderMilestone, type BitesPartnerStamp } from "./bites-order-sync";
import { BITES_DELIVERY_FIELDS, BITES_ORDER_STATUS } from "../core/bites";
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

function deliveryIdentityStamp(
  driver: Record<string, unknown>,
  profile: Record<string, unknown>,
  orderId: unknown,
): Record<string, string> {
  return stampStoredRow("deliveries", {
    external_order_id: orderId,
    driver_name: asString(profile["full_name"]) ?? asString(driver["full_name"]) ?? asString(driver["name"]),
    driver_code: driver.driver_code,
    employee_id: driver.employee_id,
  });
}

/**
 * The rider identity the Bites order carries.
 *
 * The customer app runs on the Bites project and cannot resolve a delivery-side
 * `users` reference, so the order stores the name and phone inline.
 */
function bitesPartnerStamp(
  uid: string,
  driver: Record<string, unknown>,
  profile: Record<string, unknown>,
): BitesPartnerStamp {
  return {
    uid,
    name:
      asString(profile["full_name"]) ??
      asString(driver["full_name"]) ??
      asString(driver["name"]),
    phone:
      asString(profile["phone"]) ??
      asString(driver["phone"]) ??
      asString(driver["driver_phone"]),
  };
}

async function touchDeliveryStatusRollup(input: {
  deliveryId: string;
  driverId: string;
  zoneId: string | null;
  day: string | null;
  status: string;
}): Promise<void> {
  if (!input.day || !/^\d{4}-\d{2}-\d{2}$/.test(input.day)) return;
  await applyDeliveryRollup(getFirestore(), {
    deliveryId: input.deliveryId,
    driverId: input.driverId,
    zoneId: input.zoneId,
    day: input.day,
    status: input.status,
  });
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

function freezeActive(driver: Dict, at: Date): boolean {
  const from = asDate(driver["frozen_from"]);
  const until = asDate(driver["frozen_until"]);
  if (from && at < from) return false;
  if (until && at > until) return false;
  return Boolean(from || until);
}

/**
 * A leading Bites app prefix, stripped before validation.
 *
 * Orders used to be allocated as `ORDBTS` + a counter. An order printed before that
 * changed can still be handled: the prefix is dropped so the stored id is the digits
 * alone, which is what the Bites order carries and what the duplicate check compares.
 * A bare `ORDBTS` with nothing after it is not a prefix, so it still fails validation.
 */
const BITES_ORDER_PREFIX = /^ORDBTS(?=[0-9])/i;

export function normalizeExternalOrderId(raw: string | null | undefined): string {
  return (raw ?? "")
    .trim()
    .replace(/^#+|#+$/g, "")
    .replace(BITES_ORDER_PREFIX, "")
    .toLowerCase();
}

export function assertExternalOrderId(raw: string | null | undefined): string | null {
  const id = (raw ?? "")
    .trim()
    .replace(/^#+|#+$/g, "")
    .replace(BITES_ORDER_PREFIX, "");
  if (!id) return null;
  // Digits only: the id is the key the Bites order is matched by, so it has to be
  // exactly what Bites allocated rather than a rider's transcription of it.
  if (!/^[0-9]{1,32}$/.test(id)) {
    throw riderError("invalid-argument", "invalid_order_id");
  }
  return id;
}

/**
 * Every exact value a stored `external_order_id` could hold for this id.
 *
 * `external_order_id` keeps whatever the rider was allowed to type, and Firestore
 * cannot compare case-insensitively. The digits form is what the app produces now;
 * the `ORDBTS` form is what an order handled before the prefix was dropped holds,
 * and the app always spelled it in capitals. The `#` a printed docket carries never
 * reaches a stored value: `assertExternalOrderId` strips it.
 */
export function orderIdSpellings(orderId: string): string[] {
  const out: string[] = [orderId];
  const legacy = `ORDBTS${orderId}`;
  if (!out.includes(legacy)) out.push(legacy);
  return out;
}

/**
 * The Kuwait day a pickup row was logged on.
 *
 * `pickup_day` is stamped at create. `created_day` covers a row written before
 * that field, and `pickup_at` the row whose day fields were never written. A row
 * with no readable day returns null, which never matches — an unreadable legacy
 * row must not block today's pickup forever.
 */
export function deliveryPickupDay(row: Dict): string | null {
  for (const key of ["pickup_day", "created_day"]) {
    const value = asString(row[key]);
    if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  }
  const at = row["pickup_at"];
  if (at instanceof Timestamp) return kuwaitDayString(at.toDate());
  if (at instanceof Date) return kuwaitDayString(at);
  const shift = asString(row["shift_date"]);
  return shift && /^\d{4}-\d{2}-\d{2}$/.test(shift) ? shift : null;
}

/**
 * The one case the order-id rule refuses: the same store already holds this id
 * on the same Kuwait day, and that row is not cancelled.
 *
 * A different store or a later day may reuse the number, because restaurants
 * restart their order numbering. The id is compared normalized so a stored
 * `ORDBTS` spelling is the same order as the digits form.
 *
 * When this pickup resolved no store, only a row that also has no store can
 * collide — guessing a store would block an unrelated restaurant.
 */
export function isScopedDuplicate(
  row: Dict,
  args: { normalized: string; restaurantId: string | null; day: string },
): boolean {
  if (asString(row["status"]) === "cancelled") return false;
  const stored = normalizeExternalOrderId(asString(row["external_order_id"]));
  if (stored !== args.normalized) return false;
  const rowRestaurant = asString(row["restaurant_id"]);
  if (rowRestaurant !== args.restaurantId) return false;
  return deliveryPickupDay(row) === args.day;
}

/**
 * Refuses an order id this store already holds for the same Kuwait day.
 *
 * The scope is `restaurant_id` + pickup day, matching the rule ops confirmed:
 * a printed docket number may repeat at another store or on a later day, so
 * only a same-store same-day row (not cancelled) is a duplicate. A cancelled
 * row does not count, so re-attempting a delivery that fell through still works.
 *
 * The query itself stays on `external_order_id` alone — the automatic
 * single-field index answers it — and the store and day are compared here.
 */
async function assertOrderIdUnused(
  orderId: string | null | undefined,
  restaurantId: string | null,
  day: string,
): Promise<void> {
  const normalized = normalizeExternalOrderId(orderId);
  if (!normalized || !orderId) return;
  const db = getFirestore();
  for (const spelling of orderIdSpellings(orderId)) {
    const snap = await db
      .collection(COLLECTIONS.deliveries)
      .where("external_order_id", "==", spelling)
      .limit(SCAN)
      .get();
    const taken = snap.docs.some((doc) =>
      isScopedDuplicate((doc.data() ?? {}) as Dict, { normalized, restaurantId, day }),
    );
    if (taken) {
      throw riderError("already-exists", "duplicate_order_id");
    }
  }
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
  return restaurantAllowed(args);
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

export type DeliveryProximitySettings = {
  proximityMeters: number;
  minIntervalSeconds: number;
  earlyDropMeters: number;
  earlyDropMinMinutes: number;
  earlyDropRestaurantMeters: number;
  earlyDropMissingProof: boolean;
  proofOcrMode: ProofOcrMode;
};

export async function loadProximitySettings(): Promise<DeliveryProximitySettings> {
  const snap = await getFirestore().collection(COLLECTIONS.appSettings).doc(APP_SETTINGS_DOC).get();
  const data = (snap.data() ?? {}) as Dict;
  const earlyDrop = numberOrNull(data["driver_app_early_drop_meters"]);
  return {
    proximityMeters: numberOrNull(data["driver_app_delivery_proximity_meters"]) ?? 500,
    minIntervalSeconds: numberOrNull(data["driver_location_rpc_min_interval_seconds"]) ?? 15,
    earlyDropMeters: earlyDrop !== null && earlyDrop >= 0 ? earlyDrop : 50,
    earlyDropMinMinutes: numberOrNull(data["roster_early_drop_min_minutes"]) ?? 4,
    earlyDropRestaurantMeters: numberOrNull(data["roster_early_drop_restaurant_meters"]) ?? 200,
    earlyDropMissingProof: data["roster_early_drop_missing_proof"] !== false,
    proofOcrMode: (() => {
      const mode = data["driver_app_proof_ocr_mode"];
      return mode === "warn" || mode === "off" || mode === "block" ? mode : "block";
    })(),
  };
}

/**
 * The rules block the rider sees before and during a delivery. It is deliberately
 * a snapshot of the fleet switches plus the rider's zone, not a new rule engine.
 */
export function deliveryRulesPayload(input: {
  settings: Pick<DeliveryProximitySettings, "proximityMeters" | "earlyDropMeters" | "proofOcrMode">;
  zoneId: string | null;
  zoneData: Dict | null;
  driver: Dict;
}): Dict {
  const tiers = input.driver["dpd_rule_tiers"];
  return {
    early_drop_meters: input.settings.earlyDropMeters,
    proof_ocr_mode: input.settings.proofOcrMode,
    proximity_meters: input.settings.proximityMeters,
    required_zone: input.zoneData
      ? { id: input.zoneId, name: asString(input.zoneData["name"]) }
      : null,
    dpd_target: numberOrNull(input.driver["dpd_target"]),
    rule_name: asString(input.driver["dpd_rule_name"]),
    rule_tiers: Array.isArray(tiers) ? tiers : [],
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

export function assertPublishedPickupRestaurant(candidates: Array<{ id: string }>): void {
  if (candidates.length === 0) {
    throw riderError("failed-precondition", "no_restaurants_assigned");
  }
}

/**
 * A published restaurant still has to be in range. With none, the rider's own
 * zone is enough when the fix is inside it. No zone and no restaurant stays
 * `no_restaurants_assigned`.
 */
export function pickupAssignmentGate(args: {
  hasPublishedRestaurant: boolean;
  hasZoneShape: boolean;
  inRange: boolean;
}): "ok" | "no_restaurants_assigned" | "delivery_out_of_range" {
  if (args.hasPublishedRestaurant) {
    return args.inRange ? "ok" : "delivery_out_of_range";
  }
  if (!args.hasZoneShape) return "no_restaurants_assigned";
  return args.inRange ? "ok" : "delivery_out_of_range";
}

function publishedCandidates(
  assigned: Array<{ id: string; data: Dict; geofences: Dict[] }>,
  partnerId: string | null,
): Array<{ id: string; restaurant: Dict; geofences: Dict[] }> {
  return assigned
    .filter((row) => {
      if (row.data["status"] !== "published" || row.data["is_active"] !== true) return false;
      // Shared helper with the clock-in gate: a restaurant with no partner is
      // fleet-wide catalogue and stays reachable for a partner-scoped rider.
      return restaurantReachableForPartner(row.data, partnerId);
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
    is_early_drop: typeof raw["is_early_drop"] === "boolean" ? raw["is_early_drop"] : null,
    pickup_delivery_distance_m: numberOrNull(raw["pickup_delivery_distance_m"]),
    is_out_of_zone: typeof raw["is_out_of_zone"] === "boolean" ? raw["is_out_of_zone"] : null,
    delivery_zone_id: asString(raw["delivery_zone_id"]),
    zone_distance_m: numberOrNull(raw["zone_distance_m"]),
    flag_labels: Array.isArray(raw["flag_labels"])
      ? (raw["flag_labels"] as unknown[]).filter((item): item is string => typeof item === "string")
      : [],
    order_proof_ocr_order_id: asString(raw["order_proof_ocr_order_id"]),
    order_proof_ocr_matched:
      typeof raw["order_proof_ocr_matched"] === "boolean" ? raw["order_proof_ocr_matched"] : null,
    order_proof_ocr_confidence: numberOrNull(raw["order_proof_ocr_confidence"]),
    order_proof_ocr_override_reason: asString(raw["order_proof_ocr_override_reason"]),
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

async function pinIsMocked(driverId: string): Promise<boolean> {
  try {
    const snap = await getFirestore().collection(COLLECTIONS.driverLocations).doc(driverId).get();
    return (snap.data() ?? {})["is_mocked"] === true;
  } catch {
    return false;
  }
}

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
  const candidates = publishedCandidates(assigned, asString(ctx.driver["partner_id"]));
  const zone = await loadDriverZone(asString(ctx.driver["zone_id"]));
  const inRange =
    settings.proximityMeters <= 0 ||
    isWithinDeliveryRange({
      lat,
      lng,
      proximityMeters: settings.proximityMeters,
      zone,
      restaurants: assigned.map((row) => ({ restaurant: row.data, geofences: row.geofences })),
    });
  const gate = pickupAssignmentGate({
    hasPublishedRestaurant: candidates.length > 0,
    hasZoneShape: zone?.geometry != null,
    inRange,
  });
  if (gate !== "ok") {
    throw riderError("failed-precondition", gate);
  }

  const restaurantId = resolvePickupRestaurantId({
    candidates,
    lat,
    lng,
    proximityMeters: settings.proximityMeters,
  });
  await assertOrderIdUnused(orderId, restaurantId, today);

  const [shiftDate, mocked] = await Promise.all([resolveShiftDate(ctx.uid, now), pinIsMocked(ctx.uid)]);
  const id = randomUUID();
  const row: Dict = {
    driver_id: ctx.uid,
    partner_id: asString(ctx.driver["partner_id"]),
    zone_id:
      asString(candidates.find((candidate) => candidate.id === restaurantId)?.restaurant["zone_id"]) ??
      asString(ctx.driver["zone_id"]),
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
    gps_is_mocked: mocked,
    created_at: stamp,
    updated_at: stamp,
    ...deliveryIdentityStamp(ctx.driver, ctx.profile, orderId),
  };

  await getFirestore().collection(COLLECTIONS.deliveries).doc(id).set(row);
  await touchDeliveryStatusRollup({
    deliveryId: id,
    driverId: ctx.uid,
    zoneId: asString(ctx.driver["zone_id"]),
    day: shiftDate,
    status: "in_transit",
  });
  const bites = await syncBitesOrderMilestone(orderId, {
    status: BITES_ORDER_STATUS.picked,
    timeField: BITES_DELIVERY_FIELDS.pickupTime,
    at: now,
    partner: bitesPartnerStamp(ctx.uid, ctx.driver, ctx.profile),
  });
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
      bites_synced: bites.synced,
      bites_sync_reason: bites.reason,
    },
  });
  // A pickup moves the week's delivery count, so the snapshot is invalidated the
  // moment this commits. The flag is one write; the rider's next Home call
  // recomputes the count it has to show anyway.
  await invalidateDriverHomeDailySafe(ctx.uid, "pickup", { signal: false });
  return {
    ...serializeDelivery(id, row),
    rules: deliveryRulesPayload({
      settings,
      zoneId: asString(ctx.driver["zone_id"]),
      zoneData: zone ? { ...zone, name: null } : null,
      driver: ctx.driver,
    }),
  };
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
    await touchDeliveryStatusRollup({
      deliveryId,
      driverId: ctx.uid,
      zoneId: asString(current["zone_id"]) ?? asString(ctx.driver["zone_id"]),
      day: retryDay,
      status: "pending",
    });
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
  const [shiftDate, mocked, settings] = await Promise.all([
    resolveShiftDate(ctx.uid, now),
    pinIsMocked(ctx.uid),
    loadProximitySettings(),
  ]);

  const pickupLat = numberOrNull(current["pickup_lat"]);
  const pickupLng = numberOrNull(current["pickup_lng"]);
  const pickupDistanceM =
    pickupLat !== null && pickupLng !== null
      ? haversineMeters(pickupLat, pickupLng, lat, lng)
      : null;
  const restaurantId = asString(current["restaurant_id"]);
  const restaurantSnap = restaurantId
    ? await getFirestore().collection(COLLECTIONS.restaurants).doc(restaurantId).get()
    : null;
  const restaurant = (restaurantSnap?.data() ?? {}) as Dict;
  const restaurantLat = numberOrNull(restaurant["latitude"]);
  const restaurantLng = numberOrNull(restaurant["longitude"]);
  const restaurantDistanceM =
    restaurantLat !== null && restaurantLng !== null ? haversineMeters(restaurantLat, restaurantLng, lat, lng) : null;
  const pickupAt = current["pickup_at"];
  const pickupDate =
    pickupAt && typeof pickupAt === "object" && "toDate" in pickupAt
      ? (pickupAt as Timestamp).toDate()
      : null;
  const durationMinutes = pickupDate ? (now.getTime() - pickupDate.getTime()) / 60_000 : null;
  const pickupProofs = current["pickup_proof_urls"];
  const missingPickupProof = !asString(current["pickup_proof_url"]) && !(Array.isArray(pickupProofs) && pickupProofs.length > 0);
  const rosterDrop = evaluateRosterEarlyDrop({
    pickupToDropMeters: pickupDistanceM,
    restaurantToDropMeters: restaurantDistanceM,
    durationMinutes,
    missingPickupProof,
    customerToDropMeters: null,
    nearMeters: settings.earlyDropRestaurantMeters,
    minMinutes: settings.earlyDropMinMinutes,
    customerFarMeters: 500,
    flagMissingProof: settings.earlyDropMissingProof,
  });
  const earlyDrop = isEarlyDrop(pickupDistanceM, settings.earlyDropMeters) || rosterDrop.early;

  const deliveryZoneId = asString(current["zone_id"]) ?? asString(restaurant["zone_id"]);
  const zoneData = deliveryZoneId ? await loadDriverZone(deliveryZoneId) : null;
  const zoneEvaluation = evaluateDeliveryZone(
    lat,
    lng,
    zoneData ? { id: deliveryZoneId, ...zoneData } : null,
  );
  const outOfZone = zoneEvaluation ? !zoneEvaluation.inside : null;

  const ocrOrderId = normalizeOrderIdForProof(
    pickText(data, "p_order_proof_ocr_order_id", "order_proof_ocr_order_id", "ocrOrderId"),
  );
  const ocrMatched = orderIdsMatch(ocrOrderId, asString(current["external_order_id"]));
  const ocrOverrideReason = pickText(
    data,
    "p_order_proof_ocr_override_reason",
    "order_proof_ocr_override_reason",
    "ocrOverrideReason",
  );
  const ocrConfidence = pickOptionalNumber(
    data,
    "p_order_proof_ocr_confidence",
    "order_proof_ocr_confidence",
    "ocrConfidence",
  );
  if (
    proofOcrDecision({
      mode: settings.proofOcrMode,
      matched: ocrMatched,
      overrideReason: ocrOverrideReason,
    }) === "block"
  ) {
    throw riderError("failed-precondition", "proof_order_mismatch");
  }

  const flagLabels = flagLabelsFor({ earlyDrop, outOfZone });
  const patch: Dict = {
    gps_is_mocked: current["gps_is_mocked"] === true || mocked,
    order_proof_url: proofKeys[0] ?? null,
    order_proof_urls: proofKeys,
    delivered_at: stamp,
    delivered_lat: lat,
    delivered_lng: lng,
    delivered_day: kuwaitDayString(now),
    status: "pending",
    shift_date: shiftDate,
    updated_at: stamp,
    is_early_drop: earlyDrop,
    early_drop_reasons: rosterDrop.reasons,
    pickup_delivery_distance_m: pickupDistanceM,
    is_out_of_zone: outOfZone,
    delivery_zone_id: deliveryZoneId,
    zone_distance_m: zoneEvaluation?.distanceM ?? null,
    flag_labels: flagLabels,
    order_proof_ocr_order_id: ocrOrderId,
    order_proof_ocr_matched: ocrMatched,
    order_proof_ocr_confidence: ocrConfidence,
    order_proof_ocr_override_reason: ocrOverrideReason,
    ...deliveryIdentityStamp(ctx.driver, ctx.profile, current["external_order_id"]),
  };
  await snap.ref.set(patch, { merge: true });
  if (earlyDrop) {
    await getFirestore()
      .collection("ops_alerts")
      .doc(`early_drop_${deliveryId}`)
      .set(
        {
          kind: "early_drop",
          driver_id: ctx.uid,
          zone_id: deliveryZoneId,
          restaurant_id: restaurantId,
          delivery_id: deliveryId,
          day: kuwaitDayString(now),
          reasons: rosterDrop.reasons,
          created_at: stamp,
          updated_at: stamp,
        },
        { merge: true },
      );
  }
  const previousDay = asString(current["shift_date"]);
  const zoneId = deliveryZoneId ?? asString(ctx.driver["zone_id"]);
  if (previousDay && shiftDate && previousDay !== shiftDate) {
    await touchDeliveryStatusRollup({
      deliveryId,
      driverId: ctx.uid,
      zoneId,
      day: previousDay,
      status: "",
    });
  }
  await touchDeliveryStatusRollup({
    deliveryId,
    driverId: ctx.uid,
    zoneId,
    day: shiftDate,
    status: "pending",
  });
  const bites = await syncBitesOrderMilestone(asString(current["external_order_id"]), {
    status: BITES_ORDER_STATUS.delivered,
    timeField: BITES_DELIVERY_FIELDS.deliveredTime,
    at: now,
    partner: bitesPartnerStamp(ctx.uid, ctx.driver, ctx.profile),
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
      distance_m: pickupDistanceM,
      early_drop: earlyDrop,
      out_of_zone: outOfZone,
      zone_distance_m: zoneEvaluation?.distanceM ?? null,
      ocr_matched: ocrMatched,
      ocr_order_id: ocrOrderId,
      bites_synced: bites.synced,
      bites_sync_reason: bites.reason,
    },
  });
  await invalidateDriverHomeDailySafe(ctx.uid, "complete", { signal: false });
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
    ...deliveryIdentityStamp(ctx.driver, ctx.profile, current["external_order_id"]),
  };
  await snap.ref.set(patch, { merge: true });
  await touchDeliveryStatusRollup({
    deliveryId,
    driverId: ctx.uid,
    zoneId: asString(current["zone_id"]) ?? asString(ctx.driver["zone_id"]),
    day: asString(current["shift_date"]) ?? asString(current["created_day"]),
    status: "cancelled",
  });
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
  await invalidateDriverHomeDailySafe(ctx.uid, "cancel", { signal: false });
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
    rules: deliveryRulesPayload({
      settings,
      zoneId,
      zoneData,
      driver: ctx.driver,
    }),
  };
});
