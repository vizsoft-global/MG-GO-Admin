"use server";

import type { DocumentData, Firestore, Query } from "firebase-admin/firestore";

import { logAdminRead } from "@/lib/audit/log-admin-activity";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { callCronFunction } from "@/lib/firebase/callable";
import { COLLECTIONS } from "@/lib/firebase/db";
import { staffDb } from "@/lib/firebase/staff-db";
import { vehicleTypeFromDriverJoin } from "@/features/vehicles/vehicle-type";

import { resolveLocationSubmitAction } from "./location-event-display";
import {
  enrichLiveLocation,
  latestGpsAt,
  parseTrackingStatus,
  parseZoneStatus,
} from "./location-status";
import type { DriverLiveLocation, DriverLocationEvent } from "./types";

type Loose = Record<string, unknown>;

async function requireDriversView() {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, "drivers.view", session.isSuperAdmin)
  ) {
    throw new Error("not_authorized");
  }
  return session;
}

async function requireDb(): Promise<Firestore> {
  const db = await staffDb();
  if (!db) throw new Error("not_configured");
  return db;
}

function fromValue(value: unknown): unknown {
  if (value == null) return value;
  if (value instanceof Date) return value.toISOString();
  if (
    typeof value === "object" &&
    "toDate" in value &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  if (Array.isArray(value)) return value.map(fromValue);
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Loose = {};
    for (const [key, inner] of Object.entries(value as Loose)) out[key] = fromValue(inner);
    return out;
  }
  return value;
}

function fromDoc(id: string, data: DocumentData | undefined): Loose {
  const out: Loose = { id };
  for (const [key, value] of Object.entries(data ?? {})) out[key] = fromValue(value);
  if (data?.id != null) out.id = fromValue(data.id) as string;
  return out;
}

async function loadByIds(db: Firestore, collection: string, ids: string[]): Promise<Map<string, Loose>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const map = new Map<string, Loose>();
  for (let i = 0; i < unique.length; i += 100) {
    const chunk = unique.slice(i, i + 100);
    if (chunk.length === 0) continue;
    const snaps = await db.getAll(...chunk.map((id) => db.collection(collection).doc(id)));
    for (const snap of snaps) {
      if (!snap.exists) continue;
      map.set(snap.id, fromDoc(snap.id, snap.data()));
    }
  }
  return map;
}

async function readQuery(build: (withOrder: boolean) => Query): Promise<Loose[]> {
  try {
    const snap = await build(true).get();
    return snap.docs.map((doc) => fromDoc(doc.id, doc.data()));
  } catch (error) {
    try {
      const snap = await build(false).get();
      return snap.docs.map((doc) => fromDoc(doc.id, doc.data()));
    } catch {
      throw new Error(error instanceof Error ? error.message : "query_failed");
    }
  }
}

function restaurantFromDriver(
  driver: {
    driver_restaurants?: Array<{
      restaurants: { name: string } | { name: string }[] | null;
    }> | null;
  } | null,
): string | null {
  const link = driver?.driver_restaurants?.[0];
  if (!link) return null;
  const rest = link.restaurants;
  const row = Array.isArray(rest) ? rest[0] : rest;
  return row?.name ?? null;
}

