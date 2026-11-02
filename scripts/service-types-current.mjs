/**
 * Read-only: what is in the Service Type catalog right now?
 *   node --import tsx scripts/service-types-current.mjs
 */
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { assertProd, loadEnv, loadServiceAccount } from "./perf-env.mjs";
import { isServiceCategoryKey } from "../src/features/fleet/service/service-types.ts";

const account = loadServiceAccount(loadEnv());
assertProd(account);
const app = getApps()[0] ?? initializeApp({ credential: cert(account), projectId: account.projectId });
const db = getFirestore(app, "default");

const snapshot = await db.collection("service_types").get();
const rows = snapshot.docs.map((doc) => ({
  key: doc.id,
  labelEn: String(doc.get("label_en") ?? ""),
  labelAr: String(doc.get("label_ar") ?? ""),
  category: doc.get("category") ?? null,
  active: doc.get("is_active") ?? null,
  sort: doc.get("sort_order") ?? null,
}));

const categoryCounts = {};
let missingCategory = 0;
let invalidCategory = 0;
let inactive = 0;
let withoutArabic = 0;
for (const row of rows) {
  if (row.category == null) missingCategory += 1;
  else if (!isServiceCategoryKey(row.category)) invalidCategory += 1;
  categoryCounts[row.category ?? "(none)"] = (categoryCounts[row.category ?? "(none)"] ?? 0) + 1;
  if (row.active === false) inactive += 1;
  if (!row.labelAr.trim()) withoutArabic += 1;
}

console.log(`service_types documents : ${rows.length}`);
console.log(`inactive               : ${inactive}`);
console.log(`missing category       : ${missingCategory}`);
console.log(`invalid category key   : ${invalidCategory}`);
console.log(`no Arabic label        : ${withoutArabic}`);
console.log("categories:");
for (const [key, count] of Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(key).padEnd(14)} ${count}`);
}
console.log("\nfirst 8 rows:");
for (const row of rows.slice(0, 8)) {
  console.log(`  ${row.key.padEnd(34)} ${row.labelEn} | ${row.category} | active=${row.active}`);
}
console.log("\nNo writes performed.");
