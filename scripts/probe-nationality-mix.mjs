/**
 * Read-only probe for PDF item 5.3 (dual Nationality Category + Country).
 *
 * Prints the counts the Operations Hub cards should show, plus sample riders to
 * use for the profile edit test.
 *
 *   node scripts/probe-nationality-mix.mjs
 *
 * Writes nothing. Reads `drivers` only.
 */
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { assertProd, loadEnv, loadServiceAccount } from "./perf-env.mjs";

const account = loadServiceAccount(loadEnv());
assertProd(account);
const app = getApps()[0] ?? initializeApp({ credential: cert(account), projectId: account.projectId });
const db = getFirestore(app, "default");

const snap = await db
  .collection("drivers")
  .select("employee_id", "driver_code", "full_name", "project_key", "archived_at", "nationality", "nationality_category_keys")
  .get();

const live = snap.docs
  .map((doc) => ({ id: doc.id, ...(doc.data() ?? {}) }))
  .filter((row) => !row.archived_at);

const categoryOf = (row) => {
  const keys = Array.isArray(row.nationality_category_keys)
    ? row.nationality_category_keys.map((k) => String(k ?? "").trim()).filter(Boolean)
    : [];
  return keys[0] || "unassigned";
};
const countryOf = (row) => String(row.nationality ?? "").trim() || "unassigned";

function tally(rows, pick) {
  const map = new Map();
  for (const row of rows) {
    const key = pick(row);
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

console.log(`drivers       : ${snap.size} total, ${live.length} not archived`);

const cats = tally(live, categoryOf);
const countries = tally(live, countryOf);
console.log(`categories    : ${cats.length} values`);
console.log(`countries     : ${countries.length} values`);

console.log("\n--- Nationality Category card (dashboard order) ---");
for (const [key, count] of cats.slice(0, 12)) console.log(`  ${String(count).padStart(4)}  ${key}`);
console.log(`  total: ${cats.reduce((s, [, c]) => s + c, 0)}`);

console.log("\n--- Nationality Country card (dashboard shows top 10) ---");
for (const [key, count] of countries.slice(0, 12)) console.log(`  ${String(count).padStart(4)}  ${key}`);
console.log(`  total: ${countries.reduce((s, [, c]) => s + c, 0)}`);

const both = live.filter((row) => countryOf(row) !== "unassigned" && categoryOf(row) !== "unassigned");
const neither = live.filter((row) => countryOf(row) === "unassigned" && categoryOf(row) === "unassigned");
const onlyCountry = live.filter((row) => countryOf(row) !== "unassigned" && categoryOf(row) === "unassigned");
const onlyCategory = live.filter((row) => countryOf(row) === "unassigned" && categoryOf(row) !== "unassigned");

console.log("\n--- state of the two fields ---");
console.log(`  both set      : ${both.length}`);
console.log(`  country only  : ${onlyCountry.length}`);
console.log(`  category only : ${onlyCategory.length}`);
console.log(`  neither set   : ${neither.length}`);

function sample(label, rows, limit) {
  console.log(`\n--- ${label} (use these to test the profile save) ---`);
  for (const row of rows.slice(0, limit)) {
    console.log(
      `  MG ${String(row.employee_id ?? "—").padEnd(6)} / ${String(row.driver_code ?? "—").padEnd(6)} | ` +
        `${String(row.full_name ?? "—").slice(0, 26).padEnd(27)} | ` +
        `country ${String(countryOf(row)).padEnd(12)} | category ${categoryOf(row)}`,
    );
  }
}

sample("both fields set", both, 4);
sample("neither field set", neither, 3);
