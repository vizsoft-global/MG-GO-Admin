import type { DriverLiveLocation, PinStatus, TrackingStatus, ZoneStatus } from "./types";

const MOVING_STALE_MS = 45 * 1000;
const IDLE_STALE_MS = 2 * 60 * 1000;
/** Drivers with GPS older than this are excluded from the live map and counts. */
export const LIVE_GPS_MAX_AGE_MS = 8 * 60 * 1000;
/** Matches driver-app AdaptiveLocationScheduler.movingSpeedThresholdMps. */
export const MOVING_SPEED_THRESHOLD_MPS = 1.5;

export function parseTrackingStatus(value: string): TrackingStatus {
  if (value === "moving" || value === "delivery_submit") return value;
  return "idle";
}

export function parseZoneStatus(value: string | null): ZoneStatus | null {
  if (value === "in_zone" || value === "out_of_zone" || value === "unknown") return value;
  return null;
}

export function isGpsLive(lastSeenAt: string, now = Date.now()): boolean {
  const age = now - new Date(lastSeenAt).getTime();
  return age <= LIVE_GPS_MAX_AGE_MS;
}

export function isMovingSpeed(speedMps: number | null | undefined): boolean {
  return speedMps != null && Number.isFinite(speedMps) && speedMps >= MOVING_SPEED_THRESHOLD_MPS;
}

/** On-duty drivers stay on the live map at last-known coords when GPS goes quiet. */
export function shouldShowOnLiveMap(
  input: { lastSeenAt: string; isOnDuty: boolean },
  now = Date.now(),
): boolean {
  if (input.isOnDuty) return true;
  return isGpsLive(input.lastSeenAt, now);
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
}): PinStatus {
  if (input.isOnDuty === false) return "idle";
  if (input.zoneStatus === "out_of_zone") return "alert";
  const moving =
    input.trackingStatus === "moving" ||
    input.trackingStatus === "delivery_submit" ||
    (isMovingSpeed(input.speedMps) && isGpsLive(input.lastSeenAt));
  if (isGpsStale(input.lastSeenAt, moving ? "moving" : input.trackingStatus)) return "alert";
  if (moving) return "active";
  return "idle";
}

export function formatSpeedMps(speedMps: number | null, locale?: string): string {
  if (speedMps == null || Number.isNaN(speedMps)) return "—";
  const kmh = speedMps * 3.6;
  return `${kmh.toLocaleString(locale ?? "en", { maximumFractionDigits: 1 })} km/h`;
}

export function formatBatteryPct(batteryPct: number | null): string {
  if (batteryPct == null) return "—";
  return `${batteryPct}%`;
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

export function enrichLiveLocation(
  row: Omit<DriverLiveLocation, "pinStatus">,
): DriverLiveLocation {
  return {
    ...row,
    pinStatus: derivePinStatus({
      zoneStatus: row.zoneStatus,
      trackingStatus: row.trackingStatus,
      lastSeenAt: row.lastSeenAt,
      isOnDuty: row.isOnDuty,
      speedMps: row.speedMps,
    }),
  };
}
