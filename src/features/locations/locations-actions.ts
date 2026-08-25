"use server";

import { logAdminRead } from "@/lib/audit/log-admin-activity";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveLocationSubmitAction } from "./location-event-display";
import {
  enrichLiveLocation,
  latestGpsAt,
  parseTrackingStatus,
  parseZoneStatus,
} from "./location-status";
import { vehicleTypeFromDriverJoin } from "@/features/vehicles/vehicle-type";
import type { DriverLiveLocation, DriverLocationEvent } from "./types";

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
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("driver_locations")
    .select(
      `
      driver_id,
      latitude,
      longitude,
      speed_mps,
      distance_today_meters,
      accuracy_meters,
      battery_pct,
      heading_deg,
      active_delivery_id,
      tracking_status,
      zone_status,
      last_seen_at,
      last_report_at,
      updated_at,
      drivers (
        driver_code,
        employee_id,
        is_on_duty,
        is_blocked,
        vehicle_type_key,
        vehicles ( vehicle_type_key ),
        profiles ( full_name ),
        driver_restaurants (
          restaurants ( name )
        )
      )
    `,
    )
    .order("last_seen_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  void logAdminRead("driver_locations", "locations.fetchLive");

  return (data ?? []).map((row) => mapLiveRow(row as Parameters<typeof mapLiveRow>[0]));
}

export async function fetchDriverLocationHistory(
  driverId: string,
  fromIso: string,
  toIso: string,
): Promise<DriverLocationEvent[]> {
  await requireDriversView();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("driver_location_events")
    .select(
      "id, driver_id, latitude, longitude, speed_mps, accuracy_meters, battery_pct, tracking_status, zone_status, delivery_id, recorded_at",
    )
    .eq("driver_id", driverId)
    .gte("recorded_at", fromIso)
    .lte("recorded_at", toIso)
    .order("recorded_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  await logAdminRead("driver_location_events", "locations.fetchHistory", { driverId });

  const events = (data ?? []).map((row) => ({
    id: row.id,
    driverId: row.driver_id,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    speedMps: row.speed_mps != null ? Number(row.speed_mps) : null,
    accuracyMeters: row.accuracy_meters != null ? Number(row.accuracy_meters) : null,
    batteryPct: row.battery_pct,
    trackingStatus: parseTrackingStatus(row.tracking_status),
    zoneStatus: parseZoneStatus(row.zone_status),
    deliveryId: row.delivery_id,
    recordedAt: row.recorded_at,
    submitAction: null,
  }));

  const deliveryIds = [
    ...new Set(
      events
        .filter((e) => e.trackingStatus === "delivery_submit" && e.deliveryId)
        .map((e) => e.deliveryId as string),
    ),
  ];

  if (deliveryIds.length === 0) return events;

  const { data: deliveries, error: deliveryError } = await supabase
    .from("deliveries")
    .select("id, pickup_at, delivered_at, cancelled_at")
    .in("id", deliveryIds);

  if (deliveryError) {
    console.error("[fetchDriverLocationHistory] delivery lookup failed", deliveryError);
    return events;
  }

  const deliveryById = new Map(
    (deliveries ?? []).map((d) => [
      (d as { id: string }).id,
      d as {
        id: string;
        pickup_at: string | null;
        delivered_at: string | null;
        cancelled_at: string | null;
      },
    ]),
  );

  return events.map((event) => {
    if (event.trackingStatus !== "delivery_submit" || !event.deliveryId) return event;
    const delivery = deliveryById.get(event.deliveryId);
    const submitAction = resolveLocationSubmitAction(event.recordedAt, delivery);
    return submitAction ? { ...event, submitAction } : event;
  });
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
  const supabase = await createClient();
  const { from, to } = monthIsoBounds(yearMonth);

  const { data, error } = await supabase
    .from("driver_location_events")
    .select("recorded_at")
    .eq("driver_id", driverId)
    .gte("recorded_at", from)
    .lte("recorded_at", to);

  if (error) {
    throw new Error(error.message);
  }

  await logAdminRead("driver_location_events", "locations.fetchHistoryDates", { driverId });

  const dates = new Set<string>();
  for (const row of data ?? []) {
    dates.add(kuwaitDateFromIso(row.recorded_at));
  }
  return Array.from(dates).sort();
}

export async function fetchLocationEventByDeliveryId(
  deliveryId: string,
): Promise<DriverLocationEvent | null> {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, "deliveries.view", session.isSuperAdmin)
  ) {
    throw new Error("not_authorized");
  }

  const admin = createAdminClient() as unknown as {
    from: (table: string) => {
      select: (columns: string) => Record<string, unknown>;
    };
  };

  const selectColumns =
    "id, driver_id, latitude, longitude, speed_mps, accuracy_meters, battery_pct, heading_deg, altitude_m, network_type, charging_state, is_mocked, location_provider, active_delivery_id, tracking_status, zone_status, delivery_id, recorded_at";

  type SingleEventQuery = {
    eq: (
      column: string,
      value: string,
    ) => {
      order: (
        column: string,
        options: { ascending: boolean },
      ) => {
        limit: (count: number) => {
          maybeSingle: () => Promise<{
            data: Record<string, unknown> | null;
            error: { message: string } | null;
          }>;
        };
      };
    };
  };

  const fetchLatest = async (column: "delivery_id" | "active_delivery_id") => {
    const q = admin.from("driver_location_events").select(selectColumns) as SingleEventQuery;
    return q
      .eq(column, deliveryId)
      .order("recorded_at", { ascending: false })
      .limit(1)
      .maybeSingle();
  };

  const [{ data: byDelivery, error: err1 }, { data: byActive, error: err2 }] =
    await Promise.all([fetchLatest("delivery_id"), fetchLatest("active_delivery_id")]);

  if (err1) throw new Error(err1.message);
  if (err2) throw new Error(err2.message);

  const events: DriverLocationEvent[] = [];
  if (byDelivery) {
    events.push(
      mapLocationEventRow(byDelivery as unknown as Parameters<typeof mapLocationEventRow>[0]),
    );
  }
  if (byActive) {
    events.push(
      mapLocationEventRow(byActive as unknown as Parameters<typeof mapLocationEventRow>[0]),
    );
  }

  if (events.length === 0) return null;

  events.sort(
    (a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime(),
  );
  return events[0] ?? null;
}

