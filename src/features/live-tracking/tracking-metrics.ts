import type { TrackingStatus, ZoneStatus } from "@/features/locations/types";
import {
  gpsLiveMaxAgeMs,
  isGpsLive,
  MOVING_SPEED_THRESHOLD_MPS,
  normalizeBatteryPct,
} from "@/features/locations/location-status";

export { normalizeBatteryPct } from "@/features/locations/location-status";

/** Kuwait urban delivery fleet cap. Speeds above this count as Overspeeding. */
export const OVERSPEED_KMH = 60;

/**
 * When the GPS Offline insight should tick.
 *
 * This was a flat 90s, justified against idle heartbeats of "45–60s" — a cadence the driver
 * app stopped using on 2026-08-14, when reporting split into one fix per second while moving
 * and one per 30s otherwise. 90s then meant three missed beats for a parked rider, so the
 * tile counted alive, on-duty, stationary drivers as offline. The window now comes from the
 * shared V2 thresholds so the tile, the V1 list and the V2 map cannot disagree.
 */
export function gpsHeartbeatStaleMs(
  trackingStatus?: TrackingStatus,
  speedMps?: number | null,
): number {
  return gpsLiveMaxAgeMs(trackingStatus, speedMps);
}

export function displaySpeedMps(speedMps: number | null | undefined): number | null {
  if (speedMps == null || !Number.isFinite(speedMps) || speedMps < 0) return null;
  if (speedMps < MOVING_SPEED_THRESHOLD_MPS) return 0;
  return speedMps;
}

export function formatSpeedKmh(speedMps: number | null | undefined): string {
  const mps = displaySpeedMps(speedMps);
  if (mps == null) return "—";
  return `${(mps * 3.6).toFixed(0)} km/h`;
}

export function isOverspeeding(
  speedMps: number | null | undefined,
  limitKmh = OVERSPEED_KMH,
): boolean {
  if (speedMps == null || !Number.isFinite(speedMps) || speedMps < 0) return false;
  return speedMps * 3.6 > limitKmh;
}

export function isGpsHeartbeatStale(
  lastSeenAt: string,
  now = Date.now(),
  trackingStatus?: TrackingStatus,
  speedMps?: number | null,
): boolean {
  const age = now - new Date(lastSeenAt).getTime();
  return Number.isFinite(age) && age > gpsHeartbeatStaleMs(trackingStatus, speedMps);
}

export function formatBatteryLevel(pct: number | null | undefined): string {
  const normalized = normalizeBatteryPct(pct);
  if (normalized == null) return "—";
  return `${normalized}%`;
}

export function formatAccuracyMeters(meters: number | null | undefined): string {
  if (meters == null || !Number.isFinite(meters)) return "—";
  return `±${meters.toFixed(0)} m`;
}

export function formatDurationSince(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

export function formatTimestampLabel(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date(iso));
  } catch {
    return "—";
  }
}

export type GpsQuality = "excellent" | "good" | "weak" | "unknown";

export function gpsQualityFromAccuracy(
  accuracyMeters: number | null | undefined,
): GpsQuality {
  if (accuracyMeters == null || !Number.isFinite(accuracyMeters)) return "unknown";
  if (accuracyMeters <= 25) return "excellent";
  if (accuracyMeters <= 75) return "good";
  return "weak";
}

export function gpsSignalBucket(
  accuracyMeters: number | null | undefined,
): "excellent" | "good" | "weak" | "unknown" {
  return gpsQualityFromAccuracy(accuracyMeters);
}

export function batteryLevelBucket(
  pct: number | null | undefined,
): "low" | "medium" | "high" | "unknown" {
  const normalized = normalizeBatteryPct(pct);
  if (normalized == null) return "unknown";
  if (normalized < 20) return "low";
  if (normalized < 50) return "medium";
  return "high";
}

export function liveZoneStatus(
  status: ZoneStatus | null | undefined,
  lastSeenAt: string,
  now?: number,
): ZoneStatus {
  if (!lastSeenAt || !isGpsLive(lastSeenAt, now)) return "unknown";
  if (status === "in_zone" || status === "out_of_zone") return status;
  return "unknown";
}

export function zoneStatusLabelKey(
  status: ZoneStatus | null | undefined,
): "in_zone" | "out_of_zone" | "unknown" {
  if (status === "in_zone" || status === "out_of_zone") return status;
  return "unknown";
}

export function driverInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
}
