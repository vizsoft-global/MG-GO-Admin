/**
 * Read-only probe: who is holding an employee id / phone, and are any
 * `uniq_*` locks stale (owner record deleted, lock left behind)?
 *
 *   node scripts/probe-identity-locks.mjs [employee_id_or_phone]
 */
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { assertProd, loadEnv, loadServiceAccount } from "./perf-env.mjs";

const account = loadServiceAccount(loadEnv());
assertProd(account);
const app = getApps()[0] ?? initializeApp({ credential: cert(account), projectId: account.projectId });
const db = getFirestore(app, "default");

const LOCKS = ["uniq_employee_id", "uniq_phone", "uniq_civil_id", "uniq_passport"];
const mask = (value) => {
  const text = String(value ?? "");
  return text.length <= 4 ? text : `${text.slice(0, 3)}***${text.slice(-2)}`;
};

/** Batch read so 900+ owners cost a handful of round trips, not thousands. */
async function existingOwnerIds(owners) {
  const found = new Set();
  const unique = [...new Set(owners.filter((id) => typeof id === "string" && id))];
  for (const collection of ["driver_intakes", "drivers", "profiles"]) {
    for (let index = 0; index < unique.length; index += 300) {
      const slice = unique.slice(index, index + 300);
      const snaps = await db.getAll(...slice.map((id) => db.collection(collection).doc(id)));
      for (const snap of snaps) if (snap.exists) found.add(snap.id);
    }
  }
  return found;
}

for (const collection of LOCKS) {
  const snap = await db.collection(collection).get();
  const owners = snap.docs.map((doc) => doc.data()?.owner_id);
  const alive = await existingOwnerIds(owners);
  let stale = 0;
  const samples = [];
  snap.docs.forEach((doc, index) => {
    const owner = owners[index];
    if (typeof owner === "string" && owner && alive.has(owner)) return;
    stale += 1;
    if (samples.length < 6) {
      samples.push(`${mask(doc.id)} -> ${owner ?? "(no owner_id)"} (owner gone)`);
    }
  });
  console.log(`#### ${collection}: rows=${snap.size} stale=${stale}`);
  for (const sample of samples) console.log(`  ${sample}`);
}

console.log("\n#### intakes with no driver row (invisible in the Employees list)");
const intakes = await db.collection("driver_intakes").get();
let orphanOpen = 0;
let orphanArchived = 0;
const orphanSamples = [];
for (const doc of intakes.docs) {
  const row = doc.data() ?? {};
  if (typeof row.linked_profile_id === "string" && row.linked_profile_id) continue;
  if (row.archived_at) {
    orphanArchived += 1;
    continue;
  }
  orphanOpen += 1;
  if (orphanSamples.length < 8) {
    orphanSamples.push(
      `  ${doc.id} | MG ${row.employee_id ?? "—"} | phone ${mask(row.phone)} | status ${row.status ?? "—"} | ${row.full_name ?? "—"}`,
    );
  }
}
console.log(`open=${orphanOpen} archived=${orphanArchived} total intakes=${intakes.size}`);
for (const sample of orphanSamples) console.log(sample);

const needle = (process.argv[2] ?? "").trim().toLowerCase();
if (needle) {
  const digits = needle.replace(/\D+/g, "");
  console.log(`\n#### who holds "${needle}"`);
  for (const doc of intakes.docs) {
    const row = doc.data() ?? {};
    const employeeId = String(row.employee_id ?? "").toLowerCase();
    const phone = String(row.phone ?? "").replace(/\D+/g, "");
    if (employeeId !== needle && !(digits && phone === digits)) continue;
    console.log(
      `  intake ${doc.id} | MG ${row.employee_id ?? "—"} | phone ${mask(row.phone)} | archived=${
        row.archived_at ? "yes" : "no"
      } | linked=${row.linked_profile_id ?? "—"} | ${row.full_name ?? "—"}`,
    );
  }
  for (const lockCollection of LOCKS) {
    for (const candidate of [needle, needle.toUpperCase(), digits]) {
      if (!candidate) continue;
      const doc = await db.collection(lockCollection).doc(encodeURIComponent(candidate)).get();
      if (doc.exists) console.log(`  lock ${lockCollection}/${candidate} -> owner ${doc.data()?.owner_id}`);
    }
  }
}

process.exit(0);
