/**
 * Firestore writers that replace `admin_ingest_driver_positions` and
 * `admin_record_fleet_events`. Called only from the worker HTTPS wrappers.
 */
import { Timestamp, getFirestore } from "../core/fs";
import { COLLECTIONS, FIELDS } from "../core/collections";
import { kuwaitDayString } from "../core/kuwait";
import { chunk, logDriverOperation, numberOrNull, type Dict } from "./_shared";
import {
  isWithinDeliveryRange,
  loadAssignedRestaurantContext,
  loadDriverZone,
  loadProximitySettings,
} from "./driver-deliveries";
import { odometerSegmentMeters, shouldWriteLocationHistory } from "./driver-location";
import {
  clampHistoryRecordedAt,
  parseFleetEventBatch,
  parseIngestBatch,
  pinWriteAllowed,
  shouldCoalesceIngestPin,
  sortIngestPoints,
  type FleetEventDraft,
  type IngestPoint,
} from "./fleet-ingest-rules";

const GEOFENCE_EVENTS = "geofence_events";
const LIVENESS_MS = 60_000;
const WRITE_CHUNK = 400;
const READ_CHUNK = 100;
const DRIVER_POOL = 8;

type Put = { collection: string; id: string; data: Dict };

type Skipped = { driver_id: string; reason: "unknown_driver" | "off_duty" };

export type IngestResult =
  | { ok: false; error: string; received?: number }
  | {
      ok: true;
      received: number;
      accepted: number;
      invalid: number;
      live_updates: number;
      coalesced: number;
      history_rows: number;
      replay_rows: number;
      skipped: Skipped[];
      server_time: string;
    };

export type FleetEventResult =
  | { ok: false; error: string; received?: number }
  | { ok: true; received: number; inserted: number; rejected: number };

type DriverOutcome = {
  puts: Put[];
  logs: Array<{ driverId: string; action: string; zoneId: string | null; from: string | null; to: string }>;
  liveUpdates: number;
  coalesced: number;
  historyRows: number;
  replayRows: number;
  skipped: Skipped | null;
};

function asDate(value: unknown): Date | null {
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function latOf(row: Dict | null): number | null {
  if (!row) return null;
  return numberOrNull(row.latitude) ?? numberOrNull(row[FIELDS.driverLocations.lat]);
}

function lngOf(row: Dict | null): number | null {
  if (!row) return null;
  return numberOrNull(row.longitude) ?? numberOrNull(row[FIELDS.driverLocations.lng]);
}

function archived(data: Dict): boolean {
  const value = data.archived_at;
  return value !== null && value !== undefined && value !== "";
}

function zoneFlip(prev: string | null, next: string): "entry" | "exit" | null {
  if (prev === next) return null;
  if (prev === "out_of_zone" && next === "in_zone") return "entry";
  if (prev === "in_zone" && next === "out_of_zone") return "exit";
  if (prev === null && next === "in_zone") return "entry";
  return null;
}

function moving(point: IngestPoint): boolean {
  return (
    point.trackingStatus === "moving" ||
    point.trackingStatus === "delivery_submit" ||
    (point.speedMps ?? 0) >= 1
  );
}

async function mapPool<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      const item = items[index];
      if (item === undefined) return;
      out[index] = await fn(item);
    }
  });
  await Promise.all(workers);
  return out;
}

async function loadDocs(collection: string, ids: readonly string[]): Promise<Map<string, Dict>> {
  const db = getFirestore();
  const out = new Map<string, Dict>();
  const unique = [...new Set(ids)];
  for (const group of chunk(unique, READ_CHUNK)) {
    const refs = group.map((id) => db.collection(collection).doc(id));
    const snaps = await db.getAll(...refs);
    for (const snap of snaps) {
      if (snap.exists) out.set(snap.id, (snap.data() ?? {}) as Dict);
    }
  }
  return out;
}

async function commitPuts(puts: readonly Put[]): Promise<void> {
  if (puts.length === 0) return;
  const db = getFirestore();
  const unique = new Map<string, Put>();
  for (const put of puts) unique.set(`${put.collection}/${put.id}`, put);
  for (const group of chunk([...unique.values()], WRITE_CHUNK)) {
    const batch = db.batch();
    for (const put of group) {
      batch.set(db.collection(put.collection).doc(put.id), put.data, { merge: true });
    }
    await batch.commit();
  }
}

