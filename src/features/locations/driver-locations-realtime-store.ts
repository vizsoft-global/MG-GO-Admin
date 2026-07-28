"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/types/database";
import {
  enrichLiveLocation,
  parseTrackingStatus,
  parseZoneStatus,
} from "./location-status";
import type { DriverLiveLocation } from "./types";

type LiveRow = Database["public"]["Tables"]["driver_locations"]["Row"] & {
  drivers?: {
    driver_code: string;
    employee_id: string | null;
    is_on_duty: boolean;
    profiles?: { full_name: string | null } | { full_name: string | null }[] | null;
    driver_restaurants?: Array<{
      restaurants?: { name: string } | { name: string }[] | null;
    }>;
  } | null;
};

type Listener = (locations: DriverLiveLocation[]) => void;

let channel: RealtimeChannel | null = null;
let listeners = new Set<Listener>();
let cache: DriverLiveLocation[] = [];
let fetchPromise: Promise<void> | null = null;
let nameCache = new Map<
  string,
  {
    driverName: string;
    driverCode: string;
    employeeId: string | null;
    isOnDuty: boolean;
    restaurantName: string | null;
  }
>();

function profileName(
  profiles:
    | { full_name: string | null }
    | { full_name: string | null }[]
    | null
    | undefined,
): string | null {
  if (!profiles) return null;
  const row = Array.isArray(profiles) ? profiles[0] : profiles;
  return row?.full_name?.trim() ?? null;
}

function restaurantFromDriver(
  driver: LiveRow["drivers"],
): string | null {
  const links = driver?.driver_restaurants;
  if (!links?.length) return null;
  const rest = links[0]?.restaurants;
  const row = Array.isArray(rest) ? rest[0] : rest;
  return row?.name ?? null;
}

function rowToLocation(row: LiveRow): DriverLiveLocation {
  const meta = nameCache.get(row.driver_id);
  const driver = row.drivers;

  if (driver) {
    nameCache.set(row.driver_id, {
      driverName:
        profileName(driver.profiles) ?? driver.driver_code ?? row.driver_id.slice(0, 8),
      driverCode: driver.driver_code,
      employeeId: driver.employee_id,
      isOnDuty: driver.is_on_duty,
      restaurantName: restaurantFromDriver(driver),
    });
  }

  const names = nameCache.get(row.driver_id);

  return enrichLiveLocation({
    driverId: row.driver_id,
    driverName: names?.driverName ?? row.driver_id.slice(0, 8),
    driverCode: names?.driverCode ?? "—",
    employeeId: names?.employeeId ?? null,
    isOnDuty: names?.isOnDuty ?? false,
    restaurantName: names?.restaurantName ?? restaurantFromDriver(driver),
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    speedMps: row.speed_mps != null ? Number(row.speed_mps) : null,
    distanceTodayMeters:
      row.distance_today_meters != null ? Number(row.distance_today_meters) : 0,
    accuracyMeters: row.accuracy_meters != null ? Number(row.accuracy_meters) : null,
    batteryPct: row.battery_pct,
    heading: row.heading_deg != null ? Number(row.heading_deg) : null,
    trackingStatus: parseTrackingStatus(row.tracking_status),
    zoneStatus: parseZoneStatus(row.zone_status),
    lastSeenAt: row.last_seen_at,
    updatedAt: row.updated_at,
  });
}

function notify() {
  const snapshot = [...cache];
  for (const listener of listeners) {
    listener(snapshot);
  }
}

function patchDriverDuty(driverId: string, isOnDuty: boolean) {
  const meta = nameCache.get(driverId);
  if (meta) {
    nameCache.set(driverId, { ...meta, isOnDuty });
  }

  const idx = cache.findIndex((loc) => loc.driverId === driverId);
  if (idx < 0) return;

  cache = [
    ...cache.slice(0, idx),
    { ...cache[idx]!, isOnDuty },
    ...cache.slice(idx + 1),
  ];
  notify();
}

async function loadInitial() {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("driver_locations")
    .select(
      `
      *,
      drivers (
        driver_code,
        employee_id,
        is_on_duty,
        profiles ( full_name ),
        driver_restaurants ( restaurants ( name ) )
      )
    `,
    )
    .order("last_seen_at", { ascending: false });

  if (error) {
    console.error("[driver_locations] initial fetch failed", error);
    return;
  }

  cache = (data ?? []).map((row) => rowToLocation(row as LiveRow));
  notify();
}

function applyPayload(
  eventType: "INSERT" | "UPDATE" | "DELETE",
  row: LiveRow | null,
  oldRow: { driver_id: string } | null,
) {
  if (eventType === "DELETE") {
    const id = oldRow?.driver_id ?? row?.driver_id;
    if (!id) return;
    cache = cache.filter((l) => l.driverId !== id);
    notify();
    return;
  }

  if (!row) return;
  const next = rowToLocation(row);
  const idx = cache.findIndex((l) => l.driverId === next.driverId);
  if (idx >= 0) {
    cache = [...cache.slice(0, idx), next, ...cache.slice(idx + 1)];
  } else {
    cache = [...cache, next];
  }
  notify();
}

function ensureChannel() {
  if (channel) return;

  const supabase = createClient();
  channel = supabase
    .channel("admin-driver-locations")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "driver_locations" },
      (payload) => {
        applyPayload(
          payload.eventType as "INSERT" | "UPDATE" | "DELETE",
          payload.new as LiveRow | null,
          payload.old as { driver_id: string } | null,
        );
      },
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "drivers" },
      (payload) => {
        const row = payload.new as { id?: string; is_on_duty?: boolean } | null;
        if (row?.id && typeof row.is_on_duty === "boolean") {
          patchDriverDuty(row.id, row.is_on_duty);
        }
      },
    )
    .subscribe();
}

export function subscribeDriverLocations(listener: Listener): () => void {
  listeners.add(listener);
  listener(cache);

  ensureChannel();

  if (!fetchPromise) {
    fetchPromise = loadInitial().finally(() => {
      fetchPromise = null;
    });
  }

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && channel) {
      void createClient().removeChannel(channel);
      channel = null;
    }
  };
}

export function getCachedDriverLocations(): DriverLiveLocation[] {
  return cache;
}

export function seedDriverLocationNames(
  entries: Array<{
    driverId: string;
    driverName: string;
    driverCode: string;
    employeeId?: string | null;
    isOnDuty?: boolean;
  }>,
) {
  for (const e of entries) {
    nameCache.set(e.driverId, {
      driverName: e.driverName,
      driverCode: e.driverCode,
      employeeId: e.employeeId ?? null,
      isOnDuty: e.isOnDuty ?? false,
      restaurantName: null,
    });
  }
}
