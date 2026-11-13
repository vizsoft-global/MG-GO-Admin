/**
 * Read-only probe for PDF item 4.2 (order counting consistency), earnings side.
 *
 * Earnings now attributes a day by the rider's booked shift, the way Payroll,
 * Order Reconciliation and Performance already did. The `driver_earnings_daily`
 * rows written before that change are keyed on the Kuwait calendar day of
 * `delivered_at`, so an order completed at 01:00 still sits on the next day's
 * row until that row is recalculated.
 *
 * This prints exactly which rider-days that affects and what the two counts are,
 * so an operator knows what to recalculate from `/earnings-calculation`
 * (`recalculateEarningsForRange`) instead of recalculating a whole month blindly.
 *
 *   node scripts/probe-earnings-shift-day.mjs [days] [topN]
 *
 * Writes nothing. Reads `deliveries`, `drivers`, `driver_earnings_daily`.
 */
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { assertProd, loadEnv, loadServiceAccount } from "./perf-env.mjs";

const account = loadServiceAccount(loadEnv());
assertProd(account);
const app = getApps()[0] ?? initializeApp({ credential: cert(account), projectId: account.projectId });
const db = getFirestore(app, "default");

const KUWAIT_OFFSET_MS = 3 * 60 * 60 * 1000;
const RECORDED = new Set(["pending", "under_review", "verified"]);
const SCAN_LIMIT = 40000;

const days = Math.min(Math.max(Number(process.argv[2] ?? 14) || 14, 1), 90);
const topN = Math.min(Math.max(Number(process.argv[3] ?? 10) || 10, 1), 50);

function kuwaitDay(ms) {
  return new Date(ms + KUWAIT_OFFSET_MS).toISOString().slice(0, 10);
}

function millisOf(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate().getTime();
  if (typeof value.seconds === "number") return value.seconds * 1000;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function dayString(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

const toDay = kuwaitDay(Date.now());
const fromDay = kuwaitDay(Date.now() - (days - 1) * 86_400_000);
const from = new Date(`${fromDay}T00:00:00+03:00`);

console.log(`window ${fromDay} .. ${toDay} (${days} days)\n`);

const snap = await db
  .collection("deliveries")
  .where("delivered_at", ">=", from)
  .select("driver_id", "status", "delivered_at", "shift_date")
  .limit(SCAN_LIMIT)
  .get();

if (snap.size >= SCAN_LIMIT) {
  console.log(`!! stopped at the ${SCAN_LIMIT}-document scan cap; narrow the window\n`);
}

/** `${driverId}|${day}` to the two counts a surface can print for it. */
const byDriverShiftDay = new Map();
const byDriverCalendarDay = new Map();
const movedByDriver = new Map();

for (const doc of snap.docs) {
  const row = doc.data();
  const status = String(row.status ?? "");
  if (!RECORDED.has(status)) continue;
  const driverId = String(row.driver_id ?? "");
  const at = millisOf(row.delivered_at);
  if (!driverId || at === null) continue;

  const shift = dayString(row.shift_date);
  const calendar = kuwaitDay(at);
  const earnDay = shift ?? calendar;

  const shiftKey = `${driverId}|${earnDay}`;
  const calKey = `${driverId}|${calendar}`;
  const shiftEntry = byDriverShiftDay.get(shiftKey) ?? { driverId, day: earnDay, verified: 0, recorded: 0 };
  const calEntry = byDriverCalendarDay.get(calKey) ?? { driverId, day: calendar, verified: 0, recorded: 0 };
  shiftEntry.recorded += 1;
  calEntry.recorded += 1;
  if (status === "verified") {
    shiftEntry.verified += 1;
    calEntry.verified += 1;
  }
  byDriverShiftDay.set(shiftKey, shiftEntry);
  byDriverCalendarDay.set(calKey, calEntry);

  if (shift && shift !== calendar) {
    const move = movedByDriver.get(driverId) ?? { driverId, orders: 0 };
    move.orders += 1;
    movedByDriver.set(driverId, move);
  }
}

/** What the stored earnings row says today, for the same rider-day keys. */
const stored = new Map();
const keys = new Set([...byDriverShiftDay.keys(), ...byDriverCalendarDay.keys()]);
const driverIds = [...new Set([...keys].map((key) => key.split("|")[0]))];
const nameById = new Map();
for (let i = 0; i < driverIds.length; i += 300) {
  const group = driverIds.slice(i, i + 300);
  const found = group.length
    ? await db.getAll(...group.map((id) => db.collection("drivers").doc(id)))
    : [];
  for (const doc of found) {
    if (doc.exists) nameById.set(doc.id, doc.get("name") ?? doc.get("full_name") ?? "");
  }
}
for (const driverId of driverIds) {
  const snapEarn = await db
    .collection("driver_earnings_daily")
    .where("driver_id", "==", driverId)
    .where("earn_date", ">=", fromDay)
    .where("earn_date", "<=", toDay)
    .get();
  for (const doc of snapEarn.docs) {
    const row = doc.data();
    stored.set(`${driverId}|${String(row.earn_date ?? "")}`, {
      deliveries: Number(row.deliveries ?? 0),
      recorded: Number(row.recorded_deliveries ?? 0),
      net_kwd: Number(row.net_kwd ?? 0),
    });
  }
}

console.log("Riders with post-midnight orders (the rows an earnings recalc moves)");
console.log("─".repeat(92));
if (movedByDriver.size === 0) {
  console.log("none — every completed order already sits on its shift's day");
} else {
  const rows = [...movedByDriver.values()].sort((a, b) => b.orders - a.orders).slice(0, topN);
  for (const row of rows) {
    const name = nameById.get(row.driverId) ?? "";
    console.log(`${row.driverId}  ${String(row.orders).padStart(4)} order(s)  ${name}`);
  }
  console.log(`\n${movedByDriver.size} rider(s) affected in this window.`);
}

console.log("\nPer rider-day: recorded vs verified, and what the stored row says");
console.log("─".repeat(92));
const interesting = [...byDriverShiftDay.entries()]
  .map(([key, entry]) => {
    const [driverId, day] = key.split("|");
    const calendarEntry = byDriverCalendarDay.get(`${driverId}|${day}`);
    const row = stored.get(key) ?? null;
    return { driverId, day, shift: entry, calendar: calendarEntry ?? null, row };
  })
  // Only the days where the two attributions differ, or where the stored
  // verified count no longer matches. Those are the rows worth recalculating.
  .filter((item) => (item.calendar?.recorded ?? 0) !== item.shift.recorded || (item.row?.recorded ?? 0) !== item.shift.recorded)
  .sort((a, b) => b.shift.recorded - a.shift.recorded)
  .slice(0, topN);

if (interesting.length === 0) {
  console.log("no rider-day differs between the two attributions in this window");
} else {
  for (const item of interesting) {
    const name = nameById.get(item.driverId) ?? "";
    console.log(
      `${item.day}  ${item.driverId}  shift-day ${String(item.shift.recorded).padStart(3)} rec / ` +
        `${String(item.shift.verified).padStart(3)} ver   ` +
        `calendar-day ${String(item.calendar?.recorded ?? 0).padStart(3)} rec   ` +
        `stored ${item.row ? `${item.row.recorded} rec` : "no row"}   ${name}`,
    );
  }
}

console.log(
  "\nTo apply: /en/earnings-calculation → recalculate the affected range " +
    "(recalculate_earnings_for_range sweeps day by day on the shift rule now).",
);
