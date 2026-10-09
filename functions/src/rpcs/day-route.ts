import { HttpsError, onCall } from "firebase-functions/v2/https";
import { getFirestore, Timestamp } from "../core/fs";
import { COLLECTIONS, FIELDS } from "../core/collections";
import { haversineMeters, simplifyPath } from "../core/geo";
import { kuwaitDayString, kuwaitDayEnd, kuwaitDayStart } from "../core/kuwait";
import { parseId, parseInstant } from "../core/query";
import { requireStaff } from "../core/staff";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A coarse fix is a claim about a cell tower, not about the rider. */
const MAX_ACCURACY_M = 50;

/**
 * A segment is travel only if the path between its ends was actually observed.
 * `>40 m/s` is a glitch between two fixes seconds apart; `>500 m` is a hole in
 * the reporting, whatever speed it implies — history is written at ≥75 m spacing
 * while moving, so two consecutive fixes a kilometre apart mean a dozen rows that
 * were never written.
 */
const MAX_SEGMENT_M = 500;
const MAX_SPEED_MPS = 40;

/** A stop is a run of fixes inside 60 m spanning at least three minutes. */
const STOP_RADIUS_M = 60;
const STOP_MIN_SECONDS = 180;

/** The scan ceiling for one driver-day; a 1 Hz tour is ~86k, a shift is far less. */
const EVENT_SCAN_CAP = 20_000;

type EventPoint = {
  idx: number;
  lat: number;
  lng: number;
  speed_mps: number | null;
  battery_pct: number | null;
  accuracy_meters: number | null;
  heading_deg: number | null;
  tracking_status: string | null;
  zone_status: string | null;
  active_delivery_id: string | null;
  recorded_at: Timestamp;
  is_jump: boolean;
  jumps_so_far: number;
};

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length ? value : null;
}

function asTimestamp(value: unknown): Timestamp | null {
  if (value instanceof Timestamp) return value;
  const date = value instanceof Date ? value : null;
  return date ? Timestamp.fromDate(date) : null;
}

/**
 * `admin_get_driver_day_route`.
 *
 * The SQL read `driver_location_events` for the whole day, filtered coarse fixes,
 * then derived the polyline, the jumps, the stops and the day's deliveries. The
 * only change here is where the row stream comes from: one query on
 * `(driver_id, day)` instead of a Postgres range scan, which is what keeps a
 * 1 Hz tour from being a collection scan.
 */
