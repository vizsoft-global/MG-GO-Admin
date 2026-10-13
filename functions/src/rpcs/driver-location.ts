import { onCall } from "firebase-functions/v2/https";
import { Timestamp, getFirestore } from "../core/fs";
import { COLLECTIONS, FIELDS } from "../core/collections";
import { kuwaitDayString } from "../core/kuwait";
import { requireRider, riderError } from "../core/rider";
import { haversineMeters } from "../core/geo";
import {
  isoTimestamp,
  logDriverOperation,
  numberOrNull,
  pick,
  pickBoolean,
  pickText,
  pickTriBool,
  type Dict,
} from "./_shared";
import {
  isWithinDeliveryRange,
  loadAssignedRestaurantContext,
  loadDriverZone,
  loadProximitySettings,
} from "./driver-deliveries";

const GEOFENCE_EVENTS = "geofence_events";
const COALESCE_METERS = 18;
const HISTORY_METERS = 75;
const HISTORY_SECONDS = 300;
const ODOMETER_MAX_SEGMENT_M = 500;
const ODOMETER_MAX_SPEED_MPS = 40;
const COARSE_ACCURACY_M = 50;
const COARSE_DEFER_MS = 120_000;
const LIVENESS_MS = 60_000;
const MOVING_SPEED_MPS = 1;

