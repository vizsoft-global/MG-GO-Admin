/**
 * Read-only probe: do the `rollups_driver_day` counters agree with `deliveries`?
 *
 * Order Comparison can read the rider-day rollup (~22k documents a month)
 * instead of scanning deliveries (~176k), but only for days on which the two
 * agree. This prints, day by day, the logged orders (pending + verified) each
 * source reports and how many rider-days differ, then names the first day from
 * which every later day matched. That day is what an operator writes to
 * `app_settings/1.order_rollups_trusted_from` to switch the report over.
 *
 *   node scripts/probe-rollup-coverage.mjs [FROM] [TO] [topN]
 *
 * FROM/TO are Kuwait days (YYYY-MM-DD); the default is the 14 days ending
 * yesterday. Today is left out on purpose: orders are still moving.
 *
 * Writes nothing. Reads `deliveries` and `rollups_driver_day`.
 */
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { assertProd, loadEnv, loadServiceAccount } from "./perf-env.mjs";

const account = loadServiceAccount(loadEnv());
assertProd(account);
const app = getApps()[0] ?? initializeApp({ credential: cert(account), projectId: account.projectId });
const db = getFirestore(app, "default");

const KUWAIT_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Same reach past midnight as `scanUpperMs` in functions/src/core/shift-day.ts. */
const SHIFT_TAIL_MS = 12 * 60 * 60 * 1000;
const PAGE = 5000;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const kuwaitDay = (ms) => new Date(ms + KUWAIT_OFFSET_MS).toISOString().slice(0, 10);
const kuwaitMidnightMs = (ymd) => Date.parse(`${ymd}T00:00:00+03:00`);
const addDays = (ymd, n) => kuwaitDay(kuwaitMidnightMs(ymd) + n * DAY_MS);

