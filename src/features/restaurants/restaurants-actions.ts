"use server";

import { logAdminMutation, logAdminRead } from "@/lib/audit/log-admin-activity";
import { getSessionUser } from "@/lib/auth/get-session";
import {
  canManageRestaurants,
  canViewRestaurants,
  hasPermissionInSet,
} from "@/lib/auth/permissions";
import {
  mapDeliveryDbRowsToListRows,
  type DeliveryDbRowForList,
} from "@/features/deliveries/map-delivery-list-row";
import type { DeliveryListRow, DeliveryStatus } from "@/features/deliveries/types";
import {
  applyRestaurantLogoFromForm,
  deleteRestaurantLogoFiles,
} from "./restaurant-logo-storage";
import {
  parseRestaurantFormData,
  validateRestaurantCoordinates,
  validateRestaurantExternalMerchantId,
} from "./parse-restaurant-form";
import {
  fromDbRestaurantStatus,
  toDbRestaurantStatus,
} from "./restaurant-status";
import { resolveRestaurantLogoUrls } from "@/lib/storage/restaurant-logo-url";
import {
  validateZoneGeometry,
  type ZoneGeoFeature,
  type ZoneGeometryType,
} from "@/lib/geo/zone-geometry";
import { COLLECTIONS } from "@/lib/firebase/db";
import { catalogNameStamp } from "@/lib/search/prefix";
import { staffDb } from "@/lib/firebase/staff-db";
import type { Json } from "@/types/database";
import type { DocumentData, Firestore } from "firebase-admin/firestore";
import type {
  RestaurantActivityEvent,
  RestaurantAssignedDriver,
  RestaurantDetailModel,
  RestaurantGeofence,
  RestaurantGeofenceInput,
  RestaurantGeofenceKind,
  RestaurantGeofenceMutationResult,
  RestaurantMutationResult,
  RestaurantPartnerOption,
  RestaurantRow,
  RestaurantZoneOption,
} from "./types";
import {
  buildActivityLogFromDeliveries,
  computeDeliveryStats,
  isDeliveryForRestaurant,
  type ScopedDeliveryRow,
} from "./restaurant-delivery-scope";

type PgLikeError = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
};

type Row = Record<string, unknown> & { id: string };

const INTAKE_RESTAURANTS = "driver_intake_restaurants";
const VERIFICATION_BALANCES = "verification_balances";
const STORE_ALIASES = "order_recon_store_aliases";

function plainValue(value: unknown): unknown {
  if (value == null || typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  if ("toDate" in value && typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  if (Array.isArray(value)) return value.map(plainValue);
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    out[key] = plainValue(child);
  }
  return out;
}

function asRow(id: string, data: DocumentData | undefined): Row {
  return { id, ...((plainValue(data ?? {}) as Record<string, unknown>) ?? {}) };
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function strOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function openDb(): Promise<Firestore> {
  const db = await staffDb();
  if (!db) throw new Error("not_configured");
  return db;
}

async function rowsByIds(db: Firestore, collection: string, ids: string[]): Promise<Map<string, Row>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const map = new Map<string, Row>();
  for (let i = 0; i < unique.length; i += 100) {
    const refs = unique.slice(i, i + 100).map((id) => db.collection(collection).doc(id));
    if (refs.length === 0) continue;
    const snaps = await db.getAll(...refs);
    for (const snap of snaps) {
      if (snap.exists) map.set(snap.id, asRow(snap.id, snap.data()));
    }
  }
  return map;
}

async function whereIn(db: Firestore, collection: string, field: string, ids: string[]): Promise<Row[]> {
  const unique = [...new Set(ids.filter(Boolean))];
  const rows: Row[] = [];
  for (let i = 0; i < unique.length; i += 30) {
    const chunk = unique.slice(i, i + 30);
    const snap = await db.collection(collection).where(field, "in", chunk).get();
    for (const doc of snap.docs) rows.push(asRow(doc.id, doc.data()));
  }
  return rows;
}

function formatPgErrorDetail(error: PgLikeError | null | undefined): string | undefined {
  if (!error) return undefined;
  const parts: string[] = [];
  if (error.code) parts.push(`code ${error.code}`);
  if (error.message) parts.push(error.message);
  if (error.details) parts.push(error.details);
  if (error.hint) parts.push(`hint: ${error.hint}`);
  return parts.length > 0 ? parts.join(" — ") : undefined;
}

function logPgError(scope: string, error: PgLikeError | unknown): void {
  const e = error as PgLikeError;
  console.error(`[restaurants:${scope}]`, {
    code: e?.code ?? null,
    message: e?.message ?? (error instanceof Error ? error.message : null),
    details: e?.details ?? null,
    hint: e?.hint ?? null,
  });
}

async function requireDeliveriesView() {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, "deliveries.view", session.isSuperAdmin)
  ) {
    throw new Error("not_authorized");
  }
  return session;
}

async function fetchAssignedDriverIdsForRestaurant(
  db: Firestore,
  restaurantId: string,
): Promise<Set<string>> {
  try {
    const snap = await db
      .collection(COLLECTIONS.driverRestaurants)
      .where("restaurant_id", "==", restaurantId)
      .get();
    return new Set(snap.docs.map((doc) => str(doc.data().driver_id)).filter(Boolean));
  } catch (error) {
    logPgError("assigned_drivers", error);
    return new Set();
  }
}