function mapLiveRow(row: {
  driver_id: string;
  latitude: number;
  longitude: number;
  speed_mps: number | null;
  distance_today_meters: number | null;
  accuracy_meters: number | null;
  battery_pct: number | null;
  heading_deg: number | null;
  active_delivery_id: string | null;
  tracking_status: string;
  zone_status: string | null;
  last_seen_at: string;
  last_report_at?: string | null;
  updated_at: string;
  drivers: {
    driver_code: string;
    employee_id: string | null;
    is_on_duty: boolean;
    is_blocked?: boolean;
    vehicle_type_key?: string | null;
    vehicles?:
      | { vehicle_type_key?: string | null }
      | { vehicle_type_key?: string | null }[]
      | null;
    profiles: { full_name: string | null } | { full_name: string | null }[] | null;
    driver_restaurants?: Array<{
      restaurants: { name: string } | { name: string }[] | null;
    }>;
  } | null;
}): DriverLiveLocation {
  const driver = row.drivers;
  const profile = driver?.profiles;
  const profileRow = Array.isArray(profile) ? profile[0] : profile;

  return enrichLiveLocation({
    driverId: row.driver_id,
    driverName: profileRow?.full_name?.trim() || driver?.driver_code || row.driver_id.slice(0, 8),
    driverCode: driver?.driver_code ?? "—",
    employeeId: driver?.employee_id ?? null,
    isOnDuty: driver?.is_on_duty ?? false,
    isBlocked: driver?.is_blocked ?? false,
    restaurantName: restaurantFromDriver(driver),
    vehicleType: vehicleTypeFromDriverJoin(driver),
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    speedMps: row.speed_mps != null ? Number(row.speed_mps) : null,
    distanceTodayMeters:
      row.distance_today_meters != null ? Number(row.distance_today_meters) : 0,
    accuracyMeters: row.accuracy_meters != null ? Number(row.accuracy_meters) : null,
    batteryPct: row.battery_pct,
    heading: row.heading_deg != null ? Number(row.heading_deg) : null,
    activeDeliveryId: row.active_delivery_id ?? null,
    trackingStatus: parseTrackingStatus(row.tracking_status),
    zoneStatus: parseZoneStatus(row.zone_status),
    lastSeenAt: latestGpsAt(row.last_seen_at, row.last_report_at),
    updatedAt: row.updated_at,
  });
}

export async function fetchLiveDriverLocations(): Promise<DriverLiveLocation[]> {
  await requireDriversView();
  const db = await requireDb();
  const rows = await readQuery((withOrder) => {
    let query: Query = db.collection(COLLECTIONS.driverLocations);
    if (withOrder) query = query.orderBy("last_seen_at", "desc");
    return query;
  });
  rows.sort((a, b) => String(b.last_seen_at ?? "").localeCompare(String(a.last_seen_at ?? "")));

  const driverIds = rows.map((row) => String(row.driver_id ?? "")).filter(Boolean);
  const drivers = await loadByIds(db, COLLECTIONS.drivers, driverIds);
  const profiles = await loadByIds(db, COLLECTIONS.profiles, driverIds);
  const vehicleIds = [...drivers.values()]
    .map((driver) => String(driver.vehicle_id ?? ""))
    .filter(Boolean);
  const vehicles = await loadByIds(db, COLLECTIONS.vehicles, vehicleIds);

  const restaurantByDriver = new Map<string, string>();
  for (let i = 0; i < driverIds.length; i += 30) {
    const chunk = [...new Set(driverIds.slice(i, i + 30))];
    if (chunk.length === 0) continue;
    const snap = await db
      .collection(COLLECTIONS.driverRestaurants)
      .where("driver_id", "in", chunk)
      .get();
    for (const doc of snap.docs) {
      const link = fromDoc(doc.id, doc.data());
      const driverId = String(link.driver_id ?? "");
      const restaurantId = String(link.restaurant_id ?? "");
      if (driverId && restaurantId && !restaurantByDriver.has(driverId)) {
        restaurantByDriver.set(driverId, restaurantId);
      }
    }
  }
  const restaurants = await loadByIds(db, COLLECTIONS.restaurants, [...restaurantByDriver.values()]);

  void logAdminRead("driver_locations", "locations.fetchLive");

  return rows.map((row) => {
    const driverId = String(row.driver_id ?? "");
    const driver = drivers.get(driverId);
    const profile = profiles.get(driverId);
    const vehicle = driver ? vehicles.get(String(driver.vehicle_id ?? "")) : undefined;
    const restaurant = restaurants.get(restaurantByDriver.get(driverId) ?? "");
    return mapLiveRow({
      driver_id: driverId,
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
      speed_mps: row.speed_mps != null ? Number(row.speed_mps) : null,
      distance_today_meters:
        row.distance_today_meters != null ? Number(row.distance_today_meters) : null,
      accuracy_meters: row.accuracy_meters != null ? Number(row.accuracy_meters) : null,
      battery_pct: row.battery_pct != null ? Number(row.battery_pct) : null,
      heading_deg: row.heading_deg != null ? Number(row.heading_deg) : null,
      active_delivery_id: (row.active_delivery_id as string | null) ?? null,
      tracking_status: String(row.tracking_status ?? "idle"),
      zone_status: (row.zone_status as string | null) ?? null,
      last_seen_at: String(row.last_seen_at ?? ""),
      last_report_at: (row.last_report_at as string | null) ?? null,
      updated_at: String(row.updated_at ?? row.last_seen_at ?? ""),
      drivers: driver
        ? {
            driver_code: String(driver.driver_code ?? ""),
            employee_id: (driver.employee_id as string | null) ?? null,
            is_on_duty: driver.is_on_duty === true,
            is_blocked: driver.is_blocked === true,
            vehicle_type_key: (driver.vehicle_type_key as string | null) ?? null,
            vehicles: vehicle
              ? { vehicle_type_key: (vehicle.vehicle_type_key as string | null) ?? null }
              : null,
            profiles: profile
              ? { full_name: (profile.full_name as string | null) ?? null }
              : { full_name: null },
            driver_restaurants: restaurant
              ? [{ restaurants: { name: String(restaurant.name ?? "") } }]
              : [],
          }
        : null,
    });
  });
}

