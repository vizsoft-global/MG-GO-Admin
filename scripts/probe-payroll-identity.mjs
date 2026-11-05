/**
 * Read-only probe: are Payroll "Driver ID" and HR Payroll "Client ID" the same
 * field? And how big are the two tables the 1366x768 pass has to paint?
 *
 * It prints, for a few riders, the three identifiers the two sheets show —
 * `drivers.employee_id` (MG ID), `drivers.driver_code` (Driver ID) and the
 * restaurant's own client/external id (HR "Client ID") — plus the row counts the
 * Order Comparison and HR Payroll pages read for this month.
 *
 *   node scripts/probe-payroll-identity.mjs
 */
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { assertProd, loadEnv, loadServiceAccount } from "./perf-env.mjs";

const account = loadServiceAccount(loadEnv());
assertProd(account);
const app = getApps()[0] ?? initializeApp({ credential: cert(account), projectId: account.projectId });
const db = getFirestore(app, "default");

const RIDERS = 4;

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "—";
}

console.log("#### rider identifiers (Payroll vs HR Payroll)");
const drivers = await db.collection("drivers").limit(250).get();
let shown = 0;
const restaurantIds = new Set();
for (const doc of drivers.docs) {
  if (shown >= RIDERS) break;
  const row = doc.data() ?? {};
  if (row.archived_at) continue;
  const restaurantId =
    (Array.isArray(row.restaurant_ids) && row.restaurant_ids[0]) ||
    row.restaurant_id ||
    null;
  if (restaurantId) restaurantIds.add(restaurantId);
  console.log(
    [
      `doc=${doc.id.slice(0, 8)}`,
      `employee_id(MG ID)=${text(row.employee_id)}`,
      `driver_code(Driver ID)=${text(row.driver_code)}`,
      `drivers.client_id=${text(row.client_id)}`,
      `restaurant=${restaurantId ? restaurantId.slice(0, 8) : "—"}`,
    ].join("  "),
  );
  shown += 1;
}

console.log("\n#### restaurant external ids (HR 'Client ID')");
for (const id of [...restaurantIds].slice(0, 4)) {
  const snap = await db.collection("restaurants").doc(id).get();
  const row = snap.data() ?? {};
  console.log(
    `restaurant=${id.slice(0, 8)}  name=${text(row.name)}  client_id=${text(row.client_id)}  external_id=${text(
      row.external_id,
    )}  partner_id=${text(row.partner_id)}`,
  );
}

// Kuwait month window, the same bounds payroll/recon use.
const now = new Date(Date.now() + 3 * 3600_000);
const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - 3 * 3600_000;
const monthEnd = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1) - 3 * 3600_000;

console.log("\n#### table sizes for this Kuwait month");
const [reconRows, deliveries, activeDrivers] = await Promise.all([
  db.collection("order_recon_rows").where("work_date", ">=", new Date(monthStart)).where("work_date", "<", new Date(monthEnd)).count().get(),
  db.collection("deliveries").where("delivered_at", ">=", new Date(monthStart)).where("delivered_at", "<", new Date(monthEnd)).count().get(),
  db.collection("drivers").count().get(),
]);
console.log(`order_recon_rows   = ${reconRows.data().count}`);
console.log(`deliveries         = ${deliveries.data().count}`);
console.log(`drivers (all docs) = ${activeDrivers.data().count}`);
