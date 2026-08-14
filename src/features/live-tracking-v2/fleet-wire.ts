/**
 * Wire format for the admin socket.
 *
 * Positions travel as fixed-length numeric tuples against an id dictionary sent
 * once, not as objects with repeated uuid keys. 500 entities per frame at 4Hz is
 * ~10KB in this shape and ~90KB as JSON objects; over a shift that difference is
 * the whole reason the page can run at a fixed tick instead of per-ping.
 *
 * Shared verbatim with the Cloudflare Worker (`infra/workers/dpd-live`), which
 * imports this file rather than keeping a copy — an encoder and a decoder that can
 * drift are not a protocol. Keep it free of imports beyond `fleet-status`: no `@/`
 * aliases, no React, no Node builtins.
 */

import {
  FLEET_FLAGS,
  FLEET_STATUSES,
  type FleetFlag,
  type FleetFlagSet,
  type FleetStatus,
} from "./fleet-status";

/**
 * 2 added the heading-source element and the `trail` frame.
 *
 * Both directions of a version mismatch degrade rather than fail, which is why there
 * is no version gate on `hello`: a v1 room sends 8-element tuples, so a v2 client
 * reads the missing source as `none` and holds each marker's last bearing instead of
 * rotating it, and never receives a `trail` frame, so it draws no tails. A v1 client
 * against a v2 room ignores the extra element and the unknown frame type. Refusing the
 * connection instead would blank the map for the length of a rolling deploy, which is
 * a worse outcome than a map with no trails on it.
 */
export const WIRE_VERSION = 2;

/**
 * How much history a trail carries. Owned here rather than in the client, because the
 * Durable Object prunes to the same window it advertises; two constants would drift
 * into a client drawing a tail the room had already dropped.
 */
export const TRAIL_WINDOW_MS = 10 * 60_000;

/** Trail downsample gates, applied identically in the room and in the client. */
export const TRAIL_MIN_MOVE_M = 5;
export const TRAIL_MIN_GAP_MS = 3_000;

/**
 * Where a bearing came from. A GPS course at 40km/h and a compass reading at a
 * standstill are not the same claim, so the source travels with the value instead of
 * being inferred from speed on the client.
 */
export const HEADING_SOURCES = ["none", "gps", "compass"] as const;
export type HeadingSource = (typeof HEADING_SOURCES)[number];

export function headingSourceCode(source: HeadingSource | null | undefined): number {
  const index = source ? HEADING_SOURCES.indexOf(source) : 0;
  return index >= 0 ? index : 0;
}

export function headingSourceFromCode(code: number | undefined): HeadingSource {
  return HEADING_SOURCES[code ?? 0] ?? "none";
}

export function statusCode(status: FleetStatus): number {
  const index = FLEET_STATUSES.indexOf(status);
  return index >= 0 ? index : FLEET_STATUSES.indexOf("idle");
}

export function statusFromCode(code: number): FleetStatus {
  return FLEET_STATUSES[code] ?? "idle";
}

export function flagBits(flags: FleetFlagSet): number {
  let bits = 0;
  FLEET_FLAGS.forEach((flag, index) => {
    if (flags[flag]) bits |= 1 << index;
  });
  return bits;
}

export function flagsFromBits(bits: number): FleetFlagSet {
  const out: Record<string, boolean> = {};
  FLEET_FLAGS.forEach((flag, index) => {
    out[flag] = (bits & (1 << index)) !== 0;
  });
  return out as unknown as FleetFlagSet;
}

export function activeFlagsFromBits(bits: number): FleetFlag[] {
  return FLEET_FLAGS.filter((_, index) => (bits & (1 << index)) !== 0);
}

/**
 * The Supabase Broadcast mirror sends flag *names* rather than bits, because that
 * payload is read by a fallback client that may be running an older bundle and must
 * not depend on the bit order staying put.
 */
export function flagsFromNames(names: readonly string[]): FleetFlagSet {
  const out: Record<string, boolean> = {};
  for (const flag of FLEET_FLAGS) out[flag] = names.includes(flag);
  return out as unknown as FleetFlagSet;
}

/**
 * [idIdx, lat*1e5, lng*1e5, speed in dm/s, heading deg, statusCode, flagBits,
 *  ageDeciseconds, headingSourceCode]
 *
 * 1e5 of a degree is ~1.1m, well inside GPS accuracy, and keeps every value a
 * small integer so JSON stays compact without a binary codec.
 */
export type PositionTuple = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

export function encodePosition(input: {
  idIdx: number;
  lat: number;
  lng: number;
  speedMps: number | null;
  headingDeg: number | null;
  headingSource?: HeadingSource | null;
  status: FleetStatus;
  flags: FleetFlagSet;
  ageMs: number;
}): PositionTuple {
  // A bearing with no source is not a bearing. Encoding the source explicitly is what
  // lets the client hold the last known heading instead of rotating a marker north.
  const source: HeadingSource =
    input.headingSource ?? (input.headingDeg == null ? "none" : "gps");
  return [
    input.idIdx,
    Math.round(input.lat * 1e5),
    Math.round(input.lng * 1e5),
    Math.max(0, Math.round((input.speedMps ?? 0) * 10)),
    Math.max(0, Math.round(input.headingDeg ?? 0)) % 360,
    statusCode(input.status),
    flagBits(input.flags),
    Math.max(0, Math.min(65535, Math.round(input.ageMs / 100))),
    headingSourceCode(source),
  ];
}

