/**
 * Read-only probe: why Performance KPI working hours ≈ 135,654 and UTR ≈ 0.00.
 *
 * Reimplements payrollHoursFromFields and the ops.ts hours loop (all logs, no slicer).
 * Writes nothing.
 *
 *   node scripts/probe-performance-hours.mjs
 *   node scripts/probe-performance-hours.mjs 2026-10-26
 */
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { assertProd, loadEnv, loadServiceAccount } from "./perf-env.mjs";

const account = loadServiceAccount(loadEnv());
assertProd(account);
const app = getApps()[0] ?? initializeApp({ credential: cert(account), projectId: account.projectId });
const db = getFirestore(app, "default");

const FROM = process.argv[2] === "day" ? "2026-10-26" : (process.argv[2] ?? "2026-10-01");
const TO = process.argv[2] === "day" ? "2026-10-26" : (process.argv[3] ?? "2026-10-26");
const DAYS = Math.round((Date.parse(`${TO}T00:00:00+03:00`) - Date.parse(`${FROM}T00:00:00+03:00`)) / 86400000) + 1;

const KUWAIT_OFFSET_MS = 3 * 3600 * 1000;
const DAY_MS = 86400000;

function kuwaitDayStart(day) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) - KUWAIT_OFFSET_MS);
}
function kuwaitDayEnd(day) {
  return new Date(kuwaitDayStart(day).getTime() + DAY_MS);
}

function asDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (value instanceof Timestamp) {
    const parsed = value.toDate();
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === "object" && value !== null && typeof value.toDate === "function") {
    const parsed = value.toDate();
    return parsed instanceof Date && !Number.isNaN(parsed.getTime()) ? parsed : null;
  }
  if (typeof value === "object" && value !== null && typeof value._seconds === "number") {
    return new Date(value._seconds * 1000 + Math.floor((value._nanoseconds ?? 0) / 1e6));
  }
  return null;
}

function describeType(value) {
  if (value === null || value === undefined) return "unset";
  if (value instanceof Timestamp) return "Timestamp";
  if (value instanceof Date) return "Date";
  if (typeof value === "object" && value !== null && typeof value.toDate === "function") return "toDate";
  if (typeof value === "number") return Number.isInteger(value) ? "int" : "float";
  return typeof value;
}

/** Mirror of functions/src/rpcs/payroll-read-plan.ts payrollHoursFromFields. */
function payrollHoursFromFields(raw) {
  const minutes = raw["worked_minutes"];
  if (typeof minutes === "number" && Number.isFinite(minutes)) return minutes / 60;
  const checkIn = asDate(raw["check_in_at"]);
  const checkOut = asDate(raw["check_out_at"]);
  if (!checkIn || !checkOut) return 0;
  return Math.max(0, (checkOut.getTime() - checkIn.getTime()) / 3_600_000);
}

function wallClockHours(raw) {
  const checkIn = asDate(raw["check_in_at"]);
  const checkOut = asDate(raw["check_out_at"]);
  if (!checkIn || !checkOut) return null;
  return (checkOut.getTime() - checkIn.getTime()) / 3_600_000;
}

function iso(value) {
  const d = asDate(value);
  return d ? d.toISOString() : JSON.stringify(value ?? null);
}

function logDateKey(value) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const d = asDate(value);
  if (!d) return `other:${describeType(value)}`;
  const shifted = new Date(d.getTime() + KUWAIT_OFFSET_MS);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function countQuery(query) {
  try {
    const snap = await query.count().get();
    return { ok: true, count: snap.data().count };
  } catch (err) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}

function round(n, d = 3) {
  if (!Number.isFinite(n)) return n;
  const p = 10 ** d;
  return Math.round(n * p) / p;
}

console.log(`window log_date ${FROM}..${TO} (${DAYS} days)`);
console.log(`deliveries delivered_at [${kuwaitDayStart(FROM).toISOString()}, ${kuwaitDayEnd(TO).toISOString()})`);
console.log("scanning attendance_logs…");
const t0 = Date.now();

const attendanceSnaps = await db
  .collection("attendance_logs")
  .where("log_date", ">=", FROM)
  .where("log_date", "<=", TO)
  .select("driver_id", "log_date", "worked_minutes", "check_in_at", "check_out_at")
  .get();

