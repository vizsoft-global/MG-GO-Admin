/**
 * Read-only check for the GPS dual-write window.
 *
 *   node scripts/gps-dual-write-compare.mjs [--day 2026-10-16] [--limit 25] [--driver <id>]
 *   node scripts/gps-dual-write-compare.mjs --day 2026-10-19 --since 2026-10-19T10:24:00Z
 *
 * Reads each rider's R2 archive through the Worker's `/history` endpoint and
 * compares it with `driver_location_events` for the same Kuwait day. The archive
 * is the source of truth for what the edge received; `rider_day_stats` is only
 * used to discover riders because it is also written by the one-time export.
 * Only meaningful while the Worker runs with GPS_SINK=r2 and GPS_DUAL_WRITE=1.
 *
 * Firestore history is deliberately thinner than the archive: `historyPut`
 * drops insignificant fixes, while the archive keeps every accepted fix, and
 * offline replays can make Firestore higher. Point counts are therefore shown
 * for context, not used as the verdict. Distance is compared with the same
 * odometer rules (accuracy <= 50 m, segment <= 500 m, <= 40 m/s); a missing
 * dual-write shows up as a distance gap. `--since` applies the same lower bound
 * to both sides, which makes a cutover-day run useful without waiting all day.
 */
import { createHmac } from "node:crypto";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { assertProd, loadEnv, loadServiceAccount } from "./perf-env.mjs";

/** Firestore history is sampled; the archive is not. Half is a loss alarm, not equality. */
const DISTANCE_COVERAGE = 0.5;
const DISTANCE_ABS_M = 200;
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

function distanceCovered(edgeMeters, firestoreMeters) {
  if (edgeMeters === 0) return firestoreMeters === 0;
  if (firestoreMeters === 0) return false;
  return (
    firestoreMeters >= edgeMeters * DISTANCE_COVERAGE ||
    Math.abs(edgeMeters - firestoreMeters) <= DISTANCE_ABS_M
  );
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

const env = loadEnv();
const account = loadServiceAccount(env);
assertProd(account);
const app = getApps()[0] ?? initializeApp({ credential: cert(account), projectId: account.projectId });
const db = getFirestore(app, "default");

const pick = (key) => (process.env[key] ?? env[key] ?? "").trim();
const edgeBase = pick("FLEET_WS_URL").replace(/\/+$/, "").replace(/^ws(s?):/i, "http$1:");
const edgeSecret = pick("FLEET_WS_TOKEN_SECRET");
const room = pick("FLEET_ROOM") || "fleet-kw";
if (!edgeBase || !edgeSecret) throw new Error("FLEET_WS_URL / FLEET_WS_TOKEN_SECRET missing");

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

/** Same HMAC shape as src/features/live-tracking-v2/fleet-token.ts. */
function fleetToken() {
  const body = base64Url(
    JSON.stringify({ sub: "gps-dual-write-compare", room, exp: Math.floor(Date.now() / 1000) + 60 }),
  );
  const signature = createHmac("sha256", edgeSecret).update(body).digest("base64url");
  return `${body}.${signature}`;
}

async function readArchive(driverId, day) {
  const url = `${edgeBase}/history?driver=${encodeURIComponent(driverId)}&day=${day}`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${fleetToken()}` } });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.ok !== true) {
    throw new Error(`archive ${driverId} ${day}: HTTP ${response.status} ${body?.error ?? ""}`.trim());
  }
  return (Array.isArray(body.points) ? body.points : [])
    .map((point) => ({
      lat: Number(point.la),
      lng: Number(point.lo),
      accuracy: typeof point.a === "number" ? point.a : null,
      at: Number(point.t),
    }))
    .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng) && Number.isFinite(point.at))
    .filter((point) => sinceMs == null || point.at >= sinceMs)
    .sort((a, b) => a.at - b.at);
}

const onlyDriver = arg("driver", null);
let statsQuery = db.collection("rider_day_stats").where("day", "==", day);
if (onlyDriver) statsQuery = statsQuery.where("driver_id", "==", onlyDriver);
const stats = await statsQuery.limit(limit).get();
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
  const archiveRows = await readArchive(s.driver_id, day);
  const history = await db
    .collection("driver_location_events")
    .where("driver_id", "==", s.driver_id)
    .where("day", "==", day)
    .select("lat", "lng", "latitude", "longitude", "accuracy_meters", "recorded_at")
    .get();
  // Firestore retries can leave two rows for the same recorded_at. The archive
  // dedupes by timestamp in readDay, so the comparison has to do the same or a
  // retried rider reads as a distance gap.
  const rows = [
    ...new Map(
      history.docs
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
        .map((r) => [r.at, r]),
    ).values(),
  ].sort((a, b) => a.at - b.at);

  const edgePoints = archiveRows.length;
  const edgeMeters = firestoreDistance(archiveRows);
  const fsMeters = firestoreDistance(rows);
  const pointsOk = edgePoints === 0 || rows.length > 0;
  const distanceOk = distanceCovered(edgeMeters, fsMeters);
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