export async function fetchDriverLocationHistory(
  driverId: string,
  fromIso: string,
  toIso: string,
): Promise<DriverLocationEvent[]> {
  await requireDriversView();
  const db = await requireDb();
  const rows = await readQuery((withOrder) => {
    let query: Query = db
      .collection(COLLECTIONS.driverLocationEvents)
      .where("driver_id", "==", driverId)
      .where("recorded_at", ">=", new Date(fromIso))
      .where("recorded_at", "<=", new Date(toIso));
    if (withOrder) query = query.orderBy("recorded_at", "asc");
    return query;
  });
  rows.sort((a, b) => String(a.recorded_at ?? "").localeCompare(String(b.recorded_at ?? "")));

  await logAdminRead("driver_location_events", "locations.fetchHistory", { driverId });

  const events: DriverLocationEvent[] = rows.map((row) => ({
    id: String(row.id),
    driverId: String(row.driver_id ?? driverId),
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    speedMps: row.speed_mps != null ? Number(row.speed_mps) : null,
    accuracyMeters: row.accuracy_meters != null ? Number(row.accuracy_meters) : null,
    batteryPct: row.battery_pct != null ? Number(row.battery_pct) : null,
    trackingStatus: parseTrackingStatus(String(row.tracking_status ?? "idle")),
    zoneStatus: parseZoneStatus((row.zone_status as string | null) ?? null),
    deliveryId: (row.delivery_id as string | null) ?? null,
    recordedAt: String(row.recorded_at ?? ""),
    submitAction: null,
  }));

  const deliveryIds = [
    ...new Set(
      events
        .filter((event) => event.trackingStatus === "delivery_submit" && event.deliveryId)
        .map((event) => event.deliveryId as string),
    ),
  ];
  if (deliveryIds.length === 0) return events;

  try {
    const deliveries = await loadByIds(db, COLLECTIONS.deliveries, deliveryIds);
    return events.map((event) => {
      if (event.trackingStatus !== "delivery_submit" || !event.deliveryId) return event;
      const delivery = deliveries.get(event.deliveryId);
      if (!delivery) return event;
      const submitAction = resolveLocationSubmitAction(event.recordedAt, {
        pickup_at: (delivery.pickup_at as string | null) ?? null,
        delivered_at: (delivery.delivered_at as string | null) ?? null,
        cancelled_at: (delivery.cancelled_at as string | null) ?? null,
      });
      return submitAction ? { ...event, submitAction } : event;
    });
  } catch (error) {
    console.error("[fetchDriverLocationHistory] delivery lookup failed", error);
    return events;
  }
}

const KUWAIT_TZ = "Asia/Kuwait";

function kuwaitDateFromIso(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: KUWAIT_TZ }).format(new Date(iso));
}