console.log(`attendance scan ${Date.now() - t0}ms docs=${attendanceSnaps.size}`);

const pairCounts = new Map();
const drivers = new Set();
const logs = [];
const logDateTypes = new Map();
const wmTypes = new Map();
let hoursSum = 0;
let wmSet = 0;
let wallFallback = 0;
let openZero = 0;
let closedZero = 0;
const hoursHist = { "0": 0, "0-4": 0, "4-8": 0, "8-12": 0, "12-16": 0, "16-24": 0, "24-48": 0, "48+": 0 };
const wmValues = [];
const pairHours = new Map();

for (const doc of attendanceSnaps.docs) {
  const raw = doc.data() ?? {};
  const driverId = typeof raw.driver_id === "string" ? raw.driver_id : "";
  const day = logDateKey(raw.log_date);
  const ldType = describeType(raw.log_date);
  logDateTypes.set(ldType, (logDateTypes.get(ldType) ?? 0) + 1);
  const wmType = describeType(raw.worked_minutes);
  wmTypes.set(wmType, (wmTypes.get(wmType) ?? 0) + 1);

  const hours = payrollHoursFromFields(raw);
  const wall = wallClockHours(raw);
  const wm = raw.worked_minutes;
  const wmIsNum = typeof wm === "number" && Number.isFinite(wm);
  const checkIn = asDate(raw.check_in_at);
  const checkOut = asDate(raw.check_out_at);

  let source = "other";
  if (wmIsNum) {
    wmSet += 1;
    wmValues.push(wm);
    source = "worked_minutes";
  } else if (!checkIn || !checkOut) {
    openZero += 1;
    source = "open";
  } else if (hours <= 0) {
    closedZero += 1;
    source = "closed_zero";
  } else {
    wallFallback += 1;
    source = "wall_clock";
  }

  if (Number.isFinite(hours) && hours > 0) hoursSum += hours;
  if (hours <= 0) hoursHist["0"] += 1;
  else if (hours < 4) hoursHist["0-4"] += 1;
  else if (hours < 8) hoursHist["4-8"] += 1;
  else if (hours < 12) hoursHist["8-12"] += 1;
  else if (hours < 16) hoursHist["12-16"] += 1;
  else if (hours < 24) hoursHist["16-24"] += 1;
  else if (hours < 48) hoursHist["24-48"] += 1;
  else hoursHist["48+"] += 1;

  if (driverId) drivers.add(driverId);
  const pair = `${driverId}|${day}`;
  pairCounts.set(pair, (pairCounts.get(pair) ?? 0) + 1);
  pairHours.set(pair, (pairHours.get(pair) ?? 0) + (Number.isFinite(hours) && hours > 0 ? hours : 0));

  logs.push({
    id: doc.id,
    driverId,
    day,
    hours,
    wall,
    wm,
    wmIsNum,
    source,
    checkIn,
    checkOut,
    raw,
  });
}

const hist1 = { 1: 0, 2: 0, "3+": 0 };
for (const n of pairCounts.values()) {
  if (n === 1) hist1[1] += 1;
  else if (n === 2) hist1[2] += 1;
  else hist1["3+"] += 1;
}

const uniquePairs = pairCounts.size;
const hoursPerPair = uniquePairs > 0 ? hoursSum / uniquePairs : 0;
const hoursPerDriverDay = drivers.size > 0 ? hoursSum / drivers.size / DAYS : 0;

console.log("\n==== 1. attendance grain ====");
console.log(JSON.stringify({
  log_count: attendanceSnaps.size,
  unique_drivers: drivers.size,
  unique_driver_day: uniquePairs,
  logs_per_pair: hist1,
  log_date_types: Object.fromEntries(logDateTypes),
  worked_minutes_types: Object.fromEntries(wmTypes),
}, null, 2));

console.log("\n==== 2. hours (ops.ts loop, no slicer) ====");
console.log(JSON.stringify({
  workingHours: round(hoursSum, 3),
  reported_kpi: 135654.3,
  delta_vs_kpi: round(hoursSum - 135654.3, 3),
  hours_hist_per_log: hoursHist,
}, null, 2));

console.log("\n==== 3. hours / grain ====");
console.log(JSON.stringify({
  hours_per_unique_driver_day: round(hoursPerPair, 3),
  expect_if_real_shift: "10-12.5",
  hours_per_unique_driver_per_calendar_day: round(hoursPerDriverDay, 3),
  formula: `hours / unique_drivers / ${DAYS}`,
}, null, 2));

