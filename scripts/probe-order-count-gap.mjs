/**
 * Read-only probe for PDF item 4.2 (Order Counting and Data Consistency).
 *
 * Finds rider-days that have app-logged deliveries but NO applied AM
 * reconciliation row — exactly the case where payroll used to fall back to 0
 * instead of the app count (`applyPayrollManualOrders`: `recon ?? 0`).
 *
 *   node scripts/probe-order-count-gap.mjs [YYYY-MM] [topN]
 *
 * Writes nothing. Reads `deliveries`, `order_recon_rows`, `order_recon_runs`,
 * `payroll_order_overrides`, `drivers`, `profiles`.
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
const LOGGED_STATUSES = new Set(["pending", "in_transit", "verified"]);
const SCAN_LIMIT = 60000;

const month = /^\d{4}-\d{2}$/.test(String(process.argv[2] ?? ""))
  ? String(process.argv[2])
  : new Date(Date.now() + KUWAIT_OFFSET_MS).toISOString().slice(0, 7);
const topN = Math.min(Math.max(Number(process.argv[3] ?? 10) || 10, 1), 40);
/** Optional: only this MG ID / driver code, so one rider's days can be listed. */
const onlyMg = String(process.argv[4] ?? "").trim().toLowerCase();

const kuwaitDay = (ms) => new Date(ms + KUWAIT_OFFSET_MS).toISOString().slice(0, 10);
const kuwaitMidnightMs = (ymd) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return Date.UTC(y, m - 1, d) - KUWAIT_OFFSET_MS;
};
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

const [year, monthNo] = month.split("-").map(Number);
const firstDay = `${month}-01`;
const lastDay = new Date(Date.UTC(year, monthNo, 0)).toISOString().slice(0, 10);
const scanEnd = new Date(kuwaitMidnightMs(lastDay) + 2 * DAY_MS); // +1 day for the night tail

console.log(`month         : ${month} (${firstDay} .. ${lastDay})`);

const [runsSnap, rowsSnap, deliveriesSnap, overridesSnap, driversSnap] = await Promise.all([
  db.collection("order_recon_runs").limit(400).get(),
  db
    .collection("order_recon_rows")
    .where("work_date", ">=", firstDay)
    .where("work_date", "<=", lastDay)
    .select("employee_id", "work_date", "excel_orders", "run_id")
    .limit(SCAN_LIMIT)
    .get(),
  db
    .collection("deliveries")
    .where("delivered_at", ">=", new Date(kuwaitMidnightMs(firstDay)))
    .where("delivered_at", "<", scanEnd)
    .select("driver_id", "delivered_at", "shift_date", "status")
    .limit(SCAN_LIMIT)
    .get(),
  db
    .collection("payroll_order_overrides")
    .where("work_date", ">=", firstDay)
    .where("work_date", "<=", lastDay)
    .limit(20000)
    .get(),
  db.collection("drivers").select("employee_id", "driver_code", "full_name", "project_key").get(),
]);

const appliedRuns = new Set(
  runsSnap.docs.filter((d) => String(d.data()?.status ?? "") === "applied").map((d) => d.id),
);
console.log(`recon runs    : ${runsSnap.size} read, ${appliedRuns.size} applied`);
console.log(`recon rows    : ${rowsSnap.size} in ${month}`);
console.log(`deliveries    : ${deliveriesSnap.size} read`);
console.log(`overrides     : ${overridesSnap.size} in ${month}`);

const driverById = new Map(driversSnap.docs.map((d) => [d.id, d.data() ?? {}]));

/** `${employeeIdLower}|${workDate}` -> excel orders, from APPLIED runs only. */
const recon = new Map();
for (const doc of rowsSnap.docs) {
  const row = doc.data() ?? {};
  const runId = String(row.run_id ?? "");
  if (!appliedRuns.has(runId)) continue;
  const emp = String(row.employee_id ?? "").trim().toLowerCase();
  const day = String(row.work_date ?? "").slice(0, 10);
  if (!emp || !day) continue;
  const key = `${emp}|${day}`;
  recon.set(key, (recon.get(key) ?? 0) + (Number(row.excel_orders) || 0));
}

