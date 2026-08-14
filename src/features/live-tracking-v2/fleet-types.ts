/**
 * Client-side shapes for Live Tracking V2.
 *
 * Kept apart from `fleet-wire.ts` (what crosses the socket) and `fleet-status.ts`
 * (what a status means) so the transport can change rails without the UI noticing.
 */

import type {
  FleetDistributionBucket,
  FleetEventSeverity,
  FleetFlag,
  FleetFlagSet,
  FleetStatus,
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
