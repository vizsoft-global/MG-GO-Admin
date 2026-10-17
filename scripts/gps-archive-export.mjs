/**
 * One-time copy of `driver_location_events` into the FleetRoom R2 archive.
 *
 *   node scripts/gps-archive-export.mjs --from 2026-07-01 --before 2026-10-24            # dry run
 *   node scripts/gps-archive-export.mjs --from 2026-10-01 --before 2026-10-02 --driver X # one rider-day
 *   CONFIRM_GPS_EXPORT=yes node scripts/gps-archive-export.mjs --from … --before … --apply
 *
 * For each rider-day it writes gzip JSONL hours to `import/{id}/{day}/{HH}.jsonl.gz`
 * in `dpd-gps-prod` (never `rider/…`, which the room owns), registers them in the
 * room's `day_index` via POST /archive/register, and writes `rider_day_stats` with
 * the room's own moving / idle / dwell / distance rules.
 *
 * Firestore rows are not deleted here. Once the export is verified, stamp
 * `location_gps_r2_since` to `--from` (scripts/gps-r2-cutover.mjs), set
 * `LOCATION_EVENTS_ARCHIVED=1` on the functions, and the retention cron shrinks
 * the collection to 7 days.
 *
 * Env: R2_ACCOUNT_ID/R2_S3_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
 * GPS_R2_BUCKET (default dpd-gps-prod), FLEET_WS_URL, FLEET_WS_TOKEN_SECRET, FLEET_ROOM.
 */
import { createHmac } from "node:crypto";
import { gzipSync } from "node:zlib";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { assertProd, loadEnv, loadServiceAccount } from "./perf-env.mjs";

const KUWAIT_OFFSET_MS = 3 * 3_600_000;
const MAX_STAT_GAP_MS = 120_000;
const DWELL_AFTER_MS = 300_000;
const MOVING_MIN_MPS = 1.5;
const MAX_ACCURACY_M = 50;
const MAX_SEGMENT_M = 500;
const MAX_SEGMENT_MPS = 40;
const PAGE = 2_000;
const CONCURRENCY = 6;

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const from = arg("from");
const before = arg("before");
const onlyDriver = arg("driver");
const limitDrivers = Number(arg("limit-drivers") ?? 0);
const apply = process.argv.includes("--apply");
if (![from, before].every((value) => value && /^\d{4}-\d{2}-\d{2}$/.test(value)) || from >= before) {
  console.error("--from YYYY-MM-DD and --before YYYY-MM-DD (exclusive, later than --from) are required");
  process.exit(1);
}
if (apply && process.env.CONFIRM_GPS_EXPORT !== "yes") {
  console.error("Refusing to write without CONFIRM_GPS_EXPORT=yes");
  process.exit(1);
}

const env = loadEnv();
const account = loadServiceAccount(env);
assertProd(account);
const app = getApps()[0] ?? initializeApp({ credential: cert(account), projectId: account.projectId });
const db = getFirestore(app, "default");

const pick = (key) => (process.env[key] ?? env[key] ?? "").trim();
const bucket = pick("GPS_R2_BUCKET") || "dpd-gps-prod";
let s3 = null;
let edgeBase = "";
let edgeSecret = "";
if (apply) {
  const endpoint = pick("R2_S3_ENDPOINT") || `https://${pick("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`;
  if (!pick("R2_ACCESS_KEY_ID") || !pick("R2_SECRET_ACCESS_KEY")) throw new Error("R2 keys missing");
  s3 = new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId: pick("R2_ACCESS_KEY_ID"), secretAccessKey: pick("R2_SECRET_ACCESS_KEY") },
  });
  edgeBase = pick("FLEET_WS_URL").replace(/\/+$/, "").replace(/^ws(s?):/i, "http$1:");
  edgeSecret = pick("FLEET_WS_TOKEN_SECRET");
  if (!edgeBase || !edgeSecret) throw new Error("FLEET_WS_URL / FLEET_WS_TOKEN_SECRET missing");
}

