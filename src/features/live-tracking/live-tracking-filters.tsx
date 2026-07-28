import type { TrackingStatus } from "@/features/locations/types";
import type { GpsQuality } from "./tracking-metrics";
import { batteryLevelBucket, gpsSignalBucket } from "./tracking-metrics";

export type LiveTrackingFilterState = {
  search: string;
  zoneId: string;
  partnerId: string;
  trackingStatus: TrackingStatus | "all";
  onDutyOnly: boolean;
  statusChips: Array<"online" | "on_duty" | "idle" | "alert" | "offline">;
  batteryLevel: "all" | "low" | "medium" | "high";
  gpsSignal: "all" | GpsQuality;
};

export const DEFAULT_LIVE_TRACKING_FILTERS: LiveTrackingFilterState = {
  search: "",
  zoneId: "all",
  partnerId: "all",
  trackingStatus: "all",
  onDutyOnly: false,
  statusChips: ["online", "on_duty", "idle", "alert", "offline"],
  batteryLevel: "all",
  gpsSignal: "all",
};

export function matchesLiveTrackingFilters(
  loc: {
    driverName: string;
    driverCode: string;
    isOnDuty: boolean;
    trackingStatus: TrackingStatus;
    pinStatus: "active" | "idle" | "alert";
    batteryPct: number | null;
    accuracyMeters: number | null;
    zoneStatus: import("@/features/locations/types").ZoneStatus | null;
  },
  filters: LiveTrackingFilterState,
  meta?: { zoneId: string | null; partnerId: string | null; zoneName: string | null },
): boolean {
  if (filters.onDutyOnly && !loc.isOnDuty) return false;
  if (filters.trackingStatus !== "all" && loc.trackingStatus !== filters.trackingStatus) {
    return false;
  }
  if (filters.zoneId !== "all" && meta?.zoneId !== filters.zoneId) return false;
  if (filters.partnerId !== "all" && meta?.partnerId !== filters.partnerId) return false;

  if (filters.batteryLevel !== "all") {
    const bucket = batteryLevelBucket(loc.batteryPct);
    if (bucket !== filters.batteryLevel) return false;
  }

  if (filters.gpsSignal !== "all") {
    const bucket = gpsSignalBucket(loc.accuracyMeters);
    if (bucket !== filters.gpsSignal) return false;
  }

  if (filters.statusChips.length > 0) {
    const matchesChip =
      (filters.statusChips.includes("online") &&
        loc.isOnDuty &&
        loc.trackingStatus !== "idle") ||
      (filters.statusChips.includes("on_duty") && loc.isOnDuty) ||
      (filters.statusChips.includes("idle") && loc.trackingStatus === "idle") ||
      (filters.statusChips.includes("alert") && loc.pinStatus === "alert") ||
      (filters.statusChips.includes("offline") && !loc.isOnDuty);
    if (!matchesChip) return false;
  }

  const q = filters.search.trim().toLowerCase();
  if (!q) return true;
  return (
    loc.driverName.toLowerCase().includes(q) ||
    loc.driverCode.toLowerCase().includes(q) ||
    (meta?.zoneName ?? "").toLowerCase().includes(q)
  );
}
