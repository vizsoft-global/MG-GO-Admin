/**
 * Read-only probe: how many riders sit on each sponsorship and nationality
 * catalog key, so a catalog replacement knows what it would orphan.
 *
 *   node scripts/probe-employee-catalogs.mjs
 */
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { assertProd, loadEnv, loadServiceAccount } from "./perf-env.mjs";

const account = loadServiceAccount(loadEnv());
assertProd(account);
const app = getApps()[0] ?? initializeApp({ credential: cert(account), projectId: account.projectId });
const db = getFirestore(app, "default");

function tally(map, key) {
  const value = typeof key === "string" && key.trim() ? key.trim() : "(blank)";
  map.set(value, (map.get(value) ?? 0) + 1);
}

console.log("#### stored sponsorship catalog");
const sponsors = await db.collection("sponsorships").get();
console.log(`rows: ${sponsors.size}`);
for (const doc of sponsors.docs) {
  const row = doc.data() ?? {};
  console.log(
    `  ${doc.id} | ${row.label_en} | active=${row.is_active} system=${row.is_system} sort=${row.sort_order}`,
  );
}

console.log("\n#### stored nationality_categories catalog");
const nations = await db.collection("nationality_categories").get();
console.log(`rows: ${nations.size}`);
for (const doc of nations.docs) {
  const row = doc.data() ?? {};
  console.log(`  ${doc.id} | ${row.label_en} | active=${row.is_active} system=${row.is_system}`);
}

const drivers = await db.collection("drivers").get();
console.log(`\n#### riders: ${drivers.size}`);
const bySponsorship = new Map();
const byNationality = new Map();
let archived = 0;
for (const doc of drivers.docs) {
  const d = doc.data() ?? {};
  if (d.archived_at) {
    archived += 1;
    continue;
  }
  tally(bySponsorship, d.sponsorship_key);
  const keys = d.nationality_category_keys;
  if (Array.isArray(keys) && keys.length) {
    for (const key of keys) tally(byNationality, key);
  } else {
    tally(byNationality, "(none)");
  }
}
console.log(`  archived skipped: ${archived}`);
console.log("\n#### riders per sponsorship_key");
for (const [key, count] of [...bySponsorship.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${key}: ${count}`);
}
console.log("\n#### riders per nationality key");
for (const [key, count] of [...byNationality.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${key}: ${count}`);
}

process.exit(0);