function monthIsoBounds(yearMonth: string): { from: string; to: string } {
  const [yearStr, monthStr] = yearMonth.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const lastDay = new Date(year, month, 0).getDate();
  const monthPadded = String(month).padStart(2, "0");
  return {
    from: `${yearStr}-${monthPadded}-01T00:00:00+03:00`,
    to: `${yearStr}-${monthPadded}-${String(lastDay).padStart(2, "0")}T23:59:59.999+03:00`,
  };
}

export async function fetchDriverHistoryActiveDates(
  driverId: string,
  yearMonth: string,
): Promise<string[]> {
  await requireDriversView();
  const db = await requireDb();
  const { from, to } = monthIsoBounds(yearMonth);
  const rows = await readQuery((withOrder) => {
    let query: Query = db
      .collection(COLLECTIONS.driverLocationEvents)
      .where("driver_id", "==", driverId)
      .where("recorded_at", ">=", new Date(from))
      .where("recorded_at", "<=", new Date(to));
    if (withOrder) query = query.orderBy("recorded_at", "asc");
    return query;
  });

  await logAdminRead("driver_location_events", "locations.fetchHistoryDates", { driverId });

  const dates = new Set<string>();
  for (const row of rows) {
    const recorded = String(row.recorded_at ?? "");
    if (recorded) dates.add(kuwaitDateFromIso(recorded));
  }
  return Array.from(dates).sort();
}

function mapLocationEventRow(data: {
  id: string;
  driver_id: string;
  latitude: number | string;
  longitude: number | string;
  speed_mps: number | string | null;
  accuracy_meters: number | string | null;
  battery_pct: number | null;
  heading_deg: number | string | null;
  altitude_m: number | string | null;
  network_type: string | null;
  charging_state: string | null;
  is_mocked: boolean | null;
  location_provider: string | null;
  active_delivery_id: string | null;
  tracking_status: string | null;
  zone_status: string | null;
  delivery_id: string | null;
  recorded_at: string;
}): DriverLocationEvent {
  return {
    id: data.id,
    driverId: data.driver_id,
    latitude: Number(data.latitude),
    longitude: Number(data.longitude),
    speedMps: data.speed_mps != null ? Number(data.speed_mps) : null,
    accuracyMeters: data.accuracy_meters != null ? Number(data.accuracy_meters) : null,
    batteryPct: data.battery_pct,
    headingDeg: data.heading_deg != null ? Number(data.heading_deg) : null,
    altitudeM: data.altitude_m != null ? Number(data.altitude_m) : null,
    networkType: data.network_type,
    chargingState: data.charging_state,
    isMocked: data.is_mocked,
    locationProvider: data.location_provider,
    activeDeliveryId: data.active_delivery_id,
    trackingStatus: parseTrackingStatus(data.tracking_status ?? "idle"),
    zoneStatus: parseZoneStatus(data.zone_status),
    deliveryId: data.delivery_id,
    recordedAt: data.recorded_at,
  };
}

function asEventRow(row: Loose): Parameters<typeof mapLocationEventRow>[0] {
  return {
    id: String(row.id),
    driver_id: String(row.driver_id ?? ""),
    latitude: row.latitude as number | string,
    longitude: row.longitude as number | string,
    speed_mps: (row.speed_mps as number | string | null) ?? null,
    accuracy_meters: (row.accuracy_meters as number | string | null) ?? null,
    battery_pct: row.battery_pct != null ? Number(row.battery_pct) : null,
    heading_deg: (row.heading_deg as number | string | null) ?? null,
    altitude_m: (row.altitude_m as number | string | null) ?? null,
    network_type: (row.network_type as string | null) ?? null,
    charging_state: (row.charging_state as string | null) ?? null,
    is_mocked: (row.is_mocked as boolean | null) ?? null,
    location_provider: (row.location_provider as string | null) ?? null,
    active_delivery_id: (row.active_delivery_id as string | null) ?? null,
    tracking_status: (row.tracking_status as string | null) ?? null,
    zone_status: (row.zone_status as string | null) ?? null,
    delivery_id: (row.delivery_id as string | null) ?? null,
    recorded_at: String(row.recorded_at ?? ""),
  };
}