/** Manual per-day override, which wins over both sources. */
const overrides = new Set();
for (const doc of overridesSnap.docs) {
  const row = doc.data() ?? {};
  const day = String(row.work_date ?? "").slice(0, 10);
  for (const field of ["driver_id", "employee_id"]) {
    const id = String(row[field] ?? "").trim().toLowerCase();
    if (id && day) overrides.add(`${id}|${day}`);
  }
}

/** `${driverId}|${shiftDay}` -> app count. */
const appCount = new Map();
for (const doc of deliveriesSnap.docs) {
  const row = doc.data() ?? {};
  if (!LOGGED_STATUSES.has(String(row.status ?? ""))) continue;
  const at = millisOf(row.delivered_at);
  if (at === null) continue;
  const driverId = String(row.driver_id ?? "");
  if (!driverId) continue;
  const rawShift = typeof row.shift_date === "string" ? row.shift_date.slice(0, 10) : null;
  const day = rawShift && /^\d{4}-\d{2}-\d{2}$/.test(rawShift) ? rawShift : kuwaitDay(at);
  if (day < firstDay || day > lastDay) continue;
  const key = `${driverId}|${day}`;
  appCount.set(key, (appCount.get(key) ?? 0) + 1);
}

const gaps = [];
for (const [key, count] of appCount) {
  if (count <= 0) continue;
  const [driverId, day] = key.split("|");
  const driver = driverById.get(driverId) ?? {};
  const emp = String(driver.employee_id ?? "").trim().toLowerCase();
  if (!emp) continue;
  if (recon.has(`${emp}|${day}`)) continue;
  if (overrides.has(`${driverId}|${day}`.toLowerCase()) || overrides.has(`${emp}|${day}`)) continue;
  gaps.push({ driverId, day, count, emp, driver });
}

gaps.sort((a, b) => b.count - a.count || a.day.localeCompare(b.day));
const listed = onlyMg
  ? gaps.filter(
      (gap) =>
        String(gap.driver.employee_id ?? "").toLowerCase() === onlyMg ||
        String(gap.driver.driver_code ?? "").toLowerCase() === onlyMg,
    )
  : gaps;
console.log(`\nrider-days with app orders but NO applied recon row: ${gaps.length}`);
console.log("(these are the days 4.2 is about — payroll must show the app count, not 0)\n");

for (const gap of (onlyMg ? listed : gaps).slice(0, topN)) {
  console.log(
    `${gap.day} | MG ${String(gap.driver.employee_id ?? "—").padEnd(6)} | code ${String(
      gap.driver.driver_code ?? "—",
    ).padEnd(6)} | ${String(gap.count).padStart(3)} app orders | ${gap.driver.project_key ?? "—"}`,
  );
}
if (onlyMg) {
  const daySum = listed.reduce((sum, gap) => sum + gap.count, 0);
  console.log(`\n${onlyMg}: ${listed.length} uncovered days, ${daySum} app orders total`);
  const withRecon = [...appCount.entries()].filter(([key]) => {
    const [driverId] = key.split("|");
    const driver = driverById.get(driverId) ?? {};
    return String(driver.employee_id ?? "").toLowerCase() === onlyMg;
  });
  console.log(`(this rider has ${withRecon.length} rider-days with app orders in ${month}; the rest have an AM row)`);
}


const byRider = new Map();
for (const gap of gaps) {
  const entry = byRider.get(gap.driverId) ?? { days: 0, orders: 0, gap };
  entry.days += 1;
  entry.orders += gap.count;
  byRider.set(gap.driverId, entry);
}
console.log("\n--- best single riders to test with (most uncovered days) ---");
for (const [, entry] of [...byRider.entries()].sort((a, b) => b[1].days - a[1].days).slice(0, 5)) {
  const g = entry.gap;
  console.log(
    `MG ${g.driver.employee_id ?? "—"} / ${g.driver.driver_code ?? "—"} — ${entry.days} days, ${entry.orders} orders total`,
  );
}

console.log(`drivers       : ${driversSnap.size}`);