function historyPut(point: IngestPoint, recordedAt: Date, zoneStatus: string | null, id: string): Put {
  return {
    collection: COLLECTIONS.driverLocationEvents,
    id,
    data: {
      driver_id: point.driverId,
      latitude: point.lat,
      longitude: point.lng,
      [FIELDS.driverLocations.lat]: point.lat,
      [FIELDS.driverLocations.lng]: point.lng,
      speed_mps: point.speedMps,
      accuracy_meters: point.accuracyM,
      battery_pct: point.batteryPct,
      heading_deg: point.headingDeg,
      altitude_m: point.altitudeM,
      network_type: point.networkType,
      charging_state: point.chargingState,
      is_mocked: point.isMocked,
      location_provider: point.locationProvider,
      active_delivery_id: point.activeDeliveryId,
      tracking_status: point.trackingStatus,
      zone_status: zoneStatus,
      delivery_id: point.deliveryId,
      recorded_at: Timestamp.fromDate(recordedAt),
      [FIELDS.driverLocations.day]: kuwaitDayString(recordedAt),
    },
  };
}

async function lastHistory(driverId: string): Promise<{
  lat: number;
  lng: number;
  recordedAt: Date;
  trackingStatus: string | null;
} | null> {
  const snap = await getFirestore()
    .collection(COLLECTIONS.driverLocationEvents)
    .where("driver_id", "==", driverId)
    .orderBy("recorded_at", "desc")
    .limit(1)
    .get();
  const data = snap.docs[0]?.data() as Dict | undefined;
  if (!data) return null;
  const lat = latOf(data);
  const lng = lngOf(data);
  const recordedAt = asDate(data.recorded_at);
  if (lat === null || lng === null || !recordedAt) return null;
  return { lat, lng, recordedAt, trackingStatus: text(data.tracking_status) };
}

function emptyOutcome(): DriverOutcome {
  return {
    puts: [],
    logs: [],
    liveUpdates: 0,
    coalesced: 0,
    historyRows: 0,
    replayRows: 0,
    skipped: null,
  };
}