async function eventsForColumn(
  db: Firestore,
  column: "delivery_id" | "active_delivery_id",
  deliveryId: string,
  limit: number,
  direction: "asc" | "desc",
): Promise<Loose[]> {
  const rows = await readQuery((withOrder) => {
    let query: Query = db
      .collection(COLLECTIONS.driverLocationEvents)
      .where(column, "==", deliveryId);
    if (withOrder) query = query.orderBy("recorded_at", direction);
    return query.limit(limit);
  });
  rows.sort((a, b) => {
    const delta = String(a.recorded_at ?? "").localeCompare(String(b.recorded_at ?? ""));
    return direction === "asc" ? delta : -delta;
  });
  return rows.slice(0, limit);
}

async function requireDeliveriesView() {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, "deliveries.view", session.isSuperAdmin)
  ) {
    throw new Error("not_authorized");
  }
}

export async function fetchLocationEventByDeliveryId(
  deliveryId: string,
): Promise<DriverLocationEvent | null> {
  await requireDeliveriesView();
  const db = await requireDb();
  const [byDelivery, byActive] = await Promise.all([
    eventsForColumn(db, "delivery_id", deliveryId, 1, "desc"),
    eventsForColumn(db, "active_delivery_id", deliveryId, 1, "desc"),
  ]);
  const events = [...byDelivery, ...byActive].map((row) => mapLocationEventRow(asEventRow(row)));
  if (events.length === 0) return null;
  events.sort((a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime());
  return events[0] ?? null;
}

export async function fetchLocationEventsForDelivery(
  deliveryId: string,
): Promise<DriverLocationEvent[]> {
  await requireDeliveriesView();
  const db = await requireDb();
  const [byDelivery, byActive] = await Promise.all([
    eventsForColumn(db, "delivery_id", deliveryId, 500, "asc"),
    eventsForColumn(db, "active_delivery_id", deliveryId, 500, "asc"),
  ]);
  const byId = new Map<string, DriverLocationEvent>();
  for (const row of [...byDelivery, ...byActive]) {
    const mapped = mapLocationEventRow(asEventRow(row));
    byId.set(mapped.id, mapped);
  }
  return [...byId.values()].sort(
    (a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime(),
  );
}

export async function fetchTrackedDriverCount(): Promise<number> {
  await requireDriversView();
  const db = await requireDb();
  const snap = await db.collection(COLLECTIONS.driverLocations).count().get();
  return snap.data().count;
}

export async function fetchDriverAssignedRestaurantPins(
  driverId: string,
): Promise<
  Array<{
    id: string;
    name: string;
    latitude: number;
    longitude: number;
    map_link: string | null;
  }>
> {
  await requireDriversView();
  if (!driverId) return [];
  const db = await requireDb();
  const links = await readQuery(() =>
    db.collection(COLLECTIONS.driverRestaurants).where("driver_id", "==", driverId),
  );
  const ids = [...new Set(links.map((link) => String(link.restaurant_id ?? "")).filter(Boolean))];
  if (ids.length === 0) return [];

  const loaded = await loadByIds(db, COLLECTIONS.restaurants, ids);
  const all = [...loaded.values()];
  const usable = (row: Loose) => {
    const latitude = Number(row.latitude);
    const longitude = Number(row.longitude);
    return (
      row.latitude != null &&
      row.longitude != null &&
      Number.isFinite(latitude) &&
      Number.isFinite(longitude) &&
      Math.abs(latitude) <= 90 &&
      Math.abs(longitude) <= 180
    );
  };
  let restaurants = all.filter(
    (row) => row.status === "published" && row.is_active === true && usable(row),
  );
  if (restaurants.length === 0) {
    restaurants = all.filter((row) => row.is_active === true && usable(row));
  }

  return restaurants.map((row) => ({
    id: String(row.id),
    name: String(row.name ?? ""),
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    map_link: (row.map_link as string | null) ?? null,
  }));
}

/** Cron: delete off-duty GPS rows older than 10 minutes. On-duty last-known stays. */
export async function cleanupStaleDriverLocations(): Promise<number> {
  const { data, error } = await callCronFunction<number>("cleanup_stale_driver_locations", {
    p_max_age: "10 minutes",
  });
  if (error) throw new Error(error.message);
  return typeof data === "number" ? data : 0;
}
