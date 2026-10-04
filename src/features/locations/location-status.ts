import { fleetMotion, gpsOfflineGraceSecondsFor, hasMotion } from "@/features/live-tracking-v2/fleet-status";

import type { DriverLiveLocation, PinStatus, TrackingStatus, ZoneStatus } from "./types";

const MOVING_STALE_MS = 45 * 1000;
const IDLE_STALE_MS = 2 * 60 * 1000;

/**
 * How long a last-known pin is kept in the realtime cache for a driver we have never seen.
 *
 * Deliberately far longer than the liveness window below, because these answer different
 * questions: dropping a row takes the driver off the map altogether, and an Offline driver's
 * last pin is precisely what an operator goes looking for. Calling their *reading* stale is a
 * label; deleting their pin is a disappearance.
 */
export const LIVE_PIN_RETENTION_MS = 8 * 60 * 1000;

/** Matches driver-app AdaptiveLocationScheduler.movingSpeedThresholdMps. */
export const MOVING_SPEED_THRESHOLD_MPS = 1.5;

/**
 * How old a fix may be before this driver stops counting as live, in ms.
 *
 * Sourced from the V2 thresholds rather than re-stated here, because both pages describe the
 * same fleet and had drifted into three different answers: this file held a flat 8 minutes,
 * the GPS Offline insight tile ticked at 90s, and V2 called the same rider `gps_offline`
 * somewhere between the two. The grace depends on the cadence the app was reporting at — one
 * fix per second while moving, one per 30s otherwise — so 90s of silence is ninety missed
 * reports for one rider and three for another.
 *
 * Callers that cannot say which cadence a row was on get the idle grace, which is the
 * conservative direction: it delays the Offline label rather than inventing one.
 */
export function gpsLiveMaxAgeMs(
  trackingStatus?: TrackingStatus,
  speedMps?: number | null,
): number {
  return gpsOfflineGraceSecondsFor(trackingStatus ?? "idle", speedMps) * 1000;
}

export function parseTrackingStatus(value: string): TrackingStatus {
  if (value === "moving" || value === "delivery_submit") return value;
  return "idle";
}

export function parseZoneStatus(value: string | null): ZoneStatus | null {
  if (value === "in_zone" || value === "out_of_zone" || value === "unknown") return value;
  return null;
}

/** Prefer a coalesced heartbeat (`last_report_at`) over a frozen `last_seen_at`. */
export function latestGpsAt(
  lastSeenAt: string,
  lastReportAt?: string | null,
): string {
  if (!lastReportAt) return lastSeenAt;
  const seen = new Date(lastSeenAt).getTime();
  const reported = new Date(lastReportAt).getTime();
  if (!Number.isFinite(reported)) return lastSeenAt;
  if (!Number.isFinite(seen) || reported > seen) return lastReportAt;
  return lastSeenAt;
}

export function isGpsLive(
  lastSeenAt: string,
  now = Date.now(),
  lastReportAt?: string | null,
  trackingStatus?: TrackingStatus,
  speedMps?: number | null,
): boolean {
  const age = now - new Date(latestGpsAt(lastSeenAt, lastReportAt)).getTime();
  return Number.isFinite(age) && age <= gpsLiveMaxAgeMs(trackingStatus, speedMps);
}

/** Whether a last-known pin is old enough to be dropped from the realtime cache entirely. */
export function isPinBeyondRetention(
  lastSeenAt: string,
  now = Date.now(),
  lastReportAt?: string | null,
): boolean {
  const age = now - new Date(latestGpsAt(lastSeenAt, lastReportAt)).getTime();
  return Number.isFinite(age) && age > LIVE_PIN_RETENTION_MS;
}

export function isMovingSpeed(speedMps: number | null | undefined): boolean {
  return speedMps != null && Number.isFinite(speedMps) && speedMps >= MOVING_SPEED_THRESHOLD_MPS;
}

/** Last-known pin stays on the live map for on-duty and offline drivers. */
export function shouldShowOnLiveMap(
  _input?: { lastSeenAt: string; isOnDuty: boolean },
  _now = Date.now(),
): boolean {
  return true;
}

export function isGpsStale(
  lastSeenAt: string,
  trackingStatus: TrackingStatus,
  now = Date.now(),
): boolean {
  const age = now - new Date(lastSeenAt).getTime();
  if (trackingStatus === "moving") return age > MOVING_STALE_MS;
  return age > IDLE_STALE_MS;
}

export function derivePinStatus(input: {
  zoneStatus: ZoneStatus | null;
  trackingStatus: TrackingStatus;
  lastSeenAt: string;
  isOnDuty?: boolean;
  speedMps?: number | null;
  movedMeters?: number | null;
  isBlocked?: boolean;
  activeDeliveryId?: string | null;
}): PinStatus {
  if (input.isBlocked) return "idle";
  if (input.isOnDuty === false) return "idle";
  if (
    !isGpsLive(
      input.lastSeenAt,
      undefined,
      undefined,
      input.trackingStatus,
      input.speedMps,
    )
  ) {
    return "idle";
  }
  if (input.zoneStatus === "out_of_zone") return "alert";
  const onDelivery =
    input.trackingStatus === "delivery_submit" && Boolean(input.activeDeliveryId);
  // `hasMotion` — not a bare speed test — so a rider whose coarse fix reports 0 m/s while the
  // coordinates travel still paints Active instead of Idle (QA #50). An open delivery keeps
  // painting Active on its own, exactly as before.
  const moving = onDelivery || hasMotion(input);
  if (moving) return "active";
  return "idle";
}

