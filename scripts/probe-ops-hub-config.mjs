/**
 * Read-only probe for PDF items 5.1 / 5.2 — the central Operations Hub config.
 *
 * Prints `operations_hub_config/default` (the single document every viewer
 * reads) and the defaults that apply when it does not exist yet.
 *
 *   node scripts/probe-ops-hub-config.mjs
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

const snap = await db.collection("operations_hub_config").doc("default").get();
console.log(`doc path      : operations_hub_config/default`);
console.log(`exists        : ${snap.exists}`);
if (!snap.exists) {
  console.log("-> the page renders DEFAULT_OPS_HUB_CONFIG (9 columns, 2 charts) for everyone.");
  process.exit(0);
}

const data = snap.data() ?? {};
console.log(`updatedAt     : ${data.updatedAt ?? "—"}`);
console.log(`updatedBy     : ${data.updatedBy ?? "—"}`);

const columns = Array.isArray(data.customColumns) ? data.customColumns : [];
const charts = Array.isArray(data.customCharts) ? data.customCharts : [];
console.log(`customColumns : ${columns.length}`);
for (const col of columns) {
  console.log(`  - ${String(col.id).padEnd(22)} visible=${col.visible} field=${col.field} label=${col.label}`);
}
console.log(`customCharts  : ${charts.length}`);
for (const chart of charts) {
  console.log(`  - ${String(chart.id).padEnd(22)} type=${chart.type} dimension=${chart.dimension} title=${chart.title}`);
}
