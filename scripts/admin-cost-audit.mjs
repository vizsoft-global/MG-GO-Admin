/**
 * Read-only: estimated admin calls per day per callable / page / read, scaled
 * from `admin_cost_samples` (written only while ADMIN_COST_AUDIT_SAMPLE > 0).
 *
 *   node scripts/admin-cost-audit.mjs --day 2026-10-18 [--top 40]
 */
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { assertProd, loadEnv, loadServiceAccount } from "./perf-env.mjs";

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const yesterday = new Date(Date.now() + 3 * 3_600_000 - 86_400_000).toISOString().slice(0, 10);
const day = arg("day") ?? yesterday;
const top = Number(arg("top") ?? "40");

const account = loadServiceAccount(loadEnv());
assertProd(account);
const app = getApps()[0] ?? initializeApp({ credential: cert(account), projectId: account.projectId });
const db = getFirestore(app, "default");

const snap = await db.collection("admin_cost_samples").where("day", "==", day).get();
const rows = new Map();
for (const doc of snap.docs) {
  const d = doc.data();
  const key = `${d.kind}\t${d.name}`;
  const row = rows.get(key) ?? { kind: d.kind, name: d.name, samples: 0, estimated: 0, msTotal: 0, msCount: 0 };
  row.samples += 1;
  row.estimated += Number(d.weight) || 0;
  if (typeof d.ms === "number") {
    row.msTotal += d.ms;
    row.msCount += 1;
  }
  rows.set(key, row);
}

const sorted = [...rows.values()].sort((a, b) => b.estimated - a.estimated).slice(0, top);
console.log(`admin_cost_samples ${day}: ${snap.size} samples, ${rows.size} names`);
console.log(["kind", "est_calls", "samples", "avg_ms", "name"].join("\t"));
for (const row of sorted) {
  const avg = row.msCount ? Math.round(row.msTotal / row.msCount) : "";
  console.log([row.kind, Math.round(row.estimated), row.samples, avg, row.name].join("\t"));
}
process.exit(0);
