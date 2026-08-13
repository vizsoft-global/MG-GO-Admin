import type { TrackingStatus } from "@/features/locations/types";
import { isPointInZone, type ZoneShape } from "@/lib/geo/zone-geometry";
import type { GpsQuality } from "./tracking-metrics";
import { batteryLevelBucket, gpsSignalBucket } from "./tracking-metrics";
import { liveListStatus } from "./tracking-status";

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

export type LiveTrackingZoneShape = ZoneShape & { id: string };

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
    speedMps?: number | null;
    lastSeenAt?: string;
    latitude?: number;
    longitude?: number;
  },
  filters: LiveTrackingFilterState,
  meta?: { zoneId: string | null; partnerId: string | null; zoneName: string | null },
  zoneShapes: LiveTrackingZoneShape[] = [],
): boolean {
  if (filters.onDutyOnly && !loc.isOnDuty) return false;
  if (filters.trackingStatus !== "all" && loc.trackingStatus !== filters.trackingStatus) {
    return false;
  }
  if (filters.zoneId !== "all") {
    const assigned = meta?.zoneId === filters.zoneId;
    if (!assigned) {
      const shape = zoneShapes.find((zone) => zone.id === filters.zoneId);
      const inGeom =
        shape != null &&
        loc.latitude != null &&
        loc.longitude != null &&
        isPointInZone(loc.latitude, loc.longitude, shape);
      if (!inGeom) return false;
    }
  }
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
    const listStatus = liveListStatus({
      isOnDuty: loc.isOnDuty,
      trackingStatus: loc.trackingStatus,
      speedMps: loc.speedMps ?? null,
      lastSeenAt: loc.lastSeenAt ?? "",
    });
    const matchesChip =
      (filters.statusChips.includes("online") &&
        (listStatus === "moving" || listStatus === "delivery_submit")) ||
      (filters.statusChips.includes("on_duty") && loc.isOnDuty) ||
      (filters.statusChips.includes("idle") && listStatus === "idle") ||
      (filters.statusChips.includes("alert") && loc.pinStatus === "alert") ||
      (filters.statusChips.includes("offline") && listStatus === "offline");
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