export function decodePosition(tuple: PositionTuple) {
  const headingSource = headingSourceFromCode(tuple[8]);
  return {
    idIdx: tuple[0],
    lat: tuple[1] / 1e5,
    lng: tuple[2] / 1e5,
    speedMps: tuple[3] / 10,
    headingDeg: tuple[4],
    headingSource,
    headingKnown: headingSource !== "none",
    status: statusFromCode(tuple[5]),
    flags: flagsFromBits(tuple[6]),
    ageMs: tuple[7] * 100,
  };
}

/**
 * Flat `lat*1e5, lng*1e5, unix seconds` triplets rather than an array of objects: a
 * 10-minute tail for 500 riders is the largest single payload this socket sends, and
 * the flat form is roughly a third of the bytes of `{lat,lng,ts}` objects.
 */
export type TrailTrack = { idIdx: number; pts: number[] };

export function encodeTrailPoint(lat: number, lng: number, tsMs: number): [number, number, number] {
  return [Math.round(lat * 1e5), Math.round(lng * 1e5), Math.round(tsMs / 1000)];
}

/** Metres between two coordinates — equirectangular, which is exact enough at city scale. */
export function trailDistanceMeters(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const latRad = ((aLat + bLat) / 2) * (Math.PI / 180);
  const dLat = (bLat - aLat) * 111_320;
  const dLng = (bLng - aLng) * 111_320 * Math.cos(latRad);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

/** Roster metadata, sent once per driver and on change — never in a position frame. */
export type DriverMeta = {
  idIdx: number;
  driverId: string;
  driverName: string;
  driverCode: string;
  employeeId: string | null;
  avatarObjectKey: string | null;
  avatarUpdatedAt: string | null;
  zoneId: string | null;
  zoneName: string | null;
  partnerId: string | null;
  partnerName: string | null;
  restaurantName: string | null;
  vehicleLabel: string | null;
  accountStatus: string;
  onDutySince: string | null;
  deliveriesToday: number;
  deliveriesCompletedToday: number;
  distanceTodayMeters: number;
  batteryPct: number | null;
  accuracyMeters: number | null;
  activeDeliveryId: string | null;
  currentZoneId: string | null;
  currentZoneName: string | null;
  shiftStartAt: string | null;
  shiftEndAt: string | null;
  lastFixAt: string | null;
};

export type FleetEventFrame = {
  driverId: string;
  eventKey: string;
  severity: "info" | "warning" | "critical";
  value: number | null;
  statusBefore: string | null;
  statusAfter: string | null;
  zoneId: string | null;
  latitude: number | null;
  longitude: number | null;
  context: Record<string, unknown>;
  detectedAt: string;
};

export type OpsEventFrame = {
  id: string;
  driverId: string;
  category: string;
  operationKey: string;
  success: boolean;
  errorCode: string | null;
  context: Record<string, unknown>;
  occurredAt: string;
};

export type ServerFrame =
  | {
      t: "hello";
      v: number;
      room: string;
      serverTime: number;
      frameHz: number;
      settings: Record<string, number>;
      zones: Array<{
        id: string;
        name: string;
        color: string | null;
        zoneType: "polygon" | "circle";
        ring: [number, number][] | null;
        center: [number, number] | null;
        radiusMeters: number;
      }>;
    }
  | { t: "meta"; drivers: DriverMeta[] }
  | { t: "delta"; seq: number; ts: number; e: PositionTuple[]; gone: number[] }
  /**
   * History for drivers this socket has just started seeing. Sent once each; the
   * client extends the tail from the `delta` frames it already receives, so panning
   * back and forth does not re-send the same 10 minutes.
   */
  | { t: "trail"; windowMs: number; tracks: TrailTrack[] }
  | { t: "events"; events: FleetEventFrame[] }
  | { t: "ops"; events: OpsEventFrame[] }
  | { t: "pong"; ts: number }
  | { t: "error"; code: string };

export type ClientFrame =
  | {
      t: "view";
      bbox?: [number, number, number, number] | null;
      statuses?: FleetStatus[] | null;
      zoneId?: string | null;
      partnerId?: string | null;
      driverId?: string | null;
    }
  | { t: "ping" };

export type SocketView = {
  bbox: [number, number, number, number] | null;
  statuses: FleetStatus[] | null;
  zoneId: string | null;
  partnerId: string | null;
  /** Pinned driver: always sent even when outside the viewport, so a followed
   *  driver does not vanish from the rail when the operator pans away. */
  driverId: string | null;
  knownIds: number[];
};

export function emptyView(): SocketView {
  return {
    bbox: null,
    statuses: null,
    zoneId: null,
    partnerId: null,
    driverId: null,
    knownIds: [],
  };
}
