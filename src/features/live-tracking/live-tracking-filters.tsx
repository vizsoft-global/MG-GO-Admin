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

/**
 * The narrowing the operator had applied, kept across navigation (QA #49).
 *
 * Following a rider to the driver detail page unmounts the map, so filter state held in
 * `useState` came back as the defaults: an operator who had narrowed to one zone and Offline
 * pins returned to a full fleet and had to narrow it again. The selection is carried in the URL
 * (see `tracking-selection.ts`); the filters are not — they are not worth a shareable link, but
 * they are worth remembering, so they go to `localStorage` the way V2's already do.
 *
 * Read through a validating parser rather than `JSON.parse` alone, because this crosses a
 * version boundary: a stored shape from an older build (a chip spelling that no longer exists, a
 * status that has been renamed) must degrade to the default for *that field*, not paint a map
 * filtered by a value nothing can match.
 */
const FILTER_STORAGE_KEY = "dpd.live-tracking.filters.v1";

const TRACKING_STATUS_FILTER_VALUES = ["all", "idle", "moving", "delivery_submit"] as const;
const BATTERY_FILTER_VALUES = ["all", "low", "medium", "high"] as const;
const GPS_FILTER_VALUES = ["all", "excellent", "good", "weak", "unknown"] as const;
const VEHICLE_FILTER_VALUES = ["all", "bike", "car"] as const;
const STATUS_CHIP_VALUES = ["online", "on_duty", "idle", "alert", "offline"] as const;

type StatusChipKey = LiveTrackingFilterState["statusChips"][number];

function pickFrom<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/** Zone and partner ids are opaque, so only "a non-empty string" can be checked here. */
function pickId(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

export function parseLiveTrackingFilters(raw: string | null): LiveTrackingFilterState {
  const defaults = resetLiveTrackingFilters();
  if (!raw) return defaults;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return defaults;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return defaults;
  const record = parsed as Record<string, unknown>;
  const chips = Array.isArray(record.statusChips)
    ? record.statusChips.filter(
        (chip): chip is StatusChipKey =>
          typeof chip === "string" && (STATUS_CHIP_VALUES as readonly string[]).includes(chip),
      )
    : defaults.statusChips;
  return {
    search: typeof record.search === "string" ? record.search : defaults.search,
    zoneId: pickId(record.zoneId, defaults.zoneId),
    partnerId: pickId(record.partnerId, defaults.partnerId),
    trackingStatus: pickFrom(
      record.trackingStatus,
      TRACKING_STATUS_FILTER_VALUES,
      defaults.trackingStatus,
    ),
    onDutyOnly: typeof record.onDutyOnly === "boolean" ? record.onDutyOnly : defaults.onDutyOnly,
    // An empty array is a state the operator can reach on purpose — every chip switched off
    // paints no pins — so it round-trips. Refilling it from the defaults would silently undo
    // that Clear the next time the map mounts.
    statusChips: Array.isArray(record.statusChips) ? chips : defaults.statusChips,
    batteryLevel: pickFrom(record.batteryLevel, BATTERY_FILTER_VALUES, defaults.batteryLevel),
    gpsSignal: pickFrom(record.gpsSignal, GPS_FILTER_VALUES, defaults.gpsSignal),
    vehicleType: pickFrom(record.vehicleType, VEHICLE_FILTER_VALUES, defaults.vehicleType),
  };
}

export function readLiveTrackingFilters(): LiveTrackingFilterState {
  if (typeof window === "undefined") return resetLiveTrackingFilters();
  try {
    return parseLiveTrackingFilters(window.localStorage.getItem(FILTER_STORAGE_KEY));
  } catch {
    return resetLiveTrackingFilters();
  }
}

export function persistLiveTrackingFilters(filters: LiveTrackingFilterState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(filters));
  } catch {
    // Private mode / quota — the map still works, it just forgets the narrowing.
  }
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
    /** Metres since the previous fix — the motion half a coarse `speed_mps` cannot report. */
    movedMeters?: number | null;
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
    movedMeters: loc.movedMeters ?? null,
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