async function fetchLinkedDriverCountsByRestaurant(
  db: Firestore,
  restaurantIds: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (const id of restaurantIds) counts.set(id, 0);
  if (restaurantIds.length === 0) return counts;
  try {
    const rows = await whereIn(db, COLLECTIONS.driverRestaurants, "restaurant_id", restaurantIds);
    const uniqueByRestaurant = new Map<string, Set<string>>();
    for (const row of rows) {
      const restaurantId = str(row.restaurant_id);
      const driverId = str(row.driver_id);
      if (!restaurantId || !driverId) continue;
      const set = uniqueByRestaurant.get(restaurantId) ?? new Set();
      set.add(driverId);
      uniqueByRestaurant.set(restaurantId, set);
    }
    for (const [restaurantId, set] of uniqueByRestaurant) counts.set(restaurantId, set.size);
  } catch (error) {
    logPgError("linked_driver_counts", error);
  }
  return counts;
}

async function fetchScopedDeliveryRows(
  db: Firestore,
  restaurantId: string,
  restaurantPartnerId: string | null,
  assignedDriverIds: ReadonlySet<string>,
): Promise<ScopedDeliveryRow[]> {
  let direct: Row[] = [];
  let indirect: Row[] = [];
  try {
    const snap = await db
      .collection(COLLECTIONS.deliveries)
      .where("restaurant_id", "==", restaurantId)
      .get();
    direct = snap.docs.map((doc) => asRow(doc.id, doc.data()));
  } catch (error) {
    logPgError("scoped_deliveries_direct", error);
  }
  if (assignedDriverIds.size > 0 && restaurantPartnerId) {
    try {
      const rows = await whereIn(db, COLLECTIONS.deliveries, "driver_id", [...assignedDriverIds]);
      indirect = rows.filter(
        (row) => row.restaurant_id == null && str(row.partner_id) === restaurantPartnerId,
      );
    } catch (error) {
      logPgError("scoped_deliveries_indirect", error);
    }
  }
  const merged = [...direct, ...indirect];
  const profiles = await rowsByIds(
    db,
    COLLECTIONS.profiles,
    merged.map((row) => str(row.driver_id)).filter(Boolean),
  );
  const drivers = await rowsByIds(
    db,
    COLLECTIONS.drivers,
    merged.map((row) => str(row.driver_id)).filter(Boolean),
  );
  const byId = new Map<string, ScopedDeliveryRow>();
  for (const row of merged) {
    if (byId.has(row.id)) continue;
    const driver = drivers.get(str(row.driver_id));
    const profile = profiles.get(str(row.driver_id));
    byId.set(row.id, {
      id: row.id,
      driver_id: str(row.driver_id),
      partner_id: strOrNull(row.partner_id),
      restaurant_id: strOrNull(row.restaurant_id),
      status: row.status as DeliveryStatus,
      external_order_id: strOrNull(row.external_order_id),
      pickup_at: strOrNull(row.pickup_at),
      delivered_at: strOrNull(row.delivered_at),
      cancelled_at: strOrNull(row.cancelled_at),
      cancel_reason: strOrNull(row.cancel_reason),
      created_at: str(row.created_at),
      driver_name: strOrNull(profile?.full_name) ?? undefined,
      driver_code: strOrNull(driver?.driver_code) ?? undefined,
    });
  }
  return [...byId.values()].filter((d) =>
    isDeliveryForRestaurant(d, restaurantId, restaurantPartnerId, assignedDriverIds),
  );
}

async function fetchRestaurantListAggregates(
  db: Firestore,
  restaurantIds: string[],
  restaurants: Array<{
    id: string;
    partner_id: string | null;
    latitude: number | null;
    longitude: number | null;
  }>,
): Promise<
  Map<
    string,
    Pick<
      RestaurantRow,
      | "active_deliveries"
      | "deliveries_total"
      | "deliveries_verified"
      | "deliveries_cancelled"
      | "has_coordinates"
      | "geofence_count"
    >
  >
