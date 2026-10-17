"use client";

import { shouldRunBackgroundWork } from "@/lib/browser/visibility";
import type { FleetSocketTicket } from "@/features/live-tracking-v2/fleet-token";
import {
  decodePosition,
  type ClientFrame,
  type PositionTuple,
  type ServerFrame,
} from "@/features/live-tracking-v2/fleet-wire";

import { fetchLiveDriverLocations } from "./locations-actions";
import { enrichLiveLocation, shouldShowOnLiveMap } from "./location-status";
import type { DriverLiveLocation, TrackingStatus } from "./types";

type Listener = (locations: DriverLiveLocation[]) => void;

/** Full snapshot while the page is open and the room socket is down — pins must not freeze. */
const RESYNC_MS = 15_000;
/** With the socket live, the snapshot only refreshes roster facts the delta stream never carries. */
const EDGE_RESYNC_MS = 120_000;
const EDGE_NOTIFY_MS = 1_000;
const EDGE_PING_MS = 25_000;
const EDGE_RETRY_MAX_MS = 60_000;
const LIVE_CAP = 2500;

let resyncTimer: ReturnType<typeof setInterval> | null = null;
let lastLoadAt = 0;
let edgeSocket: WebSocket | null = null;
let edgeLive = false;
let edgeDisabled = false;
let edgeAttempts = 0;
let edgePing: ReturnType<typeof setInterval> | null = null;
let edgeRetry: ReturnType<typeof setTimeout> | null = null;
let edgeNotify: ReturnType<typeof setTimeout> | null = null;
let edgeIdByIdx = new Map<number, string>();
let visibilityBound = false;
const listeners = new Set<Listener>();
let cacheById = new Map<string, DriverLiveLocation>();
let inFlightLoad: Promise<void> | null = null;
const nameCache = new Map<
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
  lastLoadAt = Date.now();
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
    if (edgeLive && Date.now() - lastLoadAt < EDGE_RESYNC_MS) return;
    void requestLoad();
  }, RESYNC_MS);
}

function scheduleEdgeNotify() {
  if (edgeNotify != null) return;
  edgeNotify = setTimeout(() => {
    edgeNotify = null;
    notifyNow();
  }, EDGE_NOTIFY_MS);
}

function trackingFromFleet(status: string, fallback: TrackingStatus): TrackingStatus {
  if (status === "moving") return "moving";
  if (status === "idle") return "idle";
  if (status === "on_delivery") return "delivery_submit";
  return fallback;
}

function applyEdgeDelta(serverTs: number, entries: PositionTuple[]) {
  let changed = false;
  for (const tuple of entries) {
    const driverId = edgeIdByIdx.get(tuple[0]);
    if (!driverId) continue;
    const prev = cacheById.get(driverId);
    if (!prev) continue;
    const pos = decodePosition(tuple);
    const seenAt = new Date(serverTs - pos.ageMs).toISOString();
    if (seenAt <= prev.lastSeenAt) continue;
    const { pinStatus: _pin, ...rest } = prev;
    cacheById.set(
      driverId,
      enrichLiveLocation(
        {
          ...rest,
          latitude: pos.lat,
          longitude: pos.lng,
          speedMps: pos.speedMps,
          heading: pos.headingKnown ? pos.headingDeg : prev.heading,
          trackingStatus: trackingFromFleet(pos.status, prev.trackingStatus),
          isOnDuty: pos.flags.on_duty,
          lastSeenAt: seenAt,
          updatedAt: seenAt,
        },
        prev,
      ),
    );
    changed = true;
  }
  if (changed) scheduleEdgeNotify();
}

function handleEdgeFrame(frame: ServerFrame) {
  switch (frame.t) {
    case "meta":
      for (const meta of frame.drivers) edgeIdByIdx.set(meta.idIdx, meta.driverId);
      return;
    case "delta":
      applyEdgeDelta(frame.ts, frame.e);
      return;
    case "hello":
    case "trail":
    case "events":
    case "ops":
    case "pong":
    case "error":
      return;
    default: {
      const unreachable: never = frame;
      return unreachable;
    }
  }
}

function clearEdgeTimers() {
  if (edgePing != null) clearInterval(edgePing);
  if (edgeRetry != null) clearTimeout(edgeRetry);
  if (edgeNotify != null) clearTimeout(edgeNotify);
  edgePing = null;
  edgeRetry = null;
  edgeNotify = null;
}

function closeEdge() {
  clearEdgeTimers();
  edgeLive = false;
  const socket = edgeSocket;
  edgeSocket = null;
  if (socket) {
    socket.onclose = null;
    socket.close();
  }
}

function scheduleEdgeRetry() {
  if (edgeDisabled || listeners.size === 0 || edgeRetry != null) return;
  const delay = Math.min(EDGE_RETRY_MAX_MS, 5_000 * 2 ** Math.min(edgeAttempts, 4));
  edgeRetry = setTimeout(() => {
    edgeRetry = null;
    void connectEdge();
  }, delay);
}

async function connectEdge() {
  if (edgeDisabled || edgeSocket || listeners.size === 0 || typeof WebSocket === "undefined") return;
  let ticket: FleetSocketTicket | { error: string };
  try {
    const response = await fetch("/api/live-tracking-v2/token", { method: "POST" });
    if (response.ok) {
      ticket = (await response.json()) as FleetSocketTicket;
    } else {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      ticket = { error: body?.error ?? `token_${response.status}` };
    }
  } catch (error) {
    ticket = { error: String(error) };
  }
  if ("error" in ticket) {
    if (ticket.error === "fleet_edge_not_configured" || ticket.error === "not_authorized") {
      edgeDisabled = true;
      return;
    }
    edgeAttempts += 1;
    scheduleEdgeRetry();
    return;
  }
  if (listeners.size === 0 || edgeSocket) return;

  const socket = new WebSocket(`${ticket.wsUrl}?token=${encodeURIComponent(ticket.token)}`);
  edgeSocket = socket;
  socket.onopen = () => {
    edgeAttempts = 0;
    edgeLive = true;
    const view: ClientFrame = { t: "view", bbox: null };
    socket.send(JSON.stringify(view));
    edgePing = setInterval(() => {
      if (socket.readyState !== WebSocket.OPEN) return;
      const ping: ClientFrame = { t: "ping" };
      socket.send(JSON.stringify(ping));
    }, EDGE_PING_MS);
  };
  socket.onmessage = (event) => {
    if (typeof event.data !== "string") return;
    try {
      handleEdgeFrame(JSON.parse(event.data) as ServerFrame);
    } catch {
      // A malformed frame is dropped; the snapshot poll still repairs the cache.
    }
  };
  socket.onclose = () => {
    if (edgeSocket !== socket) return;
    clearEdgeTimers();
    edgeSocket = null;
    edgeLive = false;
    edgeIdByIdx = new Map();
    edgeAttempts += 1;
    void requestLoad();
    scheduleEdgeRetry();
  };
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
  void connectEdge();

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      if (resyncTimer != null) {
        clearInterval(resyncTimer);
        resyncTimer = null;
      }
      closeEdge();
      edgeIdByIdx = new Map();
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