const TRACKING_STATUSES = new Set(["idle", "moving", "delivery_submit"]);

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function asDate(value: unknown): Date | null {
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function pickOptionalNumber(data: Dict, ...names: string[]): number | null {
  return numberOrNull(pick(data, ...names));
}

function latOf(row: Dict): number | null {
  return numberOrNull(row["latitude"]) ?? numberOrNull(row[FIELDS.driverLocations.lat]);
}

function lngOf(row: Dict): number | null {
  return numberOrNull(row["longitude"]) ?? numberOrNull(row[FIELDS.driverLocations.lng]);
}

/** Old builds hold `delivery_submit` for the whole trip with no id. */
export function resolveTrackingStatus(
  status: string,
  deliveryId: string | null,
  speedMps: number | null,
): string {
  if (status !== "delivery_submit" || deliveryId) return status;
  return (speedMps ?? 0) >= MOVING_SPEED_MPS ? "moving" : "idle";
}

export function shouldCoalesceLocation(args: {
  prev: { lastSeenAt: Date; lat: number; lng: number; trackingStatus: string | null } | null;
  now: Date;
  lat: number;
  lng: number;
  status: string;
  minIntervalSeconds: number;
}): boolean {
  if (!args.prev || args.minIntervalSeconds <= 0 || args.status === "delivery_submit") {
    return false;
  }
  const seconds = (args.now.getTime() - args.prev.lastSeenAt.getTime()) / 1000;
  const distance = haversineMeters(args.prev.lat, args.prev.lng, args.lat, args.lng);
  return (
    seconds < args.minIntervalSeconds &&
    distance < COALESCE_METERS &&
    args.prev.trackingStatus === args.status
  );
}

export function odometerSegmentMeters(args: {
  prev: {
    lastSeenAt: Date;
    lat: number;
    lng: number;
    accuracyMeters: number | null;
    day: string;
  } | null;
  now: Date;
  nowDay: string;
  lat: number;
  lng: number;
  accuracyMeters: number | null;
  isMoving: boolean;
}): number {
  if (!args.prev || args.prev.day !== args.nowDay) return 0;
  if (!args.isMoving) return 0;
  const segment = haversineMeters(args.prev.lat, args.prev.lng, args.lat, args.lng);
  if (!Number.isFinite(segment) || segment < 0 || segment > ODOMETER_MAX_SEGMENT_M) return 0;
  if ((args.accuracyMeters ?? 0) > COARSE_ACCURACY_M || (args.prev.accuracyMeters ?? 0) > COARSE_ACCURACY_M) {
    return 0;
  }
  const seconds = (args.now.getTime() - args.prev.lastSeenAt.getTime()) / 1000;
  if (seconds > 0 && segment / seconds > ODOMETER_MAX_SPEED_MPS) return 0;
  return segment;
}

export function shouldWriteLocationHistory(args: {
  force: boolean;
  status: string;
  lastEvent: { lat: number; lng: number; recordedAt: Date; trackingStatus: string | null } | null;
  lat: number;
  lng: number;
  now: Date;
}): boolean {
  if (args.force || args.status === "delivery_submit") return true;
  if (!args.lastEvent) return true;
  if (args.lastEvent.trackingStatus !== args.status) return true;
  const distance = haversineMeters(args.lastEvent.lat, args.lastEvent.lng, args.lat, args.lng);
  const seconds = (args.now.getTime() - args.lastEvent.recordedAt.getTime()) / 1000;
  return distance >= HISTORY_METERS || seconds >= HISTORY_SECONDS;
}

/** Coarse >50 m is deferred for 2 minutes when a last-accurate pin exists. */
export function deferCoarsePin(args: {
  accuracyMeters: number | null;
  lastAccurateAt: Date | null;
  now: Date;
}): boolean {
  if ((args.accuracyMeters ?? 0) <= COARSE_ACCURACY_M) return false;
  if (!args.lastAccurateAt) return false;
  return args.now.getTime() - args.lastAccurateAt.getTime() < COARSE_DEFER_MS;
}

async function locationOf(driverId: string): Promise<{ id: string; data: Dict } | null> {
  const db = getFirestore();
  const byId = await db.collection(COLLECTIONS.driverLocations).doc(driverId).get();
  if (byId.exists) return { id: byId.id, data: (byId.data() ?? {}) as Dict };
  const snap = await db
    .collection(COLLECTIONS.driverLocations)
    .where("driver_id", "==", driverId)
    .limit(1)
    .get();
  if (snap.empty) return null;
  return { id: snap.docs[0].id, data: (snap.docs[0].data() ?? {}) as Dict };
}

async function lastHistoryEvent(driverId: string): Promise<Dict | null> {
  const snap = await getFirestore()
    .collection(COLLECTIONS.driverLocationEvents)
    .where("driver_id", "==", driverId)
    .limit(40)
    .get();
  let best: Dict | null = null;
  let bestAt = -1;
  for (const doc of snap.docs) {
    const data = (doc.data() ?? {}) as Dict;
    const at = asDate(data["recorded_at"])?.getTime() ?? 0;
    if (at >= bestAt) {
      bestAt = at;
      best = data;
    }
  }
  return best;
}

async function deliveryExists(id: string | null): Promise<string | null> {
  if (!id) return null;
  const snap = await getFirestore().collection(COLLECTIONS.deliveries).doc(id).get();
  return snap.exists ? id : null;
}

function geoEventOf(prevStatus: string | null, nextStatus: string): "entry" | "exit" | null {
  if (prevStatus === nextStatus) return null;
  if (prevStatus === "out_of_zone" && nextStatus === "in_zone") return "entry";
  if (prevStatus === "in_zone" && nextStatus === "out_of_zone") return "exit";
  if (prevStatus === null && nextStatus === "in_zone") return "entry";
  return null;
}

export const driverReportLocation = onCall(async (request) => {
  const ctx = await requireRider(request);
  const data = (request.data ?? {}) as Dict;
  const now = new Date();
  const stamp = Timestamp.fromDate(now);
  const nowDay = kuwaitDayString(now);

  const lat = pickOptionalNumber(data, "p_latitude", "latitude");
  const lng = pickOptionalNumber(data, "p_longitude", "longitude");
  if (lat === null || lng === null) {
    throw riderError("invalid-argument", "location_required");
  }

  const rawStatus = (pickText(data, "p_tracking_status", "tracking_status", "trackingStatus") ?? "idle").toLowerCase();
  if (!TRACKING_STATUSES.has(rawStatus)) {
    throw riderError("invalid-argument", "invalid_tracking_status");
  }

  if (ctx.driver["is_on_duty"] !== true) {
    throw riderError("failed-precondition", "driver_off_duty");
  }

  let deliveryId = pickText(data, "p_delivery_id", "delivery_id", "deliveryId");
  let activeDeliveryId = pickText(
    data,
    "p_active_delivery_id",
    "active_delivery_id",
    "activeDeliveryId",
  );
  const speedMps = pickOptionalNumber(data, "p_speed_mps", "speed_mps", "speedMps");
  const accuracyMeters = pickOptionalNumber(
    data,
    "p_accuracy_meters",
    "accuracy_meters",
    "accuracyMeters",
  );
  const status = resolveTrackingStatus(rawStatus, deliveryId, speedMps);
  const forceHistory = pickBoolean(data, "p_force_history", "force_history", "forceHistory");

  [deliveryId, activeDeliveryId] = await Promise.all([
    deliveryExists(deliveryId),
    deliveryExists(activeDeliveryId),
  ]);

  const existing = await locationOf(ctx.uid);
  const prev = existing?.data ?? null;
  const prevLat = prev ? latOf(prev) : null;
  const prevLng = prev ? lngOf(prev) : null;
  const prevSeen = prev ? asDate(prev["last_seen_at"]) ?? asDate(prev[FIELDS.driverLocations.at]) : null;
  const settings = await loadProximitySettings();

  if (
    shouldCoalesceLocation({
      prev:
        prev && prevLat !== null && prevLng !== null && prevSeen
          ? {
              lastSeenAt: prevSeen,
              lat: prevLat,
              lng: prevLng,
              trackingStatus: asString(prev["tracking_status"]),
            }
          : null,
      now,
      lat,
      lng,
      status,
      minIntervalSeconds: settings.minIntervalSeconds,
    })
  ) {
    const lastReport = asDate(prev?.["last_report_at"]) ?? prevSeen;
    if (existing && (!lastReport || now.getTime() - lastReport.getTime() >= LIVENESS_MS)) {
      const count = numberOrNull(prev?.["coalesced_since_count"]) ?? 0;
      await getFirestore()
        .collection(COLLECTIONS.driverLocations)
        .doc(existing.id)
        .set(
          {
            last_report_at: stamp,
            coalesced_since_count: count + 1,
          },
          { merge: true },
        );
    }
    return {
      zone_status: asString(prev?.["zone_status"]) ?? "unknown",
      in_range: asString(prev?.["zone_status"]) !== "out_of_zone",
      last_seen_at: isoTimestamp(prev?.["last_seen_at"]) ?? prevSeen?.toISOString() ?? null,
      history_written: false,
      tracking_status: asString(prev?.["tracking_status"]),
      speed_mps: numberOrNull(prev?.["speed_mps"]),
      distance_today_meters: numberOrNull(prev?.["distance_today_meters"]) ?? 0,
      coalesced: true,
    };
  }

  const [assigned, zone] = await Promise.all([
    loadAssignedRestaurantContext(ctx.uid, ctx.driver),
    loadDriverZone(asString(ctx.driver["zone_id"])),
  ]);
  const inRange =
    settings.proximityMeters <= 0
      ? true
      : isWithinDeliveryRange({
          lat,
          lng,
          proximityMeters: settings.proximityMeters,
          zone,
          restaurants: assigned.map((row) => ({ restaurant: row.data, geofences: row.geofences })),
        });
  const zoneStatus =
    settings.proximityMeters <= 0 ? "unknown" : inRange ? "in_zone" : "out_of_zone";

  const isMoving = status === "moving" || status === "delivery_submit" || (speedMps ?? 0) >= MOVING_SPEED_MPS;
  const prevDay = prev
    ? asString(prev[FIELDS.driverLocations.day]) ??
      (prevSeen ? kuwaitDayString(prevSeen) : null)
    : null;
  const segment =
    prev && prevLat !== null && prevLng !== null && prevSeen && prevDay
      ? odometerSegmentMeters({
          prev: {
            lastSeenAt: prevSeen,
            lat: prevLat,
            lng: prevLng,
            accuracyMeters: numberOrNull(prev["accuracy_meters"]),
            day: prevDay,
          },
          now,
          nowDay,
          lat,
          lng,
          accuracyMeters,
          isMoving,
        })
      : 0;
  const distanceToday =
    prev && prevDay === nowDay
      ? (numberOrNull(prev["distance_today_meters"]) ?? 0) + segment
      : 0;

  const lastAccurateAt = asDate(prev?.["last_accurate_at"]);
  const lastAccurateLat = numberOrNull(prev?.["last_accurate_lat"]);
  const lastAccurateLng = numberOrNull(prev?.["last_accurate_lng"]);
  const deferred = deferCoarsePin({
    accuracyMeters,
    lastAccurateAt,
    now,
  });
  const pinLat = deferred && lastAccurateLat !== null ? lastAccurateLat : lat;
  const pinLng = deferred && lastAccurateLng !== null ? lastAccurateLng : lng;
  const keepAccurate =
    (accuracyMeters ?? 0) <= COARSE_ACCURACY_M
      ? { last_accurate_at: stamp, last_accurate_lat: lat, last_accurate_lng: lng }
      : {
          last_accurate_at: lastAccurateAt ? Timestamp.fromDate(lastAccurateAt) : null,
          last_accurate_lat: lastAccurateLat,
          last_accurate_lng: lastAccurateLng,
        };

  const prevZone = asString(prev?.["zone_status"]);
  const outOfZoneSince =
    zoneStatus === "out_of_zone"
      ? prevZone === "out_of_zone"
        ? (prev?.["out_of_zone_since"] ?? stamp)
        : stamp
      : null;

  const live: Dict = {
    driver_id: ctx.uid,
    [FIELDS.driverLocations.lat]: pinLat,
    [FIELDS.driverLocations.lng]: pinLng,
    latitude: pinLat,
    longitude: pinLng,
    [FIELDS.driverLocations.at]: stamp,
    [FIELDS.driverLocations.day]: nowDay,
    speed_mps: speedMps,
    accuracy_meters: accuracyMeters,
    battery_pct: pickOptionalNumber(data, "p_battery_pct", "battery_pct", "batteryPct"),
    heading_deg: pickOptionalNumber(data, "p_heading_deg", "heading_deg", "headingDeg"),
    altitude_m: pickOptionalNumber(data, "p_altitude_m", "altitude_m", "altitudeM"),
    network_type: pickText(data, "p_network_type", "network_type", "networkType"),
    charging_state: pickText(data, "p_charging_state", "charging_state", "chargingState"),
    is_mocked: pickTriBool(data, "p_is_mocked", "is_mocked", "isMocked") ?? null,
    location_provider: pickText(data, "p_location_provider", "location_provider", "locationProvider"),
    active_delivery_id: activeDeliveryId,
    tracking_status: status,
    zone_status: zoneStatus,
    distance_today_meters: distanceToday,
    last_seen_at: stamp,
    last_report_at: stamp,
    coalesced_since_count: 0,
    out_of_zone_since: outOfZoneSince,
    ...keepAccurate,
    updated_at: stamp,
  };

  const locRef = getFirestore().collection(COLLECTIONS.driverLocations).doc(ctx.uid);
  await locRef.set(live, { merge: true });

  const flip = geoEventOf(prevZone, zoneStatus);
  if (flip) {
    await getFirestore().collection(GEOFENCE_EVENTS).add({
      zone_id: asString(ctx.driver["zone_id"]),
      driver_id: ctx.uid,
      event_type: flip,
      latitude: lat,
      longitude: lng,
      accuracy_meters: accuracyMeters,
      source: "tracking",
      occurred_at: stamp,
      metadata: {
        basis: "delivery_range",
        from: prevZone,
        to: zoneStatus,
        proximity_meters: settings.proximityMeters,
      },
    });
    await logDriverOperation({
      driverId: ctx.uid,
      module: "location",
      action: flip === "entry" ? "location.zone_entry" : "location.zone_exit",
      actor: "driver_report_location",
      success: true,
      recordType: "zone",
      recordId: asString(ctx.driver["zone_id"]),
      detail: { from: prevZone, to: zoneStatus },
    });
  }

  const lastEvent = await lastHistoryEvent(ctx.uid);
  const lastEventLat = lastEvent ? latOf(lastEvent) : null;
  const lastEventLng = lastEvent ? lngOf(lastEvent) : null;
  const lastEventAt = lastEvent ? asDate(lastEvent["recorded_at"]) : null;
  const historyWritten = shouldWriteLocationHistory({
    force: forceHistory,
    status,
    lastEvent:
      lastEvent && lastEventLat !== null && lastEventLng !== null && lastEventAt
        ? {
            lat: lastEventLat,
            lng: lastEventLng,
            recordedAt: lastEventAt,
            trackingStatus: asString(lastEvent["tracking_status"]),
          }
        : null,
    lat,
    lng,
    now,
  });

  if (historyWritten) {
    await getFirestore().collection(COLLECTIONS.driverLocationEvents).add({
      driver_id: ctx.uid,
      latitude: lat,
      longitude: lng,
      [FIELDS.driverLocations.lat]: lat,
      [FIELDS.driverLocations.lng]: lng,
      speed_mps: speedMps,
      accuracy_meters: accuracyMeters,
      battery_pct: live["battery_pct"],
      heading_deg: live["heading_deg"],
      altitude_m: live["altitude_m"],
      network_type: live["network_type"],
      charging_state: live["charging_state"],
      is_mocked: live["is_mocked"],
      location_provider: live["location_provider"],
      active_delivery_id: activeDeliveryId,
      tracking_status: status,
      zone_status: zoneStatus,
      delivery_id: deliveryId,
      recorded_at: stamp,
      [FIELDS.driverLocations.day]: nowDay,
    });
  }

  return {
    zone_status: zoneStatus,
    in_range: inRange,
    last_seen_at: now.toISOString(),
    history_written: historyWritten,
    tracking_status: status,
    speed_mps: speedMps,
    distance_today_meters: distanceToday,
    coalesced: false,
  };
});

export const driverClearLiveLocation = onCall(async (request) => {
  const ctx = await requireRider(request);
  if (ctx.driver["is_on_duty"] !== true) {
    return { cleared: false, reason: "off_duty" };
  }

  const existing = await locationOf(ctx.uid);
  if (!existing) return { cleared: false };

  const lat = latOf(existing.data);
  const lng = lngOf(existing.data);
  await getFirestore().collection(COLLECTIONS.driverLocations).doc(existing.id).delete();
  await logDriverOperation({
    driverId: ctx.uid,
    module: "location",
    action: "location.cleared",
    actor: "driver_clear_live_location",
    success: true,
    detail: { basis: "os_location_off", lat, lng },
  });
  return { cleared: true };
});
