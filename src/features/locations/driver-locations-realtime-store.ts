"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/types/database";
import {
  enrichLiveLocation,
  isGpsLive,
  parseTrackingStatus,
  parseZoneStatus,
  shouldShowOnLiveMap,
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

/** Coalesce realtime floods so React + maps update at most ~4×/sec. */
const NOTIFY_BATCH_MS = 250;
let channel: RealtimeChannel | null = null;
let listeners = new Set<Listener>();
/** O(1) live upserts under high write volume. */
let cacheById = new Map<string, DriverLiveLocation>();
let fetchPromise: Promise<void> | null = null;
let notifyTimer: ReturnType<typeof setTimeout> | null = null;
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

function restaurantFromDriver(driver: LiveRow["drivers"]): string | null {
  const links = driver?.driver_restaurants;
  if (!links?.length) return null;
  const rest = links[0]?.restaurants;
  const row = Array.isArray(rest) ? rest[0] : rest;
  return row?.name ?? null;
}

function snapshot(): DriverLiveLocation[] {
  return Array.from(cacheById.values());
}

function scheduleNotify() {
  if (notifyTimer != null) return;
  notifyTimer = setTimeout(() => {
    notifyTimer = null;
    const snap = snapshot();
    for (const listener of listeners) {
      listener(snap);
    }
  }, NOTIFY_BATCH_MS);
}

function notifyNow() {
  if (notifyTimer != null) {
    clearTimeout(notifyTimer);
    notifyTimer = null;
  }
  const snap = snapshot();
  for (const listener of listeners) {
    listener(snap);
  }
}

function rowToLocation(row: LiveRow): DriverLiveLocation {
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

/** Skip no-op payloads (same coords / status) that still flood realtime after coalescing edges. */
function meaningfullyChanged(prev: DriverLiveLocation | undefined, next: DriverLiveLocation): boolean {
  if (!prev) return true;
  if (prev.trackingStatus !== next.trackingStatus) return true;
  if (prev.zoneStatus !== next.zoneStatus) return true;
  if (prev.pinStatus !== next.pinStatus) return true;
  if (prev.isOnDuty !== next.isOnDuty) return true;
  // ~1.1m at equator — ignore GPS jitter smaller than this for UI invalidation.
  if (Math.abs(prev.latitude - next.latitude) > 0.00001) return true;
  if (Math.abs(prev.longitude - next.longitude) > 0.00001) return true;
  if ((prev.speedMps ?? 0) !== (next.speedMps ?? 0)) return true;
  if (prev.batteryPct !== next.batteryPct) return true;
  // Always accept fresher lastSeen for idle heartbeats so age badges stay accurate
  // without forcing a position re-layout if coords unchanged.
  if (prev.lastSeenAt !== next.lastSeenAt) {
    const prevTs = new Date(prev.lastSeenAt).getTime();
    const nextTs = new Date(next.lastSeenAt).getTime();
    // Only push if age-sensitive fields matter later (every 20s+)
    if (Math.abs(nextTs - prevTs) >= 20_000) return true;
  }
  return false;
}

function patchDriverDuty(driverId: string, isOnDuty: boolean) {
  const meta = nameCache.get(driverId);
  if (meta) {
    nameCache.set(driverId, { ...meta, isOnDuty });
  }

  const prev = cacheById.get(driverId);
  if (!prev || prev.isOnDuty === isOnDuty) return;

  const { pinStatus: _pin, ...rest } = prev;
  cacheById.set(driverId, enrichLiveLocation({ ...rest, isOnDuty }));
  scheduleNotify();
}

async function loadInitial() {
  const supabase = createClient();
  const select = `
      *,
      drivers (
        driver_code,
        employee_id,
        is_on_duty,
        profiles ( full_name ),
        driver_restaurants ( restaurants ( name ) )
      )
    `;

  const { data, error } = await supabase
    .from("driver_locations")
    .select(select)
    .order("last_seen_at", { ascending: false })
    .limit(2500);

  if (error) {
    console.error("[driver_locations] initial fetch failed", error);
    return;
  }

  const next = new Map<string, DriverLiveLocation>();
  for (const row of data ?? []) {
    const loc = rowToLocation(row as LiveRow);
    if (!shouldShowOnLiveMap(loc)) continue;
    next.set(loc.driverId, loc);
  }
  cacheById = next;
  notifyNow();
}

function applyPayload(
  eventType: "INSERT" | "UPDATE" | "DELETE",
  row: LiveRow | null,
  oldRow: { driver_id: string } | null,
) {
  if (eventType === "DELETE") {
    const id = oldRow?.driver_id ?? row?.driver_id;
    if (!id) return;
    if (!cacheById.has(id)) return;
    cacheById.delete(id);
    scheduleNotify();
    return;
  }

  if (!row?.driver_id) return;

  // Drop extremely stale realtime events if connection backlog delivers late,
  // unless we already have a last-known pin — keep it for Offline / on-duty.
  if (row.last_seen_at && !isGpsLive(row.last_seen_at)) {
    const prev = cacheById.get(row.driver_id);
    const onDuty =
      nameCache.get(row.driver_id)?.isOnDuty ?? prev?.isOnDuty ?? false;
    if (!onDuty && !prev) {
      return;
    }
  }

  const prev = cacheById.get(row.driver_id);
  const next = rowToLocation(row);
  const merged: DriverLiveLocation = prev
    ? {
        ...next,
        driverName:
          next.driverName && next.driverName !== row.driver_id.slice(0, 8)
            ? next.driverName
            : prev.driverName,
        driverCode: next.driverCode !== "—" ? next.driverCode : prev.driverCode,
        employeeId: next.employeeId ?? prev.employeeId,
        isOnDuty: nameCache.get(row.driver_id)?.isOnDuty ?? prev.isOnDuty,
        restaurantName: next.restaurantName ?? prev.restaurantName,
      }
    : next;

  if (!meaningfullyChanged(prev, merged)) {
    // Still refresh lastSeen quietly for age math without React work.
    if (prev && prev.lastSeenAt !== merged.lastSeenAt) {
      cacheById.set(merged.driverId, { ...prev, lastSeenAt: merged.lastSeenAt, updatedAt: merged.updatedAt });
    }
    return;
  }

  cacheById.set(merged.driverId, merged);
  scheduleNotify();
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
  listener(snapshot());

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
      if (notifyTimer != null) {
        clearTimeout(notifyTimer);
        notifyTimer = null;
      }
    }
  };
}

export function getCachedDriverLocations(): DriverLiveLocation[] {
  return snapshot();
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
