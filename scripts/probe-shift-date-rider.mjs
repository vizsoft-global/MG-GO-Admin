/**
 * Read-only probe for PDF item 4.1 — one rider, day by day.
 *
 * Prints, for a single rider, how their deliveries split between
 *   - the stored `deliveries.shift_date` (the new, shift-based day cell), and
 *   - the Kuwait calendar day of `delivered_at` (the old behaviour),
 * so a tester knows exactly which numbers to expect in Order Reconciliation and
 * in Payroll -> Attendance & Orders.
 *
 *   node scripts/probe-shift-date-rider.mjs <MG ID | driver id> [days]
 *
 * Writes nothing.
 */
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { assertProd, loadEnv, loadServiceAccount } from "./perf-env.mjs";

const account = loadServiceAccount(loadEnv());
assertProd(account);
const app = getApps()[0] ?? initializeApp({ credential: cert(account), projectId: account.projectId });
const db = getFirestore(app, "default");

const DAY_MS = 24 * 60 * 60 * 1000;
const KUWAIT_OFFSET_MS = 3 * 60 * 60 * 1000;
const LOGGED_STATUSES = new Set(["pending", "in_transit", "verified"]);

const needle = String(process.argv[2] ?? "").trim();
const days = Math.min(Math.max(Number(process.argv[3] ?? 14) || 14, 1), 45);
if (!needle) {
  console.log("usage: node scripts/probe-shift-date-rider.mjs <MG ID | driver id> [days]");
  process.exit(1);
}

const kuwaitDay = (ms) => new Date(ms + KUWAIT_OFFSET_MS).toISOString().slice(0, 10);
const kuwaitClock = (ms) => new Date(ms + KUWAIT_OFFSET_MS).toISOString().slice(11, 16);

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

function shiftMidnightMs(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  return Date.UTC(y, m - 1, d) - KUWAIT_OFFSET_MS;
}

let driverId = null;
let driver = {};
const direct = await db.collection("drivers").doc(needle).get();
if (direct.exists) {
  driverId = direct.id;
  driver = direct.data() ?? {};
} else {
  for (const field of ["employee_id", "driver_code"]) {
    const snap = await db.collection("drivers").where(field, "==", needle).limit(1).get();
    if (!snap.empty) {
      driverId = snap.docs[0].id;
      driver = snap.docs[0].data() ?? {};
      break;
    }
  }
}
if (!driverId) {
  console.log(`no driver matched "${needle}"`);
  process.exit(1);
}

const profile = await db.collection("profiles").doc(driverId).get();
console.log(`rider        : ${driver.full_name ?? profile.data()?.full_name ?? "—"}`);
console.log(`MG ID / code : ${driver.employee_id ?? "—"} / ${driver.driver_code ?? "—"}`);
console.log(`driver id    : ${driverId}`);
console.log(`project/zone : ${driver.project_key ?? "—"} / ${driver.zone_id ?? "—"}`);
console.log(`status       : ${driver.status ?? "—"}  archived: ${driver.archived_at ? "yes" : "no"}`);


const fromDay = kuwaitDay(Date.now() - days * DAY_MS);
const snap = await db
  .collection("deliveries")
  .where("driver_id", "==", driverId)
  .where("delivered_at", ">=", new Date(shiftMidnightMs(fromDay)))
  .select("delivered_at", "shift_date", "status")
  .get();

const shiftsSnap = await db.collection("driver_daily_shifts").where("driver_id", "==", driverId).limit(120).get();
const shiftByDate = new Map(
  shiftsSnap.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() ?? {}) }))
    .filter((row) => typeof row.shift_date === "string")
    .map((row) => [String(row.shift_date).slice(0, 10), row]),
);

const byShiftDay = new Map();
const byCalendarDay = new Map();
for (const doc of snap.docs) {
  const data = doc.data() ?? {};
  if (!LOGGED_STATUSES.has(String(data.status ?? ""))) continue;
  const at = millisOf(data.delivered_at);
  if (at === null) continue;
  const calendar = kuwaitDay(at);
  const rawShift = typeof data.shift_date === "string" ? data.shift_date.slice(0, 10) : null;
  const attributed = rawShift && /^\d{4}-\d{2}-\d{2}$/.test(rawShift) ? rawShift : calendar;

  const shiftRow = byShiftDay.get(attributed) ?? { orders: 0, clocks: [] };
  shiftRow.orders += 1;
  if (attributed !== calendar) shiftRow.clocks.push(kuwaitClock(at));
  byShiftDay.set(attributed, shiftRow);

  const calRow = byCalendarDay.get(calendar) ?? { orders: 0, earlierShift: 0 };
  calRow.orders += 1;
  if (attributed !== calendar) calRow.earlierShift += 1;
  byCalendarDay.set(calendar, calRow);
}

const shiftDays = [...byShiftDay.keys()].sort();
console.log(`\nwindow       : ${fromDay} .. ${kuwaitDay(Date.now())}`);
console.log(`shift days with orders: ${shiftDays.length}`);

console.log("\n--- grouped by deliveries.shift_date (the day cell recon/payroll use) ---");
console.log("shift_date | shift window                       | orders | after midnight");
for (const day of shiftDays) {
  const row = byShiftDay.get(day);
  const shift = shiftByDate.get(day);
  const window = shift
    ? `${shift.shift_type ?? "single"} ${shift.session1_start ?? "?"}-${shift.session1_end ?? "?"} (+${shift.session1_end_day_offset ?? 0}d)` +
      (shift.session2_start
        ? ` / s2 ${shift.session2_start}-${shift.session2_end} (+${shift.session2_end_day_offset ?? 0}d)`
        : "")
    : "no roster row (calendar fallback)";
  const latest = row.clocks.length ? row.clocks.slice().sort().at(-1) : "—";
  console.log(
    `${day} | ${window.padEnd(34)} | ${String(row.orders).padStart(6)} | ${String(row.clocks.length).padStart(3)} (latest ${latest})`,
  );
}

console.log("\n--- same deliveries grouped by Kuwait calendar day (the old behaviour) ---");
console.log("calendar   | orders | of which belong to an earlier shift_date");
for (const day of [...byCalendarDay.keys()].sort()) {
  const row = byCalendarDay.get(day);
  console.log(`${day} | ${String(row.orders).padStart(6)} | ${row.earlierShift}`);
}

const total = [...byShiftDay.values()].reduce((sum, row) => sum + row.orders, 0);
console.log(`\ntotal logged deliveries in window: ${total}`);