const typical = logs
  .filter((row) => row.hours >= 8 && row.hours <= 14 && row.driverId && row.day.startsWith("2026-"))
  .sort((a, b) => Math.abs(a.hours - 10) - Math.abs(b.hours - 10))[0]
  ?? logs.filter((row) => row.hours > 0).sort((a, b) => b.hours - a.hours)[0];

console.log("\n==== 4. one rider-day ====");
if (!typical) {
  console.log("no positive-hour log");
} else {
  const same = logs.filter((row) => row.driverId === typical.driverId && row.day === typical.day);
  const rows = same.map((row) => {
    const wallMs = row.checkIn && row.checkOut ? row.checkOut.getTime() - row.checkIn.getTime() : null;
    const wallMin = wallMs == null ? null : wallMs / 60000;
    let unitGuess = "n/a";
    if (row.wmIsNum) {
      const minutes = row.wm;
      const vsWall = wallMin == null ? null : minutes / wallMin;
      if (wallMin != null && Math.abs(minutes - wallMin) / Math.max(wallMin, 1) < 0.15) unitGuess = "minutes (matches wall)";
      else if (wallMin != null && Math.abs(minutes / 60 - wallMin) / Math.max(wallMin, 1) < 0.15) unitGuess = "seconds (wm/60 ≈ wall minutes)";
      else if (wallMin != null && Math.abs(minutes / 60000 - wallMin) / Math.max(wallMin, 1) < 0.15) unitGuess = "milliseconds";
      else if (minutes > 10000 && minutes < 200000) unitGuess = "looks like seconds (10k-200k)";
      else if (minutes > 200000) unitGuess = "looks like milliseconds";
      else if (minutes > 0 && minutes < 24) unitGuess = "looks like hours stored in worked_minutes";
      else unitGuess = `unmatched vs wall_min=${round(wallMin ?? Number.NaN, 2)} ratio=${round(vsWall ?? Number.NaN, 3)}`;
    }
    return {
      log_id: row.id,
      worked_minutes: row.wm ?? null,
      worked_minutes_type: describeType(row.raw.worked_minutes),
      check_in_at: iso(row.raw.check_in_at),
      check_out_at: iso(row.raw.check_out_at),
      derived_hours: round(row.hours, 4),
      wall_clock_hours: row.wall == null ? null : round(row.wall, 4),
      wall_minutes: wallMin == null ? null : round(wallMin, 3),
      source: row.source,
      unit_guess: unitGuess,
    };
  });
  console.log(JSON.stringify({
    driver_id: typical.driverId,
    log_date: typical.day,
    log_count: same.length,
    pair_hours: round(pairHours.get(`${typical.driverId}|${typical.day}`) ?? 0, 4),
    logs: rows,
  }, null, 2));
}

const wmSorted = wmValues.slice().sort((a, b) => a - b);
function pct(arr, p) {
  if (!arr.length) return null;
  const i = Math.min(arr.length - 1, Math.max(0, Math.floor((p / 100) * arr.length)));
  return arr[i];
}

console.log("\n==== 5. worked_minutes vs fallback ====");
console.log(JSON.stringify({
  logs: attendanceSnaps.size,
  worked_minutes_set: wmSet,
  fallback_wall_clock: wallFallback,
  open_or_missing_out_zero: openZero,
  closed_but_zero: closedZero,
  worked_minutes_percentiles: wmSorted.length ? {
    n: wmSorted.length,
    p0: wmSorted[0],
    p50: pct(wmSorted, 50),
    p90: pct(wmSorted, 90),
    p99: pct(wmSorted, 99),
    p100: wmSorted[wmSorted.length - 1],
    as_hours_if_minutes: {
      p50: round((pct(wmSorted, 50) ?? 0) / 60, 3),
      p90: round((pct(wmSorted, 90) ?? 0) / 60, 3),
    },
    as_hours_if_seconds: {
      p50: round((pct(wmSorted, 50) ?? 0) / 3600, 3),
      p90: round((pct(wmSorted, 90) ?? 0) / 3600, 3),
    },
  } : null,
}, null, 2));