export async function fetchLocationEventsForDelivery(
  deliveryId: string,
): Promise<DriverLocationEvent[]> {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, "deliveries.view", session.isSuperAdmin)
  ) {
    throw new Error("not_authorized");
  }

  const admin = createAdminClient() as unknown as {
    from: (table: string) => {
      select: (columns: string) => Record<string, unknown>;
    };
  };

  const selectColumns =
    "id, driver_id, latitude, longitude, speed_mps, accuracy_meters, battery_pct, heading_deg, altitude_m, network_type, charging_state, is_mocked, location_provider, active_delivery_id, tracking_status, zone_status, delivery_id, recorded_at";

  type ListEventQuery = {
    eq: (
      column: string,
      value: string,
    ) => {
      order: (
        column: string,
        options: { ascending: boolean },
      ) => {
        limit: (count: number) => Promise<{
          data: Array<Record<string, unknown>> | null;
          error: { message: string } | null;
        }>;
      };
    };
  };

  const fetchAll = async (column: "delivery_id" | "active_delivery_id") => {
    const q = admin.from("driver_location_events").select(selectColumns) as ListEventQuery;
    return q.eq(column, deliveryId).order("recorded_at", { ascending: true }).limit(500);
  };

  const [{ data: byDelivery, error: err1 }, { data: byActive, error: err2 }] =
    await Promise.all([fetchAll("delivery_id"), fetchAll("active_delivery_id")]);

  if (err1) throw new Error(err1.message);
  if (err2) throw new Error(err2.message);

  const byId = new Map<string, DriverLocationEvent>();
  for (const row of [...(byDelivery ?? []), ...(byActive ?? [])]) {
    const mapped = mapLocationEventRow(
      row as unknown as Parameters<typeof mapLocationEventRow>[0],
    );
    byId.set(mapped.id, mapped);
  }
  return [...byId.values()].sort(
    (a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime(),
  );
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

export async function fetchTrackedDriverCount(): Promise<number> {
  await requireDriversView();
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("driver_locations")
    .select("driver_id", { count: "exact", head: true });

  if (error) throw new Error(error.message);
  return count ?? 0;
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

  const supabase = await createClient();
  const { data: links, error: linkErr } = await supabase
    .from("driver_restaurants")
    .select("restaurant_id")
    .eq("driver_id", driverId);
  if (linkErr) throw new Error(linkErr.message);

  const ids = [...new Set((links ?? []).map((l) => l.restaurant_id).filter(Boolean))];
  if (ids.length === 0) return [];

  // Prefer published + active; fall back to any active with coordinates so
  // Live Tracking still shows the assigned pin when ops data is partial.
  const baseSelect = "id, name, latitude, longitude, map_link, status, is_active";

  const { data: preferred, error } = await supabase
    .from("restaurants")
    .select(baseSelect)
    .in("id", ids)
    .eq("status", "published")
    .eq("is_active", true);
  if (error) throw new Error(error.message);

  let restaurants = preferred ?? [];
  if (restaurants.length === 0) {
    const { data: fallback, error: fbErr } = await supabase
      .from("restaurants")
      .select(baseSelect)
      .in("id", ids)
      .eq("is_active", true);
    if (fbErr) throw new Error(fbErr.message);
    restaurants = fallback ?? [];
  }

  return restaurants
    .filter(
      (r) =>
        r.latitude != null &&
        r.longitude != null &&
        Number.isFinite(Number(r.latitude)) &&
        Number.isFinite(Number(r.longitude)) &&
        Math.abs(Number(r.latitude)) <= 90 &&
        Math.abs(Number(r.longitude)) <= 180,
    )
    .map((r) => ({
      id: r.id,
      name: r.name,
      latitude: Number(r.latitude),
      longitude: Number(r.longitude),
      map_link: r.map_link,
    }));
}

/** Cron: delete off-duty GPS rows older than 10 minutes. On-duty last-known stays. */
export async function cleanupStaleDriverLocations(): Promise<number> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("cleanup_stale_driver_locations", {
    p_max_age: "10 minutes",
  });
  if (error) throw error;
  return typeof data === "number" ? data : 0;
}
