/**
 * Read-only probe: why does an Attendance & Orders day adjustment toast
 * "Something went wrong. The adjustment was not saved."?
 *
 * Prints the newest `payroll_manual_adjustments` rows, the matching
 * `payroll_rule_audit_logs` entries (written after the batch commits), the
 * page-read generation doc the adjustment bumps, and the actor profile the
 * callable reads for the "Last edited by" line.
 *
 *   node scripts/probe-payroll-adjustments.mjs [employee_id]
 */
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { assertProd, loadEnv, loadServiceAccount } from "./perf-env.mjs";

const account = loadServiceAccount(loadEnv());
assertProd(account);
const app = getApps()[0] ?? initializeApp({ credential: cert(account), projectId: account.projectId });
const db = getFirestore(app, "default");

const kuwait = (value) => {
  if (!value) return "—";
  const date = typeof value.toDate === "function" ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Date(date.getTime() + 3 * 3600_000).toISOString().replace("T", " ").slice(0, 16);
};

console.log("#### payroll_manual_adjustments (newest 15)");
const adjustments = await db
  .collection("payroll_manual_adjustments")
  .orderBy("adjusted_at", "desc")
  .limit(15)
  .get();
console.log(`rows: ${adjustments.size}`);
const driverIds = new Set();
for (const doc of adjustments.docs) {
  const row = doc.data() ?? {};
  if (typeof row.driver_id === "string") driverIds.add(row.driver_id);
  console.log(
    `  ${doc.id} | ${kuwait(row.adjusted_at)} | driver=${row.driver_id} | ${row.work_date} | ` +
      `orig=${row.original_status} -> ${row.adjusted_status}${row.adjusted_hours == null ? "" : ` (${row.adjusted_hours}h)`} | ` +
      `by=${row.adjusted_by_name ?? "—"} (${row.adjusted_by ?? "—"}) | reason=${row.reason}`,
  );
}

console.log("\n#### payroll_rule_audit_logs (newest 15)");
const audits = await db
  .collection("payroll_rule_audit_logs")
  .orderBy("created_at", "desc")
  .limit(15)
  .get();
console.log(`rows: ${audits.size}`);
for (const doc of audits.docs) {
  const row = doc.data() ?? {};
  console.log(
    `  ${doc.id} | ${kuwait(row.created_at)} | ${row.entity}/${row.action} | ${row.actor_name ?? "—"} | ` +
      `after=${JSON.stringify(row.after)}`,
  );
}

console.log("\n#### page_read_generations/current");
const generation = await db.collection("page_read_generations").doc("current").get();
if (!generation.exists) console.log("  MISSING");
else {
  const data = generation.data() ?? {};
  const keys = Object.keys(data).filter((key) => key.startsWith("admin"));
  console.log(`  updated_at=${kuwait(data.updated_at)}`);
  for (const key of keys.sort()) console.log(`  ${key}=${data[key]}`);
}

if (driverIds.size) {
  console.log(`\n#### drivers behind those rows (${driverIds.size})`);
  for (const id of driverIds) {
    const snap = await db.collection("drivers").doc(id).get();
    if (!snap.exists) {
      console.log(`  ${id}: MISSING`);
      continue;
    }
    const d = snap.data() ?? {};
    console.log(
      `  ${id}: employee_id=${d.employee_id ?? "—"} name=${JSON.stringify(
        d.full_name ?? d.name ?? null,
      )} archived_at=${d.archived_at ? kuwait(d.archived_at) : "null"} status=${d.status ?? "—"}`,
    );
  }
}

const employeeId = (process.argv[2] ?? "1344").trim();
console.log(`\n#### employees matching "${employeeId}"`);
const drivers = await db.collection("drivers").get();
for (const doc of drivers.docs) {
  const d = doc.data() ?? {};
  const ids = [d.employee_id, d.driver_code, d.client_id].filter((v) => typeof v === "string");
  if (!ids.includes(employeeId)) continue;
  console.log(
    `  ${doc.id}: employee_id=${d.employee_id ?? "—"} archived_at=${
      d.archived_at ? kuwait(d.archived_at) : "null"
    } name=${JSON.stringify(d.full_name ?? d.name ?? null)}`,
  );
}

console.log("\n#### staff profiles used by actorName()");
const profileIds = new Set();
for (const doc of adjustments.docs) {
  const by = (doc.data() ?? {}).adjusted_by;
  if (typeof by === "string" && by) profileIds.add(by);
}
for (const uid of profileIds) {
  const snap = await db.collection("profiles").doc(uid).get();
  if (!snap.exists) {
    console.log(`  ${uid}: MISSING profile doc`);
    continue;
  }
  const p = snap.data() ?? {};
  console.log(`  ${uid}: full_name=${JSON.stringify(p.full_name ?? null)} role=${p.role ?? "—"}`);
}

process.exit(0);