/** Mirrors `isDayString`: a real calendar day, not just the right shape. */
function isRealDay(value) {
  if (typeof value !== "string" || !DAY_RE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function millisOf(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate().getTime();
  if (typeof value.seconds === "number") return value.seconds * 1000;
  if (value instanceof Date) return value.getTime();
  return null;
}

const yesterday = addDays(kuwaitDay(Date.now()), -1);
const to = isRealDay(process.argv[3]) ? process.argv[3] : yesterday;
const from = isRealDay(process.argv[2]) ? process.argv[2] : addDays(to, -13);
const topN = Math.min(Math.max(Number(process.argv[4] ?? 15) || 15, 1), 100);
if (from > to) throw new Error("FROM is after TO");

console.log(`window        : ${from} .. ${to} (Kuwait days)`);

/** `${driverId}|${day}` -> { pending, verified } from delivery documents. */
const scanned = new Map();
let deliveriesRead = 0;
{
  const start = new Date(kuwaitMidnightMs(from));
  const end = new Date(kuwaitMidnightMs(to) + DAY_MS + SHIFT_TAIL_MS);
  let cursor = null;
  for (;;) {
    let query = db
      .collection("deliveries")
      .where("delivered_at", ">=", start)
      .where("delivered_at", "<", end)
      .orderBy("delivered_at")
      .select("driver_id", "delivered_at", "shift_date", "status")
      .limit(PAGE);
    if (cursor) query = query.startAfter(cursor);
    const snap = await query.get();
    deliveriesRead += snap.size;
    for (const doc of snap.docs) {
      const row = doc.data() ?? {};
      const status = String(row.status ?? "");
      if (status !== "pending" && status !== "verified") continue;
      const at = millisOf(row.delivered_at);
      if (at === null) continue;
      const driverId = String(row.driver_id ?? "");
      if (!driverId) continue;
      const day = isRealDay(row.shift_date) ? row.shift_date : kuwaitDay(at);
      if (day < from || day > to) continue;
      const key = `${driverId}|${day}`;
      const entry = scanned.get(key) ?? { pending: 0, verified: 0 };
      entry[status] += 1;
      scanned.set(key, entry);
    }
    if (snap.size < PAGE) break;
    cursor = snap.docs[snap.docs.length - 1];
  }
}

/** `${driverId}|${day}` -> { pending, verified } from the rollup counters. */
const rolled = new Map();
let rollupsRead = 0;
{
  let cursor = null;
  for (;;) {
    let query = db
      .collection("rollups_driver_day")
      .where("day", ">=", from)
      .where("day", "<=", to)
      .orderBy("day")
      .select("driver_id", "day", "pending", "verified", "orders")
      .limit(PAGE);
    if (cursor) query = query.startAfter(cursor);
    const snap = await query.get();
    rollupsRead += snap.size;
    for (const doc of snap.docs) {
      const row = doc.data() ?? {};
      const driverId = String(row.driver_id ?? "");
      const day = String(row.day ?? "");
      if (!driverId || !isRealDay(day)) continue;
      const pending = Math.max(0, Math.trunc(Number(row.pending) || 0));
      // `orders` and `verified` are two names for one counter.
      const verified = Math.max(0, Math.trunc(Math.max(Number(row.verified) || 0, Number(row.orders) || 0)));
      if (pending + verified === 0) continue;
      rolled.set(`${driverId}|${day}`, { pending, verified });
    }
    if (snap.size < PAGE) break;
    cursor = snap.docs[snap.docs.length - 1];
  }
}

console.log(`deliveries    : ${deliveriesRead} read`);
console.log(`rollup rows   : ${rollupsRead} read\n`);

const perDay = new Map();
const mismatches = [];
for (const key of new Set([...scanned.keys(), ...rolled.keys()])) {
  const day = key.slice(key.indexOf("|") + 1);
  const scan = scanned.get(key) ?? { pending: 0, verified: 0 };
  const roll = rolled.get(key) ?? { pending: 0, verified: 0 };
  const scanTotal = scan.pending + scan.verified;
  const rollTotal = roll.pending + roll.verified;
  const entry = perDay.get(day) ?? { scan: 0, rollup: 0, riderDays: 0, differing: 0 };
  entry.scan += scanTotal;
  entry.rollup += rollTotal;
  entry.riderDays += 1;
  if (scanTotal !== rollTotal) {
    entry.differing += 1;
    mismatches.push({ key, day, scanTotal, rollTotal });
  }
  perDay.set(day, entry);
}

console.log("day        | deliveries | rollup | rider-days | differing");
let lastBadDay = null;
for (let day = from; day <= to; day = addDays(day, 1)) {
  const entry = perDay.get(day) ?? { scan: 0, rollup: 0, riderDays: 0, differing: 0 };
  if (entry.differing > 0) lastBadDay = day;
  console.log(
    `${day} | ${String(entry.scan).padStart(10)} | ${String(entry.rollup).padStart(6)} | ${String(
      entry.riderDays,
    ).padStart(10)} | ${String(entry.differing).padStart(9)}${entry.differing > 0 ? "  <-- differs" : ""}`,
  );
}

if (mismatches.length > 0) {
  mismatches.sort((a, b) => Math.abs(b.scanTotal - b.rollTotal) - Math.abs(a.scanTotal - a.rollTotal));
  console.log(`\nlargest differences (driver id | day | deliveries vs rollup):`);
  for (const row of mismatches.slice(0, topN)) {
    const driverId = row.key.slice(0, row.key.indexOf("|"));
    console.log(`${driverId} | ${row.day} | ${row.scanTotal} vs ${row.rollTotal}`);
  }
}

console.log("");
if (lastBadDay === null) {
  console.log(`every day in the window agrees. The rollup can be trusted from ${from}`);
  console.log(`(or earlier — widen the window to find out how far back).`);
} else if (lastBadDay === to) {
  console.log(`the last day of the window (${to}) still differs: the rollup is not safe to read yet.`);
} else {
  console.log(`last differing day: ${lastBadDay}. Every day from ${addDays(lastBadDay, 1)} agrees.`);
  console.log(`To switch Order Comparison to the rollup for those days, set`);
  console.log(`  app_settings/1.order_rollups_trusted_from = "${addDays(lastBadDay, 1)}"`);
}
console.log("Nothing was written.");