async function ingestDriver(args: {
  driverId: string;
  points: IngestPoint[];
  driver: Dict | undefined;
  location: Dict | undefined;
  now: Date;
  nowDay: string;
  proximityMeters: number;
  minIntervalSeconds: number;
}): Promise<DriverOutcome> {
  const outcome = emptyOutcome();
  if (!args.driver || archived(args.driver)) {
    outcome.skipped = { driver_id: args.driverId, reason: "unknown_driver" };
    return outcome;
  }

  const live = args.points.filter((point) => !point.replay);
  const replay = args.points.filter((point) => point.replay);
  for (const point of replay) {
    outcome.puts.push(
      historyPut(point, point.clientTs, null, `r_${point.driverId}_${point.clientTs.getTime()}`),
    );
    outcome.replayRows += 1;
  }

  if (live.length === 0) return outcome;
  if (args.driver.is_on_duty !== true) {
    outcome.skipped = { driver_id: args.driverId, reason: "off_duty" };
    return outcome;
  }

  const location = args.location ?? null;
  const prevLat = latOf(location);
  const prevLng = lngOf(location);
  const prevSeen = asDate(location?.last_seen_at);
  const prevZone = text(location?.zone_status);
  const lastWrite = asDate(location?.updated_at);
  const stamp = Timestamp.fromDate(args.now);

  let distance = 0;
  let odo: {
    lastSeenAt: Date;
    lat: number;
    lng: number;
    accuracyMeters: number | null;
    day: string;
  } | null = null;
  if (prevSeen && kuwaitDayString(prevSeen) === args.nowDay && prevLat !== null && prevLng !== null) {
    distance = numberOrNull(location?.distance_today_meters) ?? 0;
    odo = {
      lastSeenAt: prevSeen,
      lat: prevLat,
      lng: prevLng,
      accuracyMeters: numberOrNull(location?.accuracy_meters),
      day: args.nowDay,
    };
  }

  const zoneId = text(args.driver.zone_id);
  const [assigned, zone, history] = await Promise.all([
    args.proximityMeters > 0
      ? loadAssignedRestaurantContext(args.driverId, args.driver)
      : Promise.resolve([]),
    args.proximityMeters > 0 ? loadDriverZone(zoneId) : Promise.resolve(null),
    lastHistory(args.driverId),
  ]);
  const restaurants = assigned.map((row) => ({ restaurant: row.data, geofences: row.geofences }));
  let lastEvent = history;

  let zoneStatus = "unknown";
  for (const point of live) {
    if (args.proximityMeters <= 0) {
      zoneStatus = "unknown";
    } else {
      const inRange = isWithinDeliveryRange({
        lat: point.lat,
        lng: point.lng,
        proximityMeters: args.proximityMeters,
        zone,
        restaurants,
      });
      zoneStatus = inRange ? "in_zone" : "out_of_zone";
    }

    distance += odometerSegmentMeters({
      prev: odo,
      now: point.clientTs,
      nowDay: args.nowDay,
      lat: point.lat,
      lng: point.lng,
      accuracyMeters: point.accuracyM,
      isMoving: moving(point),
    });
    odo = {
      lastSeenAt: point.clientTs,
      lat: point.lat,
      lng: point.lng,
      accuracyMeters: point.accuracyM,
      day: args.nowDay,
    };

    const recordedAt = clampHistoryRecordedAt(point.clientTs, args.now);
    const writeHistory = shouldWriteLocationHistory({
      force: false,
      status: point.trackingStatus,
      lastEvent,
      lat: point.lat,
      lng: point.lng,
      now: recordedAt,
    });
    if (writeHistory) {
      outcome.puts.push(
        historyPut(point, recordedAt, zoneStatus, `h_${point.driverId}_${recordedAt.getTime()}_${point.ord}`),
      );
      outcome.historyRows += 1;
      lastEvent = {
        lat: point.lat,
        lng: point.lng,
        recordedAt,
        trackingStatus: point.trackingStatus,
      };
    }
  }

  const last = live[live.length - 1];
  if (!last) return outcome;

  const coalesce = shouldCoalesceIngestPin({
    prev:
      prevSeen && prevLat !== null && prevLng !== null
        ? {
            lastSeenAt: prevSeen,
            lat: prevLat,
            lng: prevLng,
            trackingStatus: text(location?.tracking_status),
          }
        : null,
    now: args.now,
    lat: last.lat,
    lng: last.lng,
    status: last.trackingStatus,
    minIntervalSeconds: args.minIntervalSeconds,
    prevZoneStatus: prevZone,
    zoneStatus,
  });

  const allowPin = pinWriteAllowed(lastWrite?.getTime() ?? null, args.now.getTime());
  if (coalesce) {
    outcome.coalesced += 1;
    const lastReport = asDate(location?.last_report_at) ?? prevSeen;
    if (allowPin && (!lastReport || args.now.getTime() - lastReport.getTime() >= LIVENESS_MS)) {
      outcome.puts.push({
        collection: COLLECTIONS.driverLocations,
        id: args.driverId,
        data: {
          driver_id: args.driverId,
          last_report_at: stamp,
          coalesced_since_count: (numberOrNull(location?.coalesced_since_count) ?? 0) + 1,
          updated_at: stamp,
        },
      });
    }
    return outcome;
  }

  if (!allowPin) return outcome;

  const outOfZoneSince =
    zoneStatus === "out_of_zone"
      ? prevZone === "out_of_zone" && location?.out_of_zone_since
        ? location.out_of_zone_since
        : stamp
      : null;

  outcome.puts.push({
    collection: COLLECTIONS.driverLocations,
    id: args.driverId,
    data: {
      driver_id: args.driverId,
      latitude: last.lat,
      longitude: last.lng,
      [FIELDS.driverLocations.lat]: last.lat,
      [FIELDS.driverLocations.lng]: last.lng,
      [FIELDS.driverLocations.at]: stamp,
      [FIELDS.driverLocations.day]: args.nowDay,
      speed_mps: last.speedMps,
      accuracy_meters: last.accuracyM,
      battery_pct: last.batteryPct,
      heading_deg: last.headingDeg,
      altitude_m: last.altitudeM,
      network_type: last.networkType,
      charging_state: last.chargingState,
      is_mocked: last.isMocked,
      location_provider: last.locationProvider,
      active_delivery_id: last.activeDeliveryId,
      tracking_status: last.trackingStatus,
      zone_status: zoneStatus,
      distance_today_meters: distance,
      last_seen_at: stamp,
      last_report_at: stamp,
      coalesced_since_count: 0,
      out_of_zone_since: outOfZoneSince,
      updated_at: stamp,
    },
  });
  outcome.liveUpdates += 1;

  const flip = zoneFlip(prevZone, zoneStatus);
  if (flip) {
    outcome.puts.push({
      collection: GEOFENCE_EVENTS,
      id: `g_${args.driverId}_${args.now.getTime()}`,
      data: {
        zone_id: zoneId,
        driver_id: args.driverId,
        event_type: flip,
        latitude: last.lat,
        longitude: last.lng,
        accuracy_meters: last.accuracyM,
        source: "fleet_edge",
        occurred_at: stamp,
        metadata: { basis: "delivery_range", from: prevZone, to: zoneStatus },
      },
    });
    outcome.logs.push({
      driverId: args.driverId,
      action: flip === "entry" ? "location.zone_entry" : "location.zone_exit",
      zoneId,
      from: prevZone,
      to: zoneStatus,
    });
  }
  return outcome;
}

