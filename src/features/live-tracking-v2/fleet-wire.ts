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

export const WIRE_VERSION = 1;

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
 * [idIdx, lat*1e5, lng*1e5, speed in dm/s, heading deg, statusCode, flagBits, ageDeciseconds]
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
];

export function encodePosition(input: {
  idIdx: number;
  lat: number;
  lng: number;
  speedMps: number | null;
  headingDeg: number | null;
  status: FleetStatus;
  flags: FleetFlagSet;
  ageMs: number;
}): PositionTuple {
  return [
    input.idIdx,
    Math.round(input.lat * 1e5),
    Math.round(input.lng * 1e5),
    Math.max(0, Math.round((input.speedMps ?? 0) * 10)),
    Math.max(0, Math.round(input.headingDeg ?? 0)) % 360,
    statusCode(input.status),
    flagBits(input.flags),
    Math.max(0, Math.min(65535, Math.round(input.ageMs / 100))),
  ];
}

export function decodePosition(tuple: PositionTuple) {
  return {
    idIdx: tuple[0],
    lat: tuple[1] / 1e5,
    lng: tuple[2] / 1e5,
    speedMps: tuple[3] / 10,
    headingDeg: tuple[4],
    status: statusFromCode(tuple[5]),
    flags: flagsFromBits(tuple[6]),
    ageMs: tuple[7] * 100,
  };
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