export function formatSpeedMps(speedMps: number | null, locale?: string): string {
  if (speedMps == null || Number.isNaN(speedMps) || speedMps < 0) return "—";
  const shown = speedMps < MOVING_SPEED_THRESHOLD_MPS ? 0 : speedMps;
  const kmh = shown * 3.6;
  return `${kmh.toLocaleString(locale ?? "en", { maximumFractionDigits: 0 })} km/h`;
}

/** 0–100 percents pass through; exclusive (0, 1) fractions become 0–100. */
export function normalizeBatteryPct(pct: number | null | undefined): number | null {
  if (pct == null || !Number.isFinite(pct)) return null;
  if (pct > 0 && pct < 1) return Math.round(pct * 100);
  return Math.round(Math.min(100, Math.max(0, pct)));
}

export function formatBatteryPct(batteryPct: number | null): string {
  const pct = normalizeBatteryPct(batteryPct);
  if (pct == null) return "—";
  return `${pct}%`;
}

export function formatDistanceMeters(distanceMeters: number | null, locale?: string): string {
  if (distanceMeters == null || Number.isNaN(distanceMeters)) return "—";
  return `${(distanceMeters / 1000).toLocaleString(locale ?? "en", {
    maximumFractionDigits: 2,
  })} km`;
}

export function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const r = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return r * 2 * Math.asin(Math.sqrt(a));
}

/** Any GPS/status field the live map must react to — no 20s last-seen gate. */
export function liveLocationPayloadChanged(
  prev:
    | Pick<
        DriverLiveLocation,
        | "latitude"
        | "longitude"
        | "trackingStatus"
        | "zoneStatus"
        | "pinStatus"
        | "isOnDuty"
        | "isBlocked"
        | "speedMps"
        | "movedMeters"
        | "batteryPct"
        | "activeDeliveryId"
        | "lastSeenAt"
        | "vehicleType"
      >
    | undefined,
  next: Pick<
    DriverLiveLocation,
    | "latitude"
    | "longitude"
    | "trackingStatus"
    | "zoneStatus"
    | "pinStatus"
    | "isOnDuty"
    | "isBlocked"
    | "speedMps"
    | "movedMeters"
    | "batteryPct"
    | "activeDeliveryId"
    | "lastSeenAt"
    | "vehicleType"
  >,
): boolean {
  if (!prev) return true;
  if (prev.latitude !== next.latitude || prev.longitude !== next.longitude) return true;
  if (prev.trackingStatus !== next.trackingStatus) return true;
  if (prev.zoneStatus !== next.zoneStatus) return true;
  if (prev.activeDeliveryId !== next.activeDeliveryId) return true;
  if (prev.pinStatus !== next.pinStatus) return true;
  if (prev.isOnDuty !== next.isOnDuty) return true;
  if (prev.isBlocked !== next.isBlocked) return true;
  if ((prev.speedMps ?? 0) !== (next.speedMps ?? 0)) return true;
  // Same coordinates but a different displacement is a real change: it is what flips the
  // Moving / Idle sub-label while an On Delivery rider's pin stays Active either way.
  if ((prev.movedMeters ?? 0) !== (next.movedMeters ?? 0)) return true;
  if (prev.batteryPct !== next.batteryPct) return true;
  if (prev.lastSeenAt !== next.lastSeenAt) return true;
  if (prev.vehicleType !== next.vehicleType) return true;
  return false;
}

/**
 * Moving / Idle for the sub-label a rider on delivery carries (QA #48), in V1's vocabulary.
 *
 * Delegates to the shared `fleetMotion` rule so the V1 cards cannot answer this differently
 * from V2, or from the status machine that produced the primary status beside it.
 */
export function liveMotion(input: {
  trackingStatus: TrackingStatus;
  speedMps?: number | null;
  movedMeters?: number | null;
}): "moving" | "idle" {
  return fleetMotion(input);
}

/**
 * Metres between the fix we already held for this driver and the one arriving now.
 *
 * `null` when there is no previous fix (first sighting of the session, or a driver whose row
 * was dropped) — an unknown displacement must not be read as "did not move", because that is
 * what would keep a moving rider Idle until their next update.
 */
function displacementMeters(
  previous: { latitude: number; longitude: number } | null | undefined,
  next: { latitude: number; longitude: number },
): number | null {
  if (!previous) return null;
  const fromLat = Number(previous.latitude);
  const fromLng = Number(previous.longitude);
  if (!Number.isFinite(fromLat) || !Number.isFinite(fromLng)) return null;
  if (!Number.isFinite(next.latitude) || !Number.isFinite(next.longitude)) return null;
  return haversineMeters(fromLat, fromLng, next.latitude, next.longitude);
}

export function enrichLiveLocation(
  row: Omit<DriverLiveLocation, "pinStatus">,
  previous?: { latitude: number; longitude: number; lastSeenAt?: string } | null,
): DriverLiveLocation {
  const movedMeters = displacementMeters(previous, row) ?? row.movedMeters ?? null;
  return {
    ...row,
    movedMeters,
    pinStatus: derivePinStatus({
      zoneStatus: row.zoneStatus,
      trackingStatus: row.trackingStatus,
      lastSeenAt: row.lastSeenAt,
      isOnDuty: row.isOnDuty,
      speedMps: row.speedMps,
      movedMeters,
      isBlocked: row.isBlocked,
      activeDeliveryId: row.activeDeliveryId,
    }),
  };
}
