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
  isBlocked?: boolean;
}): PinStatus {
  if (input.isBlocked) return "idle";
  if (input.isOnDuty === false) return "idle";
  if (input.zoneStatus === "out_of_zone" && isGpsLive(input.lastSeenAt)) return "alert";
  const moving =
    input.trackingStatus === "moving" ||
    input.trackingStatus === "delivery_submit" ||
    (isMovingSpeed(input.speedMps) && isGpsLive(input.lastSeenAt));
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
        | "batteryPct"
        | "activeDeliveryId"
        | "lastSeenAt"
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
    | "batteryPct"
    | "activeDeliveryId"
    | "lastSeenAt"
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
  if (prev.batteryPct !== next.batteryPct) return true;
  if (prev.lastSeenAt !== next.lastSeenAt) return true;
  return false;
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
      isBlocked: row.isBlocked,
    }),
  };
}