export const adminGetDriverDayRoute = onCall(async (request) => {
  await requireStaff(request, "drivers.view");

  const data = (request.data ?? {}) as Record<string, unknown>;
  const driverId = parseId(data.driverId);
  if (!driverId) throw new HttpsError("invalid-argument", "driver_id_required");

  const now = new Date();
  const today = kuwaitDayString(now);
  const day = typeof data.date === "string" && DAY_RE.test(data.date) ? data.date : today;
  const from = parseInstant(data.from, "from") ?? kuwaitDayStart(day);
  const to = parseInstant(data.to, "to") ?? kuwaitDayEnd(day);

  const requestedTolerance = asNumber(data.toleranceMeters) ?? 8;
  const tolerance = Math.max(requestedTolerance, 0);

  const db = getFirestore();
  const eventsSnap = await db
    .collection(COLLECTIONS.driverLocationEvents)
    .where(FIELDS.driverLocations.driverId, "==", driverId)
    .where(FIELDS.driverLocations.day, "==", day)
    .orderBy(FIELDS.driverLocations.at, "asc")
    .limit(EVENT_SCAN_CAP)
    .get();

  const rawPoints: Array<{ lat: number; lng: number; at: Timestamp; doc: Record<string, unknown> }> = [];
  for (const doc of eventsSnap.docs) {
    const raw = doc.data();
    const lat = asNumber(raw["latitude"] ?? raw[FIELDS.driverLocations.lat]);
    const lng = asNumber(raw["longitude"] ?? raw[FIELDS.driverLocations.lng]);
    const at = asTimestamp(raw[FIELDS.driverLocations.at]);
    if (lat === null || lng === null || !at) continue;

    const accuracy = asNumber(raw[FIELDS.driverLocations.accuracyMeters]);
    if (accuracy !== null && accuracy > MAX_ACCURACY_M) continue;

    rawPoints.push({ lat, lng, at, doc: raw });
  }

  const total = rawPoints.length;
  const durationSeconds =
    total > 1
      ? Math.max(0, Math.round((rawPoints[total - 1].at.toMillis() - rawPoints[0].at.toMillis()) / 1000))
      : 0;

  // Every segment of the full series, with the time it spans, so jumps can be
  // flagged before simplification folds them away.
  const points: EventPoint[] = rawPoints.map((point, index) => {
    const speed = asNumber(point.doc[FIELDS.driverLocations.speedMps]);
    return {
      idx: index + 1,
      lat: point.lat,
      lng: point.lng,
      speed_mps: speed,
      battery_pct: asNumber(point.doc["battery_pct"]),
      accuracy_meters: asNumber(point.doc[FIELDS.driverLocations.accuracyMeters]),
      heading_deg: asNumber(point.doc["heading_deg"]),
      tracking_status: asString(point.doc["tracking_status"]),
      zone_status: asString(point.doc["zone_status"]),
      active_delivery_id: asString(point.doc["active_delivery_id"]),
      recorded_at: point.at,
      is_jump: false,
      jumps_so_far: 0,
    };
  });

  let distanceMeters = 0;
  let gapDistanceMeters = 0;
  let gapSeconds = 0;
  let gapCount = 0;

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const meters = haversineMeters(previous.lat, previous.lng, current.lat, current.lng);
    const gapS = Math.max(
      (current.recorded_at.toMillis() - previous.recorded_at.toMillis()) / 1000,
      0.001,
    );
    const isJump = meters > MAX_SEGMENT_M || meters / gapS > MAX_SPEED_MPS;
    current.is_jump = isJump;
    if (isJump) {
      gapDistanceMeters += meters;
      gapSeconds += gapS;
      gapCount += 1;
    } else {
      distanceMeters += meters;
    }
    current.jumps_so_far = previous.jumps_so_far + (isJump ? 1 : 0);
  }

  const kept = simplifyPath<EventPoint>(
    points.map((point) => ({ point, lat: point.lat, lng: point.lng })),
    total >= 3 ? tolerance : 0,
  );

  let previousJumps = 0;
  let firstKept = true;
  const keptPoints = kept.map((entry) => {
    const point = entry.point;
    const gapBefore = point.jumps_so_far > previousJumps && !firstKept;
    previousJumps = point.jumps_so_far;
    firstKept = false;
    return {
      idx: point.idx,
      latitude: point.lat,
      longitude: point.lng,
      speed_mps: point.speed_mps,
      battery_pct: point.battery_pct,
      accuracy_meters: point.accuracy_meters,
      heading_deg: point.heading_deg,
      tracking_status: point.tracking_status,
      zone_status: point.zone_status,
      active_delivery_id: point.active_delivery_id,
      recorded_at: point.recorded_at.toDate().toISOString(),
      gap_before: gapBefore,
    };
  });

  const stops = deriveStops(points);
  const deliveries = await loadDayDeliveries(driverId, from, to);

  // For today the odometer is the authority: it is maintained in O(1) by the
  // ingest that holds both endpoints, while the sampled sum is a 75 m-spaced
  // polyline that reads low on a winding route.
  let odometerMeters: number | null = null;
  if (day === today) {
    const locationSnap = await db.collection(COLLECTIONS.driverLocations).doc(driverId).get();
    const seen = asTimestamp(locationSnap.get(FIELDS.driverLocations.at));
    if (seen && kuwaitDayString(seen.toDate()) === today) {
      odometerMeters = asNumber(locationSnap.get(FIELDS.driverLocations.distanceTodayMeters));
    }
  }

  return {
    driver_id: driverId,
    date: day,
    from: from.toISOString(),
    to: to.toISOString(),
    points: keptPoints,
    stops,
    deliveries,
    distance_m: odometerMeters ?? Math.round(distanceMeters * 100) / 100,
    sampled_distance_m: Math.round(distanceMeters * 100) / 100,
    distance_source: odometerMeters === null ? "sampled" : "odometer",
    gap_distance_m: Math.round(gapDistanceMeters * 100) / 100,
    gap_seconds: Math.round(gapSeconds),
    gap_count: gapCount,
    duration_s: durationSeconds,
    point_count: total,
    kept_count: keptPoints.length,
  };
});