function groupDrivers(points: readonly IngestPoint[]): Array<{ driverId: string; points: IngestPoint[] }> {
  const groups: Array<{ driverId: string; points: IngestPoint[] }> = [];
  for (const point of points) {
    const last = groups[groups.length - 1];
    if (last && last.driverId === point.driverId) last.points.push(point);
    else groups.push({ driverId: point.driverId, points: [point] });
  }
  return groups;
}

export async function runIngestDriverPositions(raw: unknown, now = new Date()): Promise<IngestResult> {
  const parsed = parseIngestBatch(raw, now);
  if (!parsed.ok) return parsed;
  const accepted = parsed.points.length;
  const base = {
    received: parsed.received,
    accepted,
    invalid: parsed.received - accepted,
    server_time: now.toISOString(),
  };
  if (accepted === 0) {
    return {
      ok: true,
      ...base,
      live_updates: 0,
      coalesced: 0,
      history_rows: 0,
      replay_rows: 0,
      skipped: [],
    };
  }

  const groups = groupDrivers(sortIngestPoints(parsed.points));
  const ids = groups.map((group) => group.driverId);
  const [drivers, locations, settings] = await Promise.all([
    loadDocs(COLLECTIONS.drivers, ids),
    loadDocs(COLLECTIONS.driverLocations, ids),
    loadProximitySettings(),
  ]);
  const nowDay = kuwaitDayString(now);
  const outcomes = await mapPool(groups, DRIVER_POOL, (group) =>
    ingestDriver({
      driverId: group.driverId,
      points: group.points,
      driver: drivers.get(group.driverId),
      location: locations.get(group.driverId),
      now,
      nowDay,
      proximityMeters: settings.proximityMeters,
      minIntervalSeconds: settings.minIntervalSeconds,
    }),
  );

  const puts = outcomes.flatMap((outcome) => outcome.puts);
  await commitPuts(puts);
  for (const outcome of outcomes) {
    for (const entry of outcome.logs) {
      await logDriverOperation({
        driverId: entry.driverId,
        module: "location",
        action: entry.action,
        actor: "adminIngestDriverPositions",
        success: true,
        recordType: "zone",
        recordId: entry.zoneId,
        detail: { from: entry.from, to: entry.to, source: "fleet_edge" },
      });
    }
  }

  return {
    ok: true,
    ...base,
    live_updates: outcomes.reduce((sum, outcome) => sum + outcome.liveUpdates, 0),
    coalesced: outcomes.reduce((sum, outcome) => sum + outcome.coalesced, 0),
    history_rows: outcomes.reduce((sum, outcome) => sum + outcome.historyRows, 0),
    replay_rows: outcomes.reduce((sum, outcome) => sum + outcome.replayRows, 0),
    skipped: outcomes.flatMap((outcome) => (outcome.skipped ? [outcome.skipped] : [])),
  };
}

export async function runRecordFleetEvents(raw: unknown, now = new Date()): Promise<FleetEventResult> {
  const parsed = parseFleetEventBatch(raw, now);
  if (!parsed.ok) return parsed;
  if (parsed.events.length === 0) {
    return { ok: true, received: parsed.received, inserted: 0, rejected: parsed.received };
  }
  const drivers = await loadDocs(
    COLLECTIONS.drivers,
    parsed.events.map((event) => event.driverId),
  );
  const puts: Put[] = [];
  parsed.events.forEach((event: FleetEventDraft, index) => {
    if (!drivers.has(event.driverId)) return;
    const idNum = now.getTime() * 1000 + index;
    puts.push({
      collection: COLLECTIONS.fleetEvents,
      id: String(idNum),
      data: {
        id: idNum,
        driver_id: event.driverId,
        event_key: event.eventKey,
        severity: event.severity,
        status_before: event.statusBefore,
        status_after: event.statusAfter,
        value: event.value,
        zone_id: event.zoneId,
        latitude: event.latitude,
        longitude: event.longitude,
        context: event.context,
        detected_at: Timestamp.fromDate(event.detectedAt),
        source: event.source,
      },
    });
  });
  await commitPuts(puts);
  return {
    ok: true,
    received: parsed.received,
    inserted: puts.length,
    rejected: parsed.received - puts.length,
  };
}
