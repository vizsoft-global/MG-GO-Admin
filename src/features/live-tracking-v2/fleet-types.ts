/**
 * Client-side shapes for Live Tracking V2.
 *
 * Kept apart from `fleet-wire.ts` (what crosses the socket) and `fleet-status.ts`
 * (what a status means) so the transport can change rails without the UI noticing.
 */

import {
  FLEET_FILTER_STATUSES,
  type FleetDistributionBucket,
  type FleetEventSeverity,
  type FleetFlag,
  type FleetFlagSet,
  type FleetStatus,
} from "./fleet-status";
import type { DriverMeta, HeadingSource } from "./fleet-wire";

/**
 * Which transport the page is currently fed by. Surfaced to the operator, because
 * "the map is 10 seconds behind" and "the map is broken" are different problems and
 * they must be able to tell which one they are looking at.
 */
export type FleetRail = "edge" | "mirror" | "poll" | "offline";

export type FleetConnectionState = {
  rail: FleetRail;
  status: "connecting" | "live" | "degraded" | "error";
  /** Epoch ms of the last frame from any rail. */
  lastFrameAt: number;
  /** Server clock minus browser clock, from `hello`. Positions are stamped in server
   *  time, so interpolating against an unadjusted browser clock would drift. */
  clockSkewMs: number;
  frameHz: number;
  attempts: number;
  error: string | null;
};

export type FleetZone = {
  id: string;
  name: string;
  color: string | null;
  zoneType: "polygon" | "circle";
  ring: [number, number][] | null;
  center: [number, number] | null;
  radiusMeters: number;
  /**
   * Block size the zone was painted at, so the map can redraw its honeycomb.
   * Optional because a Worker older than this client will not send it, and a
   * missing size correctly means "draw the zone as one plain shape".
   */
  blockSize?: "S" | "M" | "L" | null;
};

export type FleetDriver = {
  driverId: string;
  idIdx: number;
  meta: DriverMeta;
  status: FleetStatus;
  flags: FleetFlagSet;
  activeFlags: FleetFlag[];
  /** Last authoritative position. The map draws the interpolated one instead. */
  lat: number | null;
  lng: number | null;
  speedMps: number;
  /**
   * Last known bearing, held across fixes that carry none — see `headingSource` for
   * whether the *current* fix contributed it.
   */
  headingDeg: number;
  /**
   * Where the bearing came from. A GPS course at speed and a compass reading at a
   * standstill are different claims, and the driver card says which one it is showing
   * rather than presenting both as the same fact.
   */
  headingSource: HeadingSource;
  /** Server-clock ms of the fix behind this record. */
  fixAtMs: number;
  /** How stale the GPS was when the server built the frame. */
  gpsAgeMs: number;
};

export type FleetFilters = {
  search: string;
  statuses: FleetStatus[] | null;
  zoneId: string | null;
  partnerId: string | null;
  /** Show only drivers with at least one attention flag. */
  alertsOnly: boolean;
};

export function emptyFleetFilters(): FleetFilters {
  return {
    search: "",
    statuses: null,
    zoneId: null,
    partnerId: null,
    alertsOnly: false,
  };
}

const FILTER_STORAGE_KEY = "dpd.live-tracking-v2.status-filters";

function sanitizeStatuses(value: unknown): FleetStatus[] | null {
  if (value == null) return null;
  if (!Array.isArray(value)) return null;
  const allowed = new Set<string>(FLEET_FILTER_STATUSES);
  return value.filter(
    (entry): entry is FleetStatus => typeof entry === "string" && allowed.has(entry),
  );
}

/** Hydrate the status chips from localStorage (or a test fixture). Search/zone/partner stay session-only. */
export function parsePersistedFleetFilters(raw: string | null): FleetFilters {
  const empty = emptyFleetFilters();
  if (!raw) return empty;
  try {
    const parsed = JSON.parse(raw) as { statuses?: unknown; alertsOnly?: unknown };
    return {
      ...empty,
      statuses: sanitizeStatuses(parsed.statuses),
      alertsOnly: parsed.alertsOnly === true,
    };
  } catch {
    return empty;
  }
}

export function readPersistedFleetFilters(): FleetFilters {
  if (typeof window === "undefined") return emptyFleetFilters();
  try {
    return parsePersistedFleetFilters(window.localStorage.getItem(FILTER_STORAGE_KEY));
  } catch {
    return emptyFleetFilters();
  }
}

export function persistFleetFilters(filters: FleetFilters): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      FILTER_STORAGE_KEY,
      JSON.stringify({
        statuses: filters.statuses,
        alertsOnly: filters.alertsOnly,
      }),
    );
  } catch {
    // Private mode / quota — the page still works, just without memory.
  }
}

/**
 * Alert Only is a standalone filter. Turning it on clears status chips; picking a
 * status chip while it is on turns it off and shows that status.
 */
export function toggleFleetStatusChip(
  filters: FleetFilters,
  status: FleetStatus,
): Partial<FleetFilters> {
  if (filters.alertsOnly) {
    return { alertsOnly: false, statuses: [status] };
  }
  const current = filters.statuses ?? [...FLEET_FILTER_STATUSES];
  const next = current.includes(status)
    ? current.filter((entry) => entry !== status)
    : [...current, status];
  return { statuses: next };
}

export function toggleFleetAlertsOnly(filters: FleetFilters): Partial<FleetFilters> {
  if (filters.alertsOnly) {
    return { alertsOnly: false, statuses: null };
  }
  return { alertsOnly: true, statuses: null };
}

/**
 * One feed item, from either event class. They share a row because an operator
 * reading the timeline does not care which subsystem authored a fact, but they do
 * need to know it is not the same kind of fact — hence `kind`.
 */
export type FleetFeedItem = {
  id: string;
  kind: "fleet" | "ops";
  driverId: string;
  driverName: string | null;
  /** `movement.started`, `duty.clock_in`, … */
  eventKey: string;
  severity: FleetEventSeverity;
  value: number | null;
  statusAfter: string | null;
  success: boolean;
  errorCode: string | null;
  latitude: number | null;
  longitude: number | null;
  context: Record<string, unknown>;
  atMs: number;
};

export type FleetZoneCount = {
  zoneId: string | null;
  zoneName: string;
  color: string | null;
  count: number;
};

export type FleetKpis = {
  onDuty: number;
  /** GPS-live, which is not the same as clocked in — a parked rider with a dead GPS is
   *  on duty and not online, and the two counts diverging is the interesting case. */
  online: number;
  moving: number;
  onDelivery: number;
  idle: number;
  offline: number;
  alerts: number;
  outOfZone: number;
  overspeed: number;
  lowBattery: number;
  gpsOffline: number;
  deliveriesToday: number;
  deliveriesCompletedToday: number;
  /** Kilometres, summed across the visible fleet. */
  distanceTodayKm: number;
  avgSpeedKmh: number;
};

export type FleetSnapshot = {
  connection: FleetConnectionState;
  /** Filtered and sorted; the rail renders these ids and subscribes per driver. */
  driverIds: string[];
  totalDrivers: number;
  counts: Record<FleetDistributionBucket, number>;
  zoneCounts: FleetZoneCount[];
  kpis: FleetKpis;
  zones: FleetZone[];
  partners: Array<{ id: string; name: string }>;
  feed: FleetFeedItem[];
  /** Events withheld while the feed is paused. */
  pendingFeedCount: number;
  feedPaused: boolean;
  selectedDriverId: string | null;
  filters: FleetFilters;
  /** Bumped on every structural change, so `useSyncExternalStore` can compare by
   *  identity without deep equality. */
  version: number;
};