/** A run of fixes inside 60 m spanning at least three minutes, averaged. */
function deriveStops(points: EventPoint[]) {
  const runs: Array<{ sumLat: number; sumLng: number; fixes: number; from: Date; to: Date }> = [];
  let current: { sumLat: number; sumLng: number; fixes: number; from: Date; to: Date } | null = null;

  for (const point of points) {
    const at = point.recorded_at.toDate();
    if (!current) {
      current = { sumLat: point.lat, sumLng: point.lng, fixes: 1, from: at, to: at };
      continue;
    }
    if (haversineMeters(current.sumLat / current.fixes, current.sumLng / current.fixes, point.lat, point.lng) > STOP_RADIUS_M) {
      runs.push(current);
      current = { sumLat: point.lat, sumLng: point.lng, fixes: 1, from: at, to: at };
      continue;
    }
    current.sumLat += point.lat;
    current.sumLng += point.lng;
    current.fixes += 1;
    current.to = at;
  }
  if (current) runs.push(current);

  return runs
    .map((run) => ({
      latitude: Math.round((run.sumLat / run.fixes) * 1e6) / 1e6,
      longitude: Math.round((run.sumLng / run.fixes) * 1e6) / 1e6,
      arrived_at: run.from.toISOString(),
      departed_at: run.to.toISOString(),
      fixes: run.fixes,
      seconds: Math.round((run.to.getTime() - run.from.getTime()) / 1000),
    }))
    .filter((stop) => stop.seconds >= STOP_MIN_SECONDS)
    .sort((a, b) => Date.parse(a.arrived_at) - Date.parse(b.arrived_at));
}

/**
 * The day's three delivery markers.
 *
 * Three queries rather than one: Firestore cannot OR across `pickup_at`,
 * `delivered_at` and `cancelled_at`, and a client-side filter over every delivery
 * the rider ever made would read the whole history to draw three pins.
 */
async function loadDayDeliveries(driverId: string, from: Date, to: Date) {
  const db = getFirestore();
  const del = FIELDS.deliveries;
  const legs = [
    { kind: "pickup", atField: del.pickupAt, latField: "pickup_lat", lngField: "pickup_lng" },
    { kind: "delivered", atField: del.deliveredAt, latField: "delivered_lat", lngField: "delivered_lng" },
    { kind: "cancelled", atField: "cancelled_at", latField: "cancel_lat", lngField: "cancel_lng" },
  ] as const;

  const results = await Promise.all(
    legs.map((leg) =>
      db
        .collection(COLLECTIONS.deliveries)
        .where(del.driverId, "==", driverId)
        .where(leg.atField, ">=", Timestamp.fromDate(from))
        .where(leg.atField, "<", Timestamp.fromDate(to))
        .get(),
    ),
  );

  const out: Array<Record<string, unknown>> = [];
  results.forEach((snap, index) => {
    const leg = legs[index];
    for (const doc of snap.docs) {
      const raw = doc.data();
      const latitude = asNumber(raw[leg.latField]);
      const longitude = asNumber(raw[leg.lngField]);
      const at = asTimestamp(raw[leg.atField]);
      if (latitude === null || longitude === null || !at) continue;
      out.push({
        delivery_id: doc.id,
        external_order_id: asString(raw["external_order_id"]),
        status: asString(raw[del.status]),
        kind: leg.kind,
        latitude,
        longitude,
        at: at.toDate().toISOString(),
        restaurant_name: asString(raw["restaurant_name"]),
      });
    }
  });

  return out.sort((a, b) => Date.parse(String(a.at)) - Date.parse(String(b.at)));
}