> {
  const result = new Map<
    string,
    Pick<
      RestaurantRow,
      | "active_deliveries"
      | "deliveries_total"
      | "deliveries_verified"
      | "deliveries_cancelled"
      | "has_coordinates"
      | "geofence_count"
    >
  >();
  for (const r of restaurants) {
    result.set(r.id, {
      active_deliveries: 0,
      deliveries_total: 0,
      deliveries_verified: 0,
      deliveries_cancelled: 0,
      has_coordinates: hasValidCoordinates(r.latitude, r.longitude),
      geofence_count: 0,
    });
  }
  if (restaurantIds.length === 0) return result;
  const partnerByRestaurant = new Map(restaurants.map((r) => [r.id, r.partner_id]));
  const idSet = new Set(restaurantIds);
  let geofences: Row[] = [];
  let driverLinks: Row[] = [];
  let deliveries: Row[] = [];
  try {
    geofences = await whereIn(db, COLLECTIONS.restaurantGeofences, "restaurant_id", restaurantIds);
  } catch (error) {
    logPgError("list_geofence_counts", error);
  }
  try {
    driverLinks = await whereIn(db, COLLECTIONS.driverRestaurants, "restaurant_id", restaurantIds);
  } catch (error) {
    logPgError("list_driver_links", error);
  }
  try {
    const snap = await db
      .collection(COLLECTIONS.deliveries)
      .select("restaurant_id", "driver_id", "partner_id", "status")
      .get();
    deliveries = snap.docs.map((doc) => asRow(doc.id, doc.data()));
  } catch (error) {
    logPgError("list_delivery_stats", error);
  }
  const geofenceCounts = new Map<string, number>();
  for (const row of geofences) {
    const restaurantId = str(row.restaurant_id);
    geofenceCounts.set(restaurantId, (geofenceCounts.get(restaurantId) ?? 0) + 1);
  }
  const driversByRestaurant = new Map<string, Set<string>>();
  for (const row of driverLinks) {
    const restaurantId = str(row.restaurant_id);
    const driverId = str(row.driver_id);
    const set = driversByRestaurant.get(restaurantId) ?? new Set();
    if (driverId) set.add(driverId);
    driversByRestaurant.set(restaurantId, set);
  }
  const statsByRestaurant = new Map<string, ScopedDeliveryRow[]>();
  for (const restaurantId of restaurantIds) statsByRestaurant.set(restaurantId, []);
  for (const d of deliveries) {
    const scoped: ScopedDeliveryRow = {
      id: d.id,
      driver_id: str(d.driver_id),
      partner_id: strOrNull(d.partner_id),
      restaurant_id: strOrNull(d.restaurant_id),
      status: d.status as DeliveryStatus,
      external_order_id: null,
      pickup_at: null,
      delivered_at: null,
      cancelled_at: null,
      cancel_reason: null,
      created_at: "",
    };
    const restaurantId = strOrNull(d.restaurant_id);
    if (restaurantId && statsByRestaurant.has(restaurantId)) {
      statsByRestaurant.get(restaurantId)!.push(scoped);
      continue;
    }
    if (restaurantId != null) continue;
    for (const candidate of idSet) {
      const partnerId = partnerByRestaurant.get(candidate) ?? null;
      const assigned = driversByRestaurant.get(candidate) ?? new Set();
      if (isDeliveryForRestaurant(scoped, candidate, partnerId, assigned)) {
        statsByRestaurant.get(candidate)!.push(scoped);
      }
    }
  }
  for (const restaurantId of restaurantIds) {
    const base = result.get(restaurantId)!;
    const stats = computeDeliveryStats(statsByRestaurant.get(restaurantId) ?? []);
    result.set(restaurantId, {
      ...base,
      active_deliveries: stats.active_deliveries,
      deliveries_total: stats.deliveries_total,
      deliveries_verified: stats.deliveries_verified,
      deliveries_cancelled: stats.deliveries_cancelled,
      geofence_count: geofenceCounts.get(restaurantId) ?? 0,
    });
  }
  return result;
}

function restaurantBaseFromRow(row: Row) {
  return {
    id: row.id,
    partner_id: strOrNull(row.partner_id),
    zone_id: strOrNull(row.zone_id),
    name: str(row.name),
    logo_url: strOrNull(row.logo_url),
    external_merchant_id: strOrNull(row.external_merchant_id),
    map_link: strOrNull(row.map_link),
    latitude: numOrNull(row.latitude),
    longitude: numOrNull(row.longitude),
    status: str(row.status),
    is_active: row.is_active !== false,
    created_at: str(row.created_at),
  };
}

async function mapRestaurantBaseRow(
  row: ReturnType<typeof restaurantBaseFromRow>,
  partnerMap: Map<string, string>,
  zoneMap: Map<string, string>,
  driverCount: number,
  aggregates: Pick<
    RestaurantRow,
    | "active_deliveries"
    | "deliveries_total"
    | "deliveries_verified"
    | "deliveries_cancelled"
    | "has_coordinates"
    | "geofence_count"
  >,
): Promise<RestaurantRow> {
  return {
    id: row.id,
    partner_id: row.partner_id,
    partner_name: row.partner_id ? (partnerMap.get(row.partner_id) ?? "—") : "—",
    zone_id: row.zone_id,
    zone_name: row.zone_id ? (zoneMap.get(row.zone_id) ?? "—") : "—",
    name: row.name,
    logo_url: row.logo_url,
    logo_display_url: null,
    external_merchant_id: row.external_merchant_id,
    map_link: row.map_link,
    latitude: row.latitude,
    longitude: row.longitude,
    status: fromDbRestaurantStatus(row.status, row.is_active),
    is_active: row.is_active,
    driver_count: driverCount,
    created_at: row.created_at,
    ...aggregates,
  };
}

async function requireRestaurantsView() {
  const session = await getSessionUser();
  if (!session || !canViewRestaurants(session.permissions, session.isSuperAdmin)) {
    throw new Error("not_authorized");
  }
  return session;
}

async function requireRestaurantsManage() {
  const session = await getSessionUser();
  if (!session || !canManageRestaurants(session.permissions, session.isSuperAdmin)) {
    return { error: "not_authorized" as const };
  }
  return { session };
}

