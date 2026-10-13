"use client";

import { shouldRunBackgroundWork } from "@/lib/browser/visibility";

import { fetchLiveDriverLocations } from "./locations-actions";
import { enrichLiveLocation, shouldShowOnLiveMap } from "./location-status";
import type { DriverLiveLocation } from "./types";

type Listener = (locations: DriverLiveLocation[]) => void;

/** Full snapshot while the page is open — pins must not freeze until refresh. */
const RESYNC_MS = 15_000;
const LIVE_CAP = 2500;

let resyncTimer: ReturnType<typeof setInterval> | null = null;
let visibilityBound = false;
let listeners = new Set<Listener>();
let cacheById = new Map<string, DriverLiveLocation>();
let inFlightLoad: Promise<void> | null = null;
let nameCache = new Map<
  string,
  {
    driverName: string;
    driverCode: string;
    employeeId: string | null;
    isOnDuty: boolean;
    isBlocked: boolean;
    restaurantName: string | null;
    vehicleType: DriverLiveLocation["vehicleType"];
  }
>();

function snapshot(): DriverLiveLocation[] {
  return Array.from(cacheById.values());
}

function notifyNow() {
  const snap = snapshot();
  for (const listener of listeners) {
    listener(snap);
  }
}

async function loadInitial() {
  try {
    const rows = (await fetchLiveDriverLocations()).slice(0, LIVE_CAP);
    const previous = cacheById;
    const next = new Map<string, DriverLiveLocation>();
    for (const row of rows) {
      if (!shouldShowOnLiveMap(row)) continue;
      const prev = previous.get(row.driverId);
      const { pinStatus: _pin, ...rest } = row;
      const loc = prev ? enrichLiveLocation(rest, prev) : row;
      nameCache.set(loc.driverId, {
        driverName: loc.driverName,
        driverCode: loc.driverCode,
        employeeId: loc.employeeId,
        isOnDuty: loc.isOnDuty,
        isBlocked: loc.isBlocked,
        restaurantName: loc.restaurantName,
        vehicleType: loc.vehicleType,
      });
      next.set(loc.driverId, loc);
    }
    cacheById = next;
    notifyNow();
  } catch (error) {
    console.error("[driver_locations] initial fetch failed", error);
  }
}

/**
 * One read at a time. `loadInitial` is idempotent, so a concurrent second call can only
 * replace the first one's result with an identical one.
 */
function requestLoad(): Promise<void> {
  if (inFlightLoad) return inFlightLoad;
  inFlightLoad = loadInitial().finally(() => {
    inFlightLoad = null;
  });
  return inFlightLoad;
}

function ensureResync() {
  if (resyncTimer != null) return;
  resyncTimer = setInterval(() => {
    if (listeners.size === 0) return;
    if (!shouldRunBackgroundWork(typeof document === "undefined" ? undefined : document)) {
      return;
    }
    void requestLoad();
  }, RESYNC_MS);
}

function onVisibilityReturn() {
  if (typeof document === "undefined" || document.hidden) return;
  if (listeners.size === 0) return;
  void requestLoad();
}

function ensureVisibilityBinding() {
  if (visibilityBound || typeof document === "undefined") return;
  document.addEventListener("visibilitychange", onVisibilityReturn);
  visibilityBound = true;
}

function releaseVisibilityBinding() {
  if (!visibilityBound || typeof document === "undefined") return;
  document.removeEventListener("visibilitychange", onVisibilityReturn);
  visibilityBound = false;
}

export function subscribeDriverLocations(listener: Listener): () => void {
  listeners.add(listener);
  listener(snapshot());

  ensureResync();
  ensureVisibilityBinding();
  void requestLoad();

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      if (resyncTimer != null) {
        clearInterval(resyncTimer);
        resyncTimer = null;
      }
      releaseVisibilityBinding();
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
    isBlocked?: boolean;
  }>,
) {
  for (const entry of entries) {
    nameCache.set(entry.driverId, {
      driverName: entry.driverName,
      driverCode: entry.driverCode,
      employeeId: entry.employeeId ?? null,
      isOnDuty: entry.isOnDuty ?? false,
      isBlocked: entry.isBlocked ?? false,
      restaurantName: null,
      vehicleType: "bike",
    });
  }
}
