/**
 * Read-only check for the GPS dual-write window.
 *
 *   node scripts/gps-dual-write-compare.mjs [--day 2026-10-16] [--limit 25]
 *
 * For each rider with a `rider_day_stats` row (FleetRoom archive totals) on the
 * Kuwait day, re-reads that rider's `driver_location_events` for the same day
 * and compares point count and distance. Only meaningful while the Worker runs
 * with GPS_SINK=r2 and GPS_DUAL_WRITE=1, so both stores see the same fixes.
 *
 * Firestore history also holds replayed offline fixes, which the archive does
 * not count, so the point check tolerates Firestore being higher. Distance uses
 * the odometer rules (accuracy <= 50 m, segment <= 500 m, <= 40 m/s).
 */
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { assertProd, loadEnv, loadServiceAccount } from "./perf-env.mjs";

const POINT_TOLERANCE = 0.05;
const DISTANCE_TOLERANCE = 0.1;
const MAX_ACCURACY_M = 50;
const MAX_SEGMENT_M = 500;
const MAX_SPEED_MPS = 40;

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function kuwaitDay(date) {
  return new Date(date.getTime() + 3 * 3600_000).toISOString().slice(0, 10);
}

function haversine(aLat, aLng, bLat, bLng) {
  const r = 6_371_000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

function firestoreDistance(rows) {
  let total = 0;
  let prev = null;
  for (const row of rows) {
    if (row.accuracy !== null && row.accuracy > MAX_ACCURACY_M) continue;
    if (prev) {
      const meters = haversine(prev.lat, prev.lng, row.lat, row.lng);
      const seconds = (row.at - prev.at) / 1000;
      if (meters <= MAX_SEGMENT_M && (seconds <= 0 || meters / seconds <= MAX_SPEED_MPS)) total += meters;
    }
    prev = row;
  }
  return total;
}

function withinTolerance(a, b, tolerance) {
  const base = Math.max(Math.abs(a), Math.abs(b), 1);
  return Math.abs(a - b) / base <= tolerance;
}

const day = arg("day", kuwaitDay(new Date(Date.now() - 86_400_000)));
const limit = Number(arg("limit", "25"));
// Optional ISO instant for a cutover-day comparison: the R2 archive and
// Firestore both only hold the overlap window, not the whole Kuwait day.
const since = arg("since", null);
const sinceMs = since ? Date.parse(since) : null;
if (since && !Number.isFinite(sinceMs)) {
  console.error("--since must be an ISO timestamp");
  process.exit(1);
}

const account = loadServiceAccount(loadEnv());
assertProd(account);
const app = getApps()[0] ?? initializeApp({ credential: cert(account), projectId: account.projectId });
const db = getFirestore(app, "default");

const stats = await db.collection("rider_day_stats").where("day", "==", day).limit(limit).get();
if (stats.empty) {
  console.log(`No rider_day_stats rows for ${day}. Is GPS_SINK=r2 with GPS_SINK_PERCENT > 0?`);
  process.exit(0);
}

let ok = 0;
let mismatched = 0;
console.log(`day ${day}, riders ${stats.size}`);
console.log("driver_id                         edge_pts  fs_pts  edge_km  fs_km  verdict");
for (const doc of stats.docs) {
  const s = doc.data();
  const history = await db
    .collection("driver_location_events")
    .where("driver_id", "==", s.driver_id)
    .where("day", "==", day)
    .select("lat", "lng", "latitude", "longitude", "accuracy_meters", "recorded_at")
    .get();
  const rows = history.docs
    .map((d) => {
      const r = d.data();
      return {
        lat: Number(r.lat ?? r.latitude),
        lng: Number(r.lng ?? r.longitude),
        accuracy: typeof r.accuracy_meters === "number" ? r.accuracy_meters : null,
        at: r.recorded_at?.toMillis?.() ?? 0,
      };
    })
    .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng))
    .filter((r) => sinceMs == null || r.at >= sinceMs)
    .sort((a, b) => a.at - b.at);

  const edgePoints = Number(s.points ?? 0);
  const edgeMeters = Number(s.distance_m ?? 0);
  const fsMeters = firestoreDistance(rows);
  const pointsOk = rows.length >= edgePoints || withinTolerance(rows.length, edgePoints, POINT_TOLERANCE);
  const distanceOk = withinTolerance(edgeMeters, fsMeters, DISTANCE_TOLERANCE);
  const verdict = pointsOk && distanceOk ? "OK" : "DIFF";
  if (verdict === "OK") ok += 1;
  else mismatched += 1;
  console.log(
    `${String(s.driver_id).padEnd(34)}${String(edgePoints).padStart(8)}${String(rows.length).padStart(8)}` +
      `${(edgeMeters / 1000).toFixed(2).padStart(9)}${(fsMeters / 1000).toFixed(2).padStart(7)}  ${verdict}`,
  );
}
console.log(`\nOK ${ok}, DIFF ${mismatched}`);
process.exit(mismatched > 0 ? 1 : 0);
