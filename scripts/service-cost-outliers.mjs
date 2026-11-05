/**
 * Read-only: which `vehicle_services` rows carry an impossible cost?
 *
 * The Service → Cost analysis cards sum `cost_kwd`, so one legacy row holding
 * `2.3e21` makes the whole page read like `2,345,670,965,431,234,000,000.0`.
 * This prints every row above a believable invoice, plus the per-vehicle totals
 * they inflate. It never writes.
 *
 *   node --import tsx scripts/service-cost-outliers.mjs
 *   node --import tsx scripts/service-cost-outliers.mjs 500   # custom ceiling
 */
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { assertProd, loadEnv, loadServiceAccount } from "./perf-env.mjs";

const ceiling = Number(process.argv[2] ?? 2000);

const account = loadServiceAccount(loadEnv());
assertProd(account);
const app = getApps()[0] ?? initializeApp({ credential: cert(account), projectId: account.projectId });
const db = getFirestore(app, "default");

const [services, vehicles] = await Promise.all([
  db.collection("vehicle_services").get(),
  db.collection("vehicles").get(),
]);
const plateById = new Map(
  vehicles.docs.map((doc) => [doc.id, doc.get("reg_number") ?? doc.get("bike_id") ?? doc.id]),
);

const toIso = (value) => {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" ? value : null;
};
const num = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);

const rows = services.docs.map((doc) => ({
  id: doc.id,
  vehicle: plateById.get(doc.get("vehicle_id")) ?? String(doc.get("vehicle_id") ?? "—"),
  date: toIso(doc.get("service_date")) ?? toIso(doc.get("created_at")) ?? "—",
  description: String(doc.get("description") ?? doc.get("service_type") ?? "—").slice(0, 60),
  cost: num(doc.get("cost_kwd")) ?? num(doc.get("cost")) ?? null,
}));

const outliers = rows.filter((row) => row.cost != null && Math.abs(row.cost) > ceiling);
const total = rows.reduce((sum, row) => sum + (row.cost ?? 0), 0);

console.log(`vehicle_services rows : ${rows.length}`);
console.log(`ceiling               : ${ceiling} KWD`);
console.log(`sum of cost_kwd       : ${total}`);
console.log(`outliers              : ${outliers.length}\n`);
for (const row of outliers.sort((a, b) => Math.abs(b.cost) - Math.abs(a.cost))) {
  console.log(`  ${row.id}  ${row.vehicle}  ${String(row.date).slice(0, 10)}  ${row.cost}`);
  console.log(`     ${row.description}`);
}
if (outliers.length === 0) console.log("  none — every stored cost is below the ceiling");
console.log("\nNo writes performed.");
