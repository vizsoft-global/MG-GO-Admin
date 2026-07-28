import type { ZoneStatus } from "@/features/locations/types";

export function formatSpeedKmh(speedMps: number | null | undefined): string {
  if (speedMps == null || !Number.isFinite(speedMps)) return "—";
  return `${(speedMps * 3.6).toFixed(0)} km/h`;
}

export function formatBatteryLevel(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(pct)) return "—";
  return `${Math.round(pct)}%`;
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
  if (pct == null || !Number.isFinite(pct)) return "unknown";
  if (pct < 20) return "low";
  if (pct < 50) return "medium";
  return "high";
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