export async function fetchRestaurantPartnerOptions(): Promise<RestaurantPartnerOption[]> {
  await requireRestaurantsView();
  const db = await openDb();
  const snap = await db.collection(COLLECTIONS.partners).get();
  return snap.docs
    .map((doc) => ({ id: doc.id, name: str(doc.data().name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function fetchRestaurantZoneOptions(): Promise<RestaurantZoneOption[]> {
  await requireRestaurantsView();
  const db = await openDb();
  const snap = await db.collection(COLLECTIONS.zones).get();
  return snap.docs
    .map((doc) => ({ id: doc.id, name: str(doc.data().name), code: str(doc.data().code) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function fetchRestaurantsForAdmin(): Promise<RestaurantRow[]> {
  await requireRestaurantsView();
  void logAdminRead("restaurants", "fetchRestaurantsForAdmin");
  const db = await openDb();
  const [restaurantSnap, partnerSnap, zoneSnap] = await Promise.all([
    db.collection(COLLECTIONS.restaurants).get(),
    db.collection(COLLECTIONS.partners).get(),
    db.collection(COLLECTIONS.zones).get(),
  ]);
  const restaurants = restaurantSnap.docs
    .map((doc) => restaurantBaseFromRow(asRow(doc.id, doc.data())))
    .sort((a, b) => a.name.localeCompare(b.name));
  const partnerMap = new Map(partnerSnap.docs.map((doc) => [doc.id, str(doc.data().name)]));
  const zoneMap = new Map(
    zoneSnap.docs.map((doc) => [doc.id, `${str(doc.data().name)} (${str(doc.data().code)})`]),
  );
  const ids = restaurants.map((r) => r.id);
  const driverCounts = await fetchLinkedDriverCountsByRestaurant(db, ids);
  const listAggregates = await fetchRestaurantListAggregates(db, ids, restaurants);
  const rows = await Promise.all(
    restaurants.map(async (row) => {
      const aggregates = listAggregates.get(row.id) ?? {
        active_deliveries: 0,
        deliveries_total: 0,
        deliveries_verified: 0,
        deliveries_cancelled: 0,
        has_coordinates: hasValidCoordinates(row.latitude, row.longitude),
        geofence_count: 0,
      };
      return mapRestaurantBaseRow(row, partnerMap, zoneMap, driverCounts.get(row.id) ?? 0, aggregates);
    }),
  );
  try {
    return await resolveRestaurantLogoUrls(rows);
  } catch (error) {
    logPgError("logo_urls", error);
    return rows.map((row) => ({ ...row, logo_display_url: null }));
  }
}

export async function fetchRestaurantPickerOptions(): Promise<
  Array<{
    id: string;
    name: string;
    partner_id: string | null;
    partner_name: string | null;
    status: RestaurantRow["status"];
  }>
> {
  await requireRestaurantsView();
  const db = await openDb();
  const [restaurantSnap, partnerSnap] = await Promise.all([
    db.collection(COLLECTIONS.restaurants).get(),
    db.collection(COLLECTIONS.partners).get(),
  ]);
  const partnerNameById = new Map(partnerSnap.docs.map((doc) => [doc.id, str(doc.data().name)]));
  return restaurantSnap.docs
    .map((doc) => asRow(doc.id, doc.data()))
    .sort((a, b) => str(a.name).localeCompare(str(b.name)))
    .map((row) => ({
      id: row.id,
      name: str(row.name),
      partner_id: strOrNull(row.partner_id),
      partner_name: strOrNull(row.partner_id) ? (partnerNameById.get(str(row.partner_id)) ?? null) : null,
      status: fromDbRestaurantStatus(str(row.status)),
    }));
}

function validateGeofenceInput(input: RestaurantGeofenceInput): string | null {
  if (input.kind !== "inclusion" && input.kind !== "exclusion") return "invalid_kind";
  return validateZoneGeometry(input.zone_type, input.geometry);
}

function mapGeofenceRow(row: {
  id: string;
  restaurant_id: string;
  kind: string;
  zone_type: string;
  geometry: Json;
  name: string | null;
  color: string;
  created_at: string;
}): RestaurantGeofence {
  return {
    id: row.id,
    restaurant_id: row.restaurant_id,
    kind: row.kind as RestaurantGeofenceKind,
    zone_type: row.zone_type as ZoneGeometryType,
    geometry: row.geometry as unknown as ZoneGeoFeature,
    name: row.name,
    color: row.color,
    created_at: row.created_at,
  };
}

export async function fetchRestaurantGeofences(restaurantId: string): Promise<RestaurantGeofence[]> {
  await requireRestaurantsView();
  if (!restaurantId) return [];
  const db = await openDb();
  const snap = await db
    .collection(COLLECTIONS.restaurantGeofences)
    .where("restaurant_id", "==", restaurantId)
    .get();
  return snap.docs
    .map((doc) => asRow(doc.id, doc.data()))
    .sort((a, b) => str(a.created_at).localeCompare(str(b.created_at)))
    .map((row) =>
      mapGeofenceRow({
        id: row.id,
        restaurant_id: str(row.restaurant_id),
        kind: str(row.kind),
        zone_type: str(row.zone_type),
        geometry: row.geometry as Json,
        name: strOrNull(row.name),
        color: str(row.color),
        created_at: str(row.created_at),
      }),
    );
}

export async function fetchRestaurantDetail(restaurantId: string): Promise<RestaurantDetailModel | null> {
  await requireRestaurantsView();
  if (!restaurantId) return null;
  void logAdminRead("restaurants", "fetchRestaurantDetail", { restaurantId });
  const db = await openDb();
  const snap = await db.collection(COLLECTIONS.restaurants).doc(restaurantId).get();
  if (!snap.exists) return null;
  const row = restaurantBaseFromRow(asRow(snap.id, snap.data()));
  const [partnerSnap, zoneSnap] = await Promise.all([
    row.partner_id ? db.collection(COLLECTIONS.partners).doc(row.partner_id).get() : Promise.resolve(null),
    row.zone_id ? db.collection(COLLECTIONS.zones).doc(row.zone_id).get() : Promise.resolve(null),
  ]);
  const partnerMap = new Map<string, string>();
  if (partnerSnap?.exists) partnerMap.set(partnerSnap.id, str(partnerSnap.data()?.name));
  const zoneMap = new Map<string, string>();
  if (zoneSnap?.exists) {
    zoneMap.set(zoneSnap.id, `${str(zoneSnap.data()?.name)} (${str(zoneSnap.data()?.code)})`);
  }
  const driverCount = (await fetchLinkedDriverCountsByRestaurant(db, [restaurantId])).get(restaurantId) ?? 0;
  const aggregates = (
    await fetchRestaurantListAggregates(db, [restaurantId], [
      {
        id: restaurantId,
        partner_id: row.partner_id,
        latitude: row.latitude,
        longitude: row.longitude,
      },
    ])
  ).get(restaurantId)!;
  const assignedDriverIds = await fetchAssignedDriverIdsForRestaurant(db, restaurantId);
  const scopedDeliveries = await fetchScopedDeliveryRows(
    db,
    restaurantId,
    row.partner_id,
    assignedDriverIds,
  );
  const deliveryStats = computeDeliveryStats(scopedDeliveries);
  const base = await mapRestaurantBaseRow(row, partnerMap, zoneMap, driverCount, aggregates);
  const [withLogo] = await resolveRestaurantLogoUrls([base]);
  return {
    ...withLogo,
    geofence_count: aggregates.geofence_count,
    has_coordinates: aggregates.has_coordinates,
    delivery_stats: deliveryStats,
  };
}

export async function fetchRestaurantAssignedDrivers(restaurantId: string): Promise<RestaurantAssignedDriver[]> {
  await requireRestaurantsView();
  if (!restaurantId) return [];
  const db = await openDb();
  let linkedRows: Row[] = [];
  let intakeLinks: Row[] = [];
  try {
    const snap = await db
      .collection(COLLECTIONS.driverRestaurants)
      .where("restaurant_id", "==", restaurantId)
      .get();
    linkedRows = snap.docs.map((doc) => asRow(doc.id, doc.data()));
  } catch (error) {
    logPgError("assigned_linked", error);
  }
  try {
    const snap = await db.collection(INTAKE_RESTAURANTS).where("restaurant_id", "==", restaurantId).get();
    intakeLinks = snap.docs.map((doc) => asRow(doc.id, doc.data()));
  } catch (error) {
    logPgError("assigned_intake", error);
  }
  const linkedDriverIds = linkedRows.map((row) => str(row.driver_id)).filter(Boolean);
  const [drivers, profiles, intakeByProfile] = await Promise.all([
    rowsByIds(db, COLLECTIONS.drivers, linkedDriverIds),
    rowsByIds(db, COLLECTIONS.profiles, linkedDriverIds),
    whereIn(db, COLLECTIONS.driverIntakes, "linked_profile_id", linkedDriverIds).catch((error: unknown) => {
      logPgError("assigned_intake_profile", error);
      return [] as Row[];
    }),
  ]);
  const intakeIdByDriverId = new Map<string, string>();
  for (const row of intakeByProfile) {
    if (row.archived_at != null) continue;
    const profileId = str(row.linked_profile_id);
    if (profileId) intakeIdByDriverId.set(profileId, row.id);
  }
  const results: RestaurantAssignedDriver[] = [];
  for (const row of linkedRows) {
    const driverId = str(row.driver_id);
    const driver = drivers.get(driverId);
    if (!driver) continue;
    const profile = profiles.get(driverId);
    results.push({
      id: `linked:${driverId}`,
      driver_id: driverId,
      intake_id: intakeIdByDriverId.get(driverId) ?? null,
      name: str(profile?.full_name) || "—",
      driver_code: str(driver.driver_code) || "—",
      phone: strOrNull(profile?.phone),
      link_status: "linked",
      is_on_duty: driver.is_on_duty === true,
      is_blocked: driver.is_blocked === true,
    });
  }
  const intakes = await rowsByIds(
    db,
    COLLECTIONS.driverIntakes,
    intakeLinks.map((row) => str(row.intake_id)).filter(Boolean),
  );
  for (const row of intakeLinks) {
    const intake = intakes.get(str(row.intake_id));
    if (!intake || intake.linked === true) continue;
    results.push({
      id: `intake:${str(row.intake_id)}`,
      driver_id: null,
      intake_id: str(row.intake_id),
      name: str(intake.full_name) || "—",
      driver_code: str(intake.driver_code) || "—",
      phone: strOrNull(intake.phone),
      link_status: "intake",
      is_on_duty: false,
      is_blocked: false,
    });
  }
  return results.sort((a, b) => a.name.localeCompare(b.name));
}

export type RestaurantDeliveriesFilter = {
  status?: DeliveryStatus | "all" | "active";
};

async function hydrateDeliveryListRows(db: Firestore, rows: Row[]): Promise<DeliveryDbRowForList[]> {
  const driverIds = rows.map((row) => str(row.driver_id)).filter(Boolean);
  const [drivers, profiles, partners, restaurants, zones] = await Promise.all([
    rowsByIds(db, COLLECTIONS.drivers, driverIds),
    rowsByIds(db, COLLECTIONS.profiles, driverIds),
    rowsByIds(db, COLLECTIONS.partners, rows.map((row) => str(row.partner_id)).filter(Boolean)),
    rowsByIds(db, COLLECTIONS.restaurants, rows.map((row) => str(row.restaurant_id)).filter(Boolean)),
    rowsByIds(db, COLLECTIONS.zones, rows.map((row) => str(row.zone_id)).filter(Boolean)),
  ]);
  return rows.map((row) => {
    const driver = drivers.get(str(row.driver_id));
    const profile = profiles.get(str(row.driver_id));
    const partner = partners.get(str(row.partner_id));
    const restaurant = restaurants.get(str(row.restaurant_id));
    const zone = zones.get(str(row.zone_id));
    return {
      id: row.id,
      driver_id: str(row.driver_id),
      partner_id: strOrNull(row.partner_id),
      restaurant_id: strOrNull(row.restaurant_id),
      zone_id: strOrNull(row.zone_id),
      external_order_id: strOrNull(row.external_order_id),
      order_proof_url: strOrNull(row.order_proof_url),
      order_proof_urls: Array.isArray(row.order_proof_urls) ? (row.order_proof_urls as string[]) : null,
      status: row.status as DeliveryStatus,
      rejection_reason: strOrNull(row.rejection_reason),
      delivered_at: strOrNull(row.delivered_at),
      delivered_lat: numOrNull(row.delivered_lat),
      delivered_lng: numOrNull(row.delivered_lng),
      pickup_at: strOrNull(row.pickup_at),
      pickup_lat: numOrNull(row.pickup_lat),
      pickup_lng: numOrNull(row.pickup_lng),
      pickup_proof_url: strOrNull(row.pickup_proof_url),
      pickup_proof_urls: Array.isArray(row.pickup_proof_urls) ? (row.pickup_proof_urls as string[]) : null,
      cancelled_at: strOrNull(row.cancelled_at),
      cancel_lat: numOrNull(row.cancel_lat),
      cancel_lng: numOrNull(row.cancel_lng),
      cancel_reason: strOrNull(row.cancel_reason),
      cancel_proof_url: strOrNull(row.cancel_proof_url),
      cancel_proof_urls: Array.isArray(row.cancel_proof_urls) ? (row.cancel_proof_urls as string[]) : null,
      created_at: str(row.created_at),
      drivers: driver
        ? {
            driver_code: str(driver.driver_code),
            profiles: profile
              ? { full_name: strOrNull(profile.full_name), phone: strOrNull(profile.phone) }
              : null,
          }
        : null,
      partners: partner ? { name: str(partner.name), logo_url: strOrNull(partner.logo_url) } : null,
      restaurants: restaurant ? { id: restaurant.id, name: str(restaurant.name) } : null,
      zones: zone ? { name: str(zone.name) } : null,
    };
  });
}

export async function fetchRestaurantDeliveries(
  restaurantId: string,
  opts: RestaurantDeliveriesFilter = {},
): Promise<DeliveryListRow[]> {
  await requireDeliveriesView();
  if (!restaurantId) return [];
  void logAdminRead("restaurants", "fetchRestaurantDeliveries", { restaurantId });
  const db = await openDb();
  const restaurantSnap = await db.collection(COLLECTIONS.restaurants).doc(restaurantId).get();
  if (!restaurantSnap.exists) return [];
  const partnerId = strOrNull(restaurantSnap.data()?.partner_id);
  const assignedDriverIds = await fetchAssignedDriverIdsForRestaurant(db, restaurantId);
  const directSnap = await db.collection(COLLECTIONS.deliveries).where("restaurant_id", "==", restaurantId).get();
  const direct = directSnap.docs.map((doc) => asRow(doc.id, doc.data()));
  let indirect: Row[] = [];
  if (assignedDriverIds.size > 0 && partnerId) {
    const rows = await whereIn(db, COLLECTIONS.deliveries, "driver_id", [...assignedDriverIds]);
    indirect = rows.filter((row) => row.restaurant_id == null && str(row.partner_id) === partnerId);
  }
  const byId = new Map<string, Row>();
  for (const row of [...direct, ...indirect]) {
    if (!byId.has(row.id)) byId.set(row.id, row);
  }
  let rows = [...byId.values()].filter((d) =>
    isDeliveryForRestaurant(
      {
        driver_id: str(d.driver_id),
        partner_id: strOrNull(d.partner_id),
        restaurant_id: strOrNull(d.restaurant_id),
      },
      restaurantId,
      partnerId,
      assignedDriverIds,
    ),
  );
  if (opts.status && opts.status !== "all") {
    rows = opts.status === "active" ? rows.filter((r) => r.status === "in_transit") : rows.filter((r) => r.status === opts.status);
  }
  rows.sort((a, b) => new Date(str(b.created_at)).getTime() - new Date(str(a.created_at)).getTime());
  return mapDeliveryDbRowsToListRows(await hydrateDeliveryListRows(db, rows));
}

export async function fetchRestaurantActivityLog(
  restaurantId: string,
  limit = 100,
): Promise<RestaurantActivityEvent[]> {
  await requireDeliveriesView();
  if (!restaurantId) return [];
  const db = await openDb();
  const restaurantSnap = await db.collection(COLLECTIONS.restaurants).doc(restaurantId).get();
  if (!restaurantSnap.exists) return [];
  const assignedDriverIds = await fetchAssignedDriverIdsForRestaurant(db, restaurantId);
  const scoped = await fetchScopedDeliveryRows(
    db,
    restaurantId,
    strOrNull(restaurantSnap.data()?.partner_id),
    assignedDriverIds,
  );
  return buildActivityLogFromDeliveries(scoped, limit);
}

export async function saveRestaurantGeofences(
  restaurantId: string,
  geofences: RestaurantGeofenceInput[],
): Promise<RestaurantGeofenceMutationResult> {
  const auth = await requireRestaurantsManage();
  if (auth.error) return { error: auth.error };
  if (!restaurantId) return { error: "missing_fields" };
  for (const geofence of geofences) {
    const validationError = validateGeofenceInput(geofence);
    if (validationError) return { error: validationError };
  }
  const db = await openDb();
  const existingSnap = await db
    .collection(COLLECTIONS.restaurantGeofences)
    .where("restaurant_id", "==", restaurantId)
    .get();
  const incomingIds = new Set(geofences.map((g) => g.id).filter((id): id is string => Boolean(id)));
  const toDelete = existingSnap.docs.filter((doc) => !incomingIds.has(doc.id));
  try {
    for (let i = 0; i < toDelete.length; i += 400) {
      const batch = db.batch();
      for (const doc of toDelete.slice(i, i + 400)) batch.delete(doc.ref);
      await batch.commit();
    }
    for (const geofence of geofences) {
      const payload = {
        restaurant_id: restaurantId,
        kind: geofence.kind,
        zone_type: geofence.zone_type,
        geometry: geofence.geometry,
        name: geofence.name?.trim() || null,
        color: geofence.color ?? (geofence.kind === "inclusion" ? "#22c55e" : "#ef4444"),
        updated_at: new Date(),
      };
      if (geofence.id) {
        const ref = db.collection(COLLECTIONS.restaurantGeofences).doc(geofence.id);
        const current = await ref.get();
        if (current.exists && str(current.data()?.restaurant_id) === restaurantId) {
          await ref.set(payload, { merge: true });
        }
      } else {
        const id = crypto.randomUUID();
        await db.collection(COLLECTIONS.restaurantGeofences).doc(id).set({
          ...payload,
          id,
          created_by: auth.session.id,
          created_at: new Date(),
        });
      }
    }
  } catch (error) {
    logPgError("save_geofences", error);
    return { error: "save_failed" };
  }
  void logAdminMutation({
    action: "update",
    entityType: "restaurant",
    entityId: restaurantId,
    routeName: "saveRestaurantGeofences",
    after: { geofence_count: geofences.length },
  });
  return { success: true };
}

function hasValidCoordinates(latitude: number | null, longitude: number | null): boolean {
  return (
    latitude != null &&
    longitude != null &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude)
  );
}

async function countInclusionGeofences(db: Firestore, restaurantId: string): Promise<number> {
  try {
    const snap = await db
      .collection(COLLECTIONS.restaurantGeofences)
      .where("restaurant_id", "==", restaurantId)
      .where("kind", "==", "inclusion")
      .count()
      .get();
    return snap.data().count;
  } catch (error) {
    logPgError("count_inclusion_geofences", error);
    return 0;
  }
}

async function restaurantNameTaken(
  db: Firestore,
  partnerId: string | null,
  zoneId: string | null,
  name: string,
  excludeId?: string,
): Promise<boolean> {
  if (!partnerId || !zoneId) return false;
  const snap = await db.collection(COLLECTIONS.restaurants).where("name", "==", name).get();
  return snap.docs.some((doc) => {
    if (doc.id === excludeId) return false;
    const data = doc.data();
    return strOrNull(data.partner_id) === partnerId && strOrNull(data.zone_id) === zoneId;
  });
}

async function nextRestaurantCode(db: Firestore): Promise<string> {
  const ref = db.collection("counters").doc("restaurant_code_seq");
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const n = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const current = Number(snap.data()?.value ?? 0);
      const next = (Number.isFinite(current) ? current : 0) + 1;
      tx.set(ref, { value: next }, { merge: true });
      return next;
    });
    const code = `RST-${String(n).padStart(4, "0")}`;
    const taken = await db.collection(COLLECTIONS.restaurants).where("restaurant_code", "==", code).limit(1).get();
    if (taken.empty) return code;
  }
  throw new Error("restaurant_code");
}

export async function saveRestaurant(formData: FormData): Promise<RestaurantMutationResult> {
  const auth = await requireRestaurantsManage();
  if (auth.error) return { error: auth.error };
  const parsed = parseRestaurantFormData(formData);
  const {
    id,
    partnerId,
    zoneId,
    name,
    externalMerchantId,
    mapLink,
    status: requestedStatus,
    latitude,
    longitude,
    inclusionGeofenceCount,
  } = parsed;
  if (!name) return { error: "missing_fields" };
  const coordError = validateRestaurantCoordinates(latitude, longitude);
  if (coordError) return { error: coordError };
  const merchantError = validateRestaurantExternalMerchantId(externalMerchantId);
  if (merchantError) return { error: merchantError };
  const db = await openDb();
  let status = requestedStatus;
  let statusWarning: RestaurantMutationResult["statusWarning"];
  if (status === "published") {
    let hasInclusionGeofence = inclusionGeofenceCount > 0;
    if (!hasInclusionGeofence && id) {
      hasInclusionGeofence = (await countInclusionGeofences(db, id)) > 0;
    }
    if (!hasValidCoordinates(latitude, longitude) && !hasInclusionGeofence) {
      status = "draft";
      statusWarning = "auto_downgraded_to_draft";
    }
  }
  const isActive = status === "published";
  const payload = {
    partner_id: partnerId || null,
    zone_id: zoneId || null,
    name,
    external_merchant_id: externalMerchantId || null,
    map_link: mapLink || null,
    latitude,
    longitude,
    status: toDbRestaurantStatus(status),
    is_active: isActive && status !== "archived",
    updated_at: new Date(),
    ...catalogNameStamp(name, externalMerchantId),
  };
  if (await restaurantNameTaken(db, payload.partner_id, payload.zone_id, name, id || undefined)) {
    return { error: "restaurant_exists" };
  }
  if (id) {
    const logoResult = await applyRestaurantLogoFromForm(id, formData, auth.session.id);
    const patch = {
      ...payload,
      ...(logoResult.logoUrl !== undefined ? { logo_url: logoResult.logoUrl } : {}),
    };
    try {
      await db.collection(COLLECTIONS.restaurants).doc(id).set(patch, { merge: true });
    } catch (error) {
      logPgError("update", error);
      return {
        error: "save_failed",
        errorDetail: formatPgErrorDetail({ message: error instanceof Error ? error.message : "save_failed" }),
      };
    }
    void logAdminMutation({
      action: "update",
      entityType: "restaurant",
      entityId: id,
      routeName: "saveRestaurant",
      after: { name, partner_id: partnerId, zone_id: zoneId, status },
    });
    return {
      success: true,
      id,
      logoUrl: logoResult.logoUrl,
      logoWarning: logoResult.logoWarning,
      statusWarning,
      finalStatus: status,
    };
  }
  const newId = crypto.randomUUID();
  let restaurantCode = "";
  try {
    restaurantCode = await nextRestaurantCode(db);
    await db.collection(COLLECTIONS.restaurants).doc(newId).set({
      ...payload,
      id: newId,
      restaurant_code: restaurantCode,
      created_by: auth.session.id,
      created_at: new Date(),
    });
  } catch (error) {
    logPgError("insert", error);
    return {
      error: "save_failed",
      errorDetail: formatPgErrorDetail({ message: error instanceof Error ? error.message : "save_failed" }),
    };
  }
  const logoResult = await applyRestaurantLogoFromForm(newId, formData, auth.session.id);
  if (logoResult.logoUrl !== undefined) {
    await db.collection(COLLECTIONS.restaurants).doc(newId).set(
      { logo_url: logoResult.logoUrl, updated_at: new Date() },
      { merge: true },
    );
  }
  void logAdminMutation({
    action: "create",
    entityType: "restaurant",
    entityId: newId,
    routeName: "saveRestaurant",
    after: { name, partner_id: partnerId, zone_id: zoneId, status },
  });
  return {
    success: true,
    id: newId,
    logoUrl: logoResult.logoUrl,
    logoWarning: logoResult.logoWarning,
    statusWarning,
    finalStatus: status,
  };
}

async function deleteWhere(db: Firestore, collection: string, field: string, value: string) {
  const snap = await db.collection(collection).where(field, "==", value).get();
  for (let i = 0; i < snap.docs.length; i += 400) {
    const batch = db.batch();
    for (const doc of snap.docs.slice(i, i + 400)) batch.delete(doc.ref);
    await batch.commit();
  }
}

async function nullWhere(db: Firestore, collection: string, field: string, value: string) {
  const snap = await db.collection(collection).where(field, "==", value).get();
  for (let i = 0; i < snap.docs.length; i += 400) {
    const batch = db.batch();
    for (const doc of snap.docs.slice(i, i + 400)) batch.set(doc.ref, { [field]: null }, { merge: true });
    await batch.commit();
  }
}

export async function deleteRestaurant(id: string): Promise<RestaurantMutationResult> {
  const auth = await requireRestaurantsManage();
  if (auth.error) return { error: auth.error };
  if (!id) return { error: "missing_fields" };
  const db = await openDb();
  await deleteRestaurantLogoFiles(id);
  try {
    await Promise.all([
      deleteWhere(db, COLLECTIONS.restaurantGeofences, "restaurant_id", id),
      deleteWhere(db, COLLECTIONS.driverRestaurants, "restaurant_id", id),
      deleteWhere(db, INTAKE_RESTAURANTS, "restaurant_id", id),
      deleteWhere(db, COLLECTIONS.deliveryVerifications, "restaurant_id", id),
      deleteWhere(db, VERIFICATION_BALANCES, "restaurant_id", id),
      deleteWhere(db, COLLECTIONS.deliveryRules, "restaurant_id", id),
      deleteWhere(db, COLLECTIONS.incentiveRules, "restaurant_id", id),
      deleteWhere(db, COLLECTIONS.deliveryRuleScopes, "restaurant_id", id),
      deleteWhere(db, COLLECTIONS.incentiveRuleScopes, "restaurant_id", id),
      deleteWhere(db, STORE_ALIASES, "restaurant_id", id),
      nullWhere(db, COLLECTIONS.deliveries, "restaurant_id", id),
      nullWhere(db, COLLECTIONS.drivers, "restaurant_id", id),
      nullWhere(db, COLLECTIONS.driverIntakes, "restaurant_id", id),
    ]);
    await db.collection(COLLECTIONS.restaurants).doc(id).delete();
  } catch (error) {
    logPgError("delete", error);
    return { error: "delete_failed" };
  }
  void logAdminMutation({
    action: "delete",
    entityType: "restaurant",
    entityId: id,
    routeName: "deleteRestaurant",
  });
  return { success: true };
}