function kuwaitParts(ms) {
  const iso = new Date(ms + KUWAIT_OFFSET_MS).toISOString();
  return { day: iso.slice(0, 10), hour: iso.slice(11, 13) };
}

function addDay(day, delta) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + delta * 86_400_000).toISOString().slice(0, 10);
}

function toMillis(value) {
  if (value instanceof Timestamp) return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

const num = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);

function toPoint(data) {
  const t = toMillis(data.recorded_at) ?? toMillis(data.at);
  const la = num(data.latitude) ?? num(data.lat);
  const lo = num(data.longitude) ?? num(data.lng);
  if (t == null || la == null || lo == null) return null;
  return {
    point: {
      t,
      la,
      lo,
      s: num(data.speed_mps),
      a: num(data.accuracy_meters),
      h: num(data.heading_deg),
      b: num(data.battery_pct),
      m: data.is_mocked === true ? 1 : 0,
      st: typeof data.tracking_status === "string" ? data.tracking_status : null,
      d: typeof data.delivery_id === "string" ? data.delivery_id : null,
      ad: typeof data.active_delivery_id === "string" ? data.active_delivery_id : null,
      r: 0,
    },
    zone: data.zone_status === "out_of_zone" ? false : data.zone_status === "in_zone" ? true : null,
  };
}

function haversineMeters(lat1, lng1, lat2, lng2) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(a));
}

/** Same rules as `GpsArchive.record`, so exported and live days compare like for like. */
function dayStats(entries) {
  const stats = { movingS: 0, idleS: 0, dwellS: 0, outOfZoneS: 0, mockedCount: 0, points: 0, distanceM: 0 };
  let lastT = null;
  let lastLat = null;
  let lastLng = null;
  let idleSince = null;
  for (const { point, zone } of entries) {
    if (lastT != null && point.t < lastT) continue;
    stats.points += 1;
    if (point.m === 1) stats.mockedCount += 1;
    if (lastT != null) {
      const dtS = Math.min(point.t - lastT, MAX_STAT_GAP_MS) / 1000;
      if ((point.s ?? 0) >= MOVING_MIN_MPS) {
        stats.movingS += dtS;
        idleSince = null;
      } else {
        stats.idleS += dtS;
        idleSince ??= lastT;
        if (point.t - idleSince >= DWELL_AFTER_MS) stats.dwellS += dtS;
      }
      if (zone === false) stats.outOfZoneS += dtS;
    }
    const accurate = point.a == null || point.a <= MAX_ACCURACY_M;
    if (accurate && lastLat != null && lastT != null) {
      const seg = haversineMeters(lastLat, lastLng, point.la, point.lo);
      const dt = (point.t - lastT) / 1000;
      if (dt > 0 && seg <= MAX_SEGMENT_M && seg / dt <= MAX_SEGMENT_MPS) stats.distanceM += seg;
    }
    if (accurate) {
      lastLat = point.la;
      lastLng = point.lo;
    }
    lastT = point.t;
  }
  return stats;
}

async function readRiderDay(driverId, day) {
  const entries = [];
  let cursor = null;
  for (;;) {
    let query = db
      .collection("driver_location_events")
      .where("driver_id", "==", driverId)
      .where("day", "==", day)
      .limit(PAGE);
    if (cursor) query = query.startAfter(cursor);
    const snap = await query.get();
    for (const doc of snap.docs) {
      const entry = toPoint(doc.data());
      if (entry) entries.push(entry);
    }
    if (snap.size < PAGE) break;
    cursor = snap.docs[snap.docs.length - 1];
  }
  const byTs = new Map();
  for (const entry of entries) byTs.set(entry.point.t, entry);
  return [...byTs.values()].sort((a, b) => a.point.t - b.point.t);
}

