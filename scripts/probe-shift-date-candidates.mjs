/**
 * Read-only probe for PDF item 4.1 (Shift-Based Date Assignment).
 *
 * Finds riders whose deliveries were completed AFTER Kuwait midnight but whose
 * `deliveries.shift_date` is the PREVIOUS day — i.e. the orders that used to be
 * lost from (or duplicated onto) the wrong payroll/recon day cell.
 *
 *   node scripts/probe-shift-date-candidates.mjs [days] [topN]
 *
 * Writes nothing. Reads `deliveries`, `drivers`, `profiles`,
 * `driver_daily_shifts`.
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
const SCAN_LIMIT = 30000;

const days = Math.min(Math.max(Number(process.argv[2] ?? 7) || 7, 1), 31);
const topN = Math.min(Math.max(Number(process.argv[3] ?? 5) || 5, 1), 20);

function kuwaitDay(ms) {
  return new Date(ms + KUWAIT_OFFSET_MS).toISOString().slice(0, 10);
}

function kuwaitClock(ms) {
  return new Date(ms + KUWAIT_OFFSET_MS).toISOString().slice(11, 16);
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

function shiftMidnightMs(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  return Date.UTC(y, m - 1, d) - KUWAIT_OFFSET_MS;
}

const todayYmd = kuwaitDay(Date.now());
const fromDay = kuwaitDay(Date.now() - days * DAY_MS);
const scanStart = new Date(shiftMidnightMs(fromDay));

console.log(`window        : ${fromDay} .. ${todayYmd} (last ${days} days, Kuwait)`);

const snap = await db
  .collection("deliveries")
  .where("delivered_at", ">=", scanStart)
  .select("driver_id", "delivered_at", "shift_date", "status")
  .limit(SCAN_LIMIT)
  .get();

console.log(`deliveries    : ${snap.size} read (cap ${SCAN_LIMIT})`);

/** driverId -> { crossed, logged, days: Map<attributedDay, {crossed, logged, latestClock}> } */
const byDriver = new Map();
let scanned = 0;
let crossedTotal = 0;

for (const doc of snap.docs) {
  const data = doc.data() ?? {};
  if (!LOGGED_STATUSES.has(String(data.status ?? ""))) continue;
  const at = millisOf(data.delivered_at);
  if (at === null) continue;
  const driverId = typeof data.driver_id === "string" ? data.driver_id : "";
  if (!driverId) continue;
  const shiftDate = typeof data.shift_date === "string" ? data.shift_date.slice(0, 10) : null;
  scanned += 1;

  const calendar = kuwaitDay(at);
  const attributed = shiftDate && /^\d{4}-\d{2}-\d{2}$/.test(shiftDate) ? shiftDate : calendar;
  const crossed = attributed !== calendar;

  const entry = byDriver.get(driverId) ?? { driverId, crossed: 0, logged: 0, days: new Map() };
  entry.logged += 1;
  if (crossed) {
    entry.crossed += 1;
    crossedTotal += 1;
  }
  const perDay = entry.days.get(attributed) ?? { crossed: 0, logged: 0, latestClock: "" };
  perDay.logged += 1;
  if (crossed) {
    perDay.crossed += 1;
    const clock = kuwaitClock(at);
    if (clock > perDay.latestClock) perDay.latestClock = clock;
  }
  entry.days.set(attributed, perDay);
  byDriver.set(driverId, entry);
}

console.log(`logged        : ${scanned} in {pending,in_transit,verified}`);
console.log(`after-midnight: ${crossedTotal} attributed to the previous day's shift`);


const candidates = [...byDriver.values()]
  .filter((row) => row.crossed > 0)
  .sort((a, b) => b.crossed - a.crossed || b.logged - a.logged)
  .slice(0, topN);

if (candidates.length === 0) {
  console.log("\nNo rider in this window has a delivery attributed to the previous day's shift.");
  console.log("Widen the window:  node scripts/probe-shift-date-candidates.mjs 30");
  process.exit(0);
}

const driverIds = candidates.map((c) => c.driverId);
const driverDocs = await db.getAll(...driverIds.map((id) => db.collection("drivers").doc(id)));
const driverById = new Map(driverDocs.filter((d) => d.exists).map((d) => [d.id, d.data() ?? {}]));

const profileDocs = await db.getAll(...driverIds.map((id) => db.collection("profiles").doc(id)));
const nameById = new Map(
  profileDocs.filter((d) => d.exists).map((d) => [d.id, String(d.data()?.full_name ?? "")]),
);

async function shiftRowsFor(driverId) {
  const shifts = await db.collection("driver_daily_shifts").where("driver_id", "==", driverId).limit(80).get();
  return shifts.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() ?? {}) }))
    .filter((row) => typeof row.shift_date === "string")
    .sort((a, b) => String(b.shift_date).localeCompare(String(a.shift_date)));
}

let index = 0;
for (const candidate of candidates) {
  index += 1;
  const driver = driverById.get(candidate.driverId) ?? {};
  const shifts = await shiftRowsFor(candidate.driverId);
  const shiftByDate = new Map(shifts.map((row) => [String(row.shift_date).slice(0, 10), row]));

  console.log(`\n================ candidate ${index} ================`);
  console.log(`driver id     : ${candidate.driverId}`);
  console.log(`MG ID / code  : ${driver.employee_id ?? "—"} / ${driver.driver_code ?? "—"}`);
  console.log(`name          : ${driver.full_name ?? nameById.get(candidate.driverId) ?? "—"}`);
  console.log(`project/zone  : ${driver.project_key ?? "—"} / ${driver.zone_id ?? "—"}`);
  console.log(`status        : ${driver.status ?? "—"}  archived: ${driver.archived_at ? "yes" : "no"}`);
  console.log(`after-midnight: ${candidate.crossed} of ${candidate.logged} logged deliveries`);

  const rows = [...candidate.days.entries()]
    .filter(([, v]) => v.crossed > 0)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 6);

  for (const [day, info] of rows) {
    const shift = shiftByDate.get(day);
    const window = shift
      ? `${shift.shift_type ?? "single"} ${shift.session1_start ?? "?"}-${shift.session1_end ?? "?"}` +
        ` (+${shift.session1_end_day_offset ?? 0}d)` +
        (shift.session2_start
          ? ` / s2 ${shift.session2_start}-${shift.session2_end} (+${shift.session2_end_day_offset ?? 0}d)`
          : "")
      : "no roster row";
    console.log(
      `  shift_date ${day} -> ${info.crossed}/${info.logged} after midnight ` +
        `(latest ${info.latestClock}) | ${window} | source ${shift?.source ?? "—"}`,
    );
  }
}

console.log("\n--- how to use a candidate ---");
console.log("1. Order reconciliation -> Order Comparison — AM vs MGGO: pick the shift_date day,");
console.log("   search the MG ID, expand the row, and confirm the MGGO day count includes the");
console.log("   after-midnight orders (the next calendar day must NOT receive them).");
console.log("2. Payroll -> Attendance & Orders: the same rider/day cell must show the same count.");
console.log("3. The two days together must equal the rider's delivery list total for that shift.");
