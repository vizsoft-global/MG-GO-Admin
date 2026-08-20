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
  vehicleType: "all" | "bike" | "car";
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
  vehicleType: "all",
};

export function resetLiveTrackingFilters(): LiveTrackingFilterState {
  return {
    ...DEFAULT_LIVE_TRACKING_FILTERS,
    statusChips: [...DEFAULT_LIVE_TRACKING_FILTERS.statusChips],
  };
}

export function matchesLiveTrackingFilters(
  loc: {
    driverName: string;
    driverCode: string;
    isOnDuty: boolean;
    isBlocked?: boolean;
    trackingStatus: TrackingStatus;
    pinStatus: "active" | "idle" | "alert";
    batteryPct: number | null;
    accuracyMeters: number | null;
    zoneStatus: import("@/features/locations/types").ZoneStatus | null;
    speedMps?: number | null;
    lastSeenAt?: string;
    latitude?: number;
    longitude?: number;
    activeDeliveryId?: string | null;
    vehicleType?: "bike" | "car";
  },
  filters: LiveTrackingFilterState,
  meta?: { zoneId: string | null; partnerId: string | null; zoneName: string | null },
  zoneShapes: LiveTrackingZoneShape[] = [],
  now?: number,
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
  if (filters.vehicleType !== "all" && (loc.vehicleType ?? "bike") !== filters.vehicleType) {
    return false;
  }

  if (filters.batteryLevel !== "all") {
    const bucket = batteryLevelBucket(loc.batteryPct);
    if (bucket !== filters.batteryLevel) return false;
  }

  if (filters.gpsSignal !== "all") {
    const bucket = gpsSignalBucket(loc.accuracyMeters);
    if (bucket !== filters.gpsSignal) return false;
  }

  if (filters.statusChips.length === 0) return false;

  const listStatus = liveListStatus({
    isOnDuty: loc.isOnDuty,
    isBlocked: loc.isBlocked,
    trackingStatus: loc.trackingStatus,
    speedMps: loc.speedMps ?? null,
    lastSeenAt: loc.lastSeenAt ?? "",
    now,
    activeDeliveryId: loc.activeDeliveryId,
  });
  const isOnline =
    listStatus === "moving" ||
    listStatus === "idle" ||
    listStatus === "delivery_submit" ||
    listStatus === "delivered";
  const matchesChip =
    (filters.statusChips.includes("online") && isOnline) ||
    (filters.statusChips.includes("on_duty") && loc.isOnDuty && !loc.isBlocked) ||
    (filters.statusChips.includes("idle") && listStatus === "idle") ||
    (filters.statusChips.includes("alert") && loc.pinStatus === "alert") ||
    (filters.statusChips.includes("offline") &&
      (listStatus === "offline" || listStatus === "blocked"));
  if (!matchesChip) return false;

  const q = filters.search.trim().toLowerCase();
  if (!q) return true;
  return (
    loc.driverName.toLowerCase().includes(q) ||
    loc.driverCode.toLowerCase().includes(q) ||
    (meta?.zoneName ?? "").toLowerCase().includes(q)
  );
}