function signToken() {
  const encode = (buffer) => buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const body = encode(
    Buffer.from(
      JSON.stringify({
        sub: "gps-archive-export",
        room: pick("FLEET_ROOM") || "fleet-kw",
        exp: Math.floor(Date.now() / 1000) + 60,
      }),
    ),
  );
  return `${body}.${encode(createHmac("sha256", edgeSecret).update(body).digest())}`;
}

async function exportRiderDay(driverId, day, entries) {
  const hours = new Map();
  for (const entry of entries) {
    const { hour } = kuwaitParts(entry.point.t);
    const lines = hours.get(hour) ?? [];
    lines.push(JSON.stringify(entry.point));
    hours.set(hour, lines);
  }
  const keys = [];
  for (const [hour, lines] of hours) {
    const key = `import/${driverId}/${day}/${hour}.jsonl.gz`;
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: gzipSync(lines.join("\n")),
        ContentType: "application/x-ndjson",
        ContentEncoding: "gzip",
      }),
    );
    keys.push(key);
  }
  const stats = dayStats(entries);
  const response = await fetch(`${edgeBase}/archive/register`, {
    method: "POST",
    headers: { Authorization: `Bearer ${signToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      rows: [
        {
          driver_id: driverId,
          day,
          keys,
          points: stats.points,
          distance_m: stats.distanceM,
          first_ts: entries[0].point.t,
          last_ts: entries[entries.length - 1].point.t,
        },
      ],
    }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.registered !== 1) {
    throw new Error(`register ${driverId} ${day}: HTTP ${response.status}`);
  }
  await db.collection("rider_day_stats").doc(`${driverId}_${day}`).set(
    {
      driver_id: driverId,
      day,
      moving_s: stats.movingS,
      idle_s: stats.idleS,
      dwell_s: stats.dwellS,
      out_of_zone_s: stats.outOfZoneS,
      mocked_count: stats.mockedCount,
      points: stats.points,
      distance_m: stats.distanceM,
      source: "firestore_export",
      updated_at: Timestamp.now(),
    },
    { merge: true },
  );
}

const driverIds = onlyDriver
  ? [onlyDriver]
  : (await db.collection("drivers").listDocuments()).map((ref) => ref.id).sort();
const drivers = limitDrivers > 0 ? driverIds.slice(0, limitDrivers) : driverIds;
const days = [];
for (let day = from; day < before; day = addDay(day, 1)) days.push(day);

const settings = (await db.collection("app_settings").doc("1").get()).data() ?? {};
console.log(
  `${apply ? "APPLY" : "DRY RUN"} · ${drivers.length} drivers × ${days.length} days · bucket ${bucket}` +
    ` · location_gps_r2_since=${JSON.stringify(settings.location_gps_r2_since ?? null)}` +
    ` · driver_location_events_retention_days=${JSON.stringify(settings.driver_location_events_retention_days ?? null)}`,
);

const tasks = drivers.flatMap((driverId) => days.map((day) => [driverId, day]));
const totals = { riderDays: 0, points: 0, distanceM: 0, failed: 0 };
let next = 0;
async function worker() {
  while (next < tasks.length) {
    const [driverId, day] = tasks[next++];
    try {
      const entries = await readRiderDay(driverId, day);
      if (entries.length === 0) continue;
      totals.riderDays += 1;
      totals.points += entries.length;
      if (apply) await exportRiderDay(driverId, day, entries);
      else totals.distanceM += dayStats(entries).distanceM;
      if (totals.riderDays % 100 === 0) console.log(`… ${totals.riderDays} rider-days, ${totals.points} points`);
    } catch (error) {
      totals.failed += 1;
      console.error(`${driverId} ${day}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

console.log(
  `rider-days ${totals.riderDays} · points ${totals.points} · failed ${totals.failed}` +
    (apply ? "" : ` · distance ${(totals.distanceM / 1000).toFixed(1)} km`),
);
if (!apply) console.log("Dry run. Pass --apply with CONFIRM_GPS_EXPORT=yes to write.");
process.exit(totals.failed > 0 ? 1 : 0);