console.log("\n==== 6. deliveries / UTR ====");
const delFrom = kuwaitDayStart(FROM);
const delTo = kuwaitDayEnd(TO);
const statuses = ["verified", "pending", "in_transit", "under_review", "cancelled", "rejected"];
const counts = {};
const allInWindow = await countQuery(
  db.collection("deliveries").where("delivered_at", ">=", delFrom).where("delivered_at", "<", delTo),
);
counts.all_delivered_at_window = allInWindow;
for (const status of statuses) {
  counts[status] = await countQuery(
    db.collection("deliveries")
      .where("status", "==", status)
      .where("delivered_at", ">=", delFrom)
      .where("delivered_at", "<", delTo),
  );
}

let sample = [];
try {
  const sampleSnap = await db
    .collection("deliveries")
    .where("delivered_at", ">=", delFrom)
    .where("delivered_at", "<", delTo)
    .select("status", "driver_id", "delivered_at")
    .limit(8)
    .get();
  sample = sampleSnap.docs.map((doc) => {
    const row = doc.data() ?? {};
    return {
      id: doc.id,
      status: row.status ?? null,
      status_type: describeType(row.status),
      driver_id: row.driver_id ?? null,
      delivered_at: iso(row.delivered_at),
      delivered_at_type: describeType(row.delivered_at),
    };
  });
} catch (err) {
  sample = [{ error: err?.message ?? String(err) }];
}

const verifiedCount = counts.verified?.ok ? counts.verified.count : null;
const utr = verifiedCount != null && hoursSum > 0 ? verifiedCount / hoursSum : null;
console.log(JSON.stringify({
  counts,
  sample,
  orders_over_hours: utr == null ? null : round(utr, 6),
  orders_over_hours_2dp: utr == null ? null : (Math.round(utr * 100) / 100).toFixed(2),
  expected_if_real: "~0.8",
  verdict_hint:
    utr == null ? "could not compute"
      : utr < 0.05 ? "UTR near 0.00 — orders missing or hours wildly inflated"
        : utr >= 0.5 && utr <= 1.2 ? "UTR in the expected 0.8 band — hours are the display problem only if KPI still shows 0.00"
          : "UTR off expected band",
}, null, 2));

console.log("\n==== 7. cartesian join in ops.ts hours path ====");
console.log(JSON.stringify({
  code: "functions/src/rpcs/ops.ts ~1173-1189",
  scan: "one pass over attendanceSnaps.docs",
  join: "none — driverById.get + matches(driver) only, no nested delivery/shift loop",
  double_count_from_join: false,
  double_count_from_multi_log: hist1[2] + hist1["3+"] > 0,
  extra_logs_on_multi_pairs: attendanceSnaps.size - uniquePairs,
}, null, 2));

console.log("\n==== 8. driver_daily_shifts 2026-10-26 sample ====");
let shiftSnap;
try {
  shiftSnap = await db.collection("driver_daily_shifts").where("shift_date", "==", "2026-10-26").limit(20).get();
} catch (err) {
  console.log(JSON.stringify({ error: err?.message ?? String(err) }));
  shiftSnap = null;
}
if (shiftSnap) {
  const fieldFreq = new Map();
  const rows = shiftSnap.docs.map((doc) => {
    const row = doc.data() ?? {};
    for (const key of Object.keys(row)) fieldFreq.set(key, (fieldFreq.get(key) ?? 0) + 1);
    const keep = [
      "driver_id", "shift_date", "shift_type", "source", "is_off",
      "session1_start", "session1_end", "session1_end_day_offset",
      "session2_start", "session2_end", "session2_start_day_offset", "session2_end_day_offset",
      "hours", "scheduled_hours", "worked_hours", "online_seconds",
    ];
    const out = { id: doc.id };
    for (const key of keep) if (row[key] !== undefined) out[key] = row[key];
    return out;
  });
  console.log(JSON.stringify({
    queried: 20,
    returned: shiftSnap.size,
    field_presence_in_sample: Object.fromEntries(fieldFreq),
    sample: rows,
    overlap_possible:
      "yes if session1_start/end (and session2_*) plus day offsets exist: convert to instants via kuwaitDayStart(shift_date)+offset, intersect with [check_in_at, check_out_at]. No stored hours field required.",
  }, null, 2));
}

console.log(`\ndone in ${Date.now() - t0}ms`);
process.exit(0);
