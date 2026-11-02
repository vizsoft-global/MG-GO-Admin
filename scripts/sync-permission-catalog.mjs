/**
 * Sync the permission catalog documents from the code catalog.
 *
 * `admin_permissions/catalog` and `admin_permissions/permissions` are what a
 * **Full access** (`access_kind: "manager"`) session resolves its permission set
 * from — nothing else. The code catalog is `src/lib/auth/permission-catalog.ts`,
 * and the two drifted apart: on 2026-11-02 both docs held 161 slugs and were
 * missing all thirteen added since the last seed.
 *
 *   drivers.bank_view  service.view  service.manage  service.export
 *   payroll.payroll  payroll.combined  payroll.attendance_orders
 *   payroll.app_attendance  payroll.requests  payroll.settings  payroll.hr_payroll
 *   compliance.view  compliance.manage
 *
 * A manager therefore lost Fleet → Service and every Payroll tab while a User
 * with an explicit tick kept them, which reads as "full access, but the page is
 * missing". The panel now unions the code catalog into every manager read
 * (`catalogWithCodeSlugs`), so this cannot hide a page again; this script makes
 * the stored documents agree, which is also what the Cloud Functions gate reads.
 *
 * Dry-run by default. Union only — a slug already on the doc is never removed.
 *
 *   node --import tsx scripts/sync-permission-catalog.mjs
 *   CONFIRM_CATALOG_SYNC=yes node --import tsx scripts/sync-permission-catalog.mjs --apply
 */
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { assertProd, loadEnv, loadServiceAccount } from "./perf-env.mjs";
import { CATALOG_SLUGS } from "../src/lib/auth/permission-catalog.ts";

const DOC_IDS = ["catalog", "permissions"];

const apply = process.argv.includes("--apply");

const account = loadServiceAccount(loadEnv());
assertProd(account);
const app =
  getApps()[0] ?? initializeApp({ credential: cert(account), projectId: account.projectId });
const db = getFirestore(app, "default");

async function plan(id) {
  const ref = db.collection("admin_permissions").doc(id);
  const snap = await ref.get();
  const before = Array.isArray(snap.get("slugs"))
    ? snap.get("slugs").filter((slug) => typeof slug === "string")
    : [];
  const stored = new Set(before);
  const missing = CATALOG_SLUGS.filter((slug) => !stored.has(slug));
  const after = [...before, ...missing];
  return { ref, exists: snap.exists, before, missing, after };
}

const plans = await Promise.all(DOC_IDS.map(plan));

console.log(`code catalog: ${CATALOG_SLUGS.length} slugs`);
for (const [index, entry] of plans.entries()) {
  const id = DOC_IDS[index];
  console.log(`\nadmin_permissions/${id}  (exists: ${entry.exists})`);
  console.log(`  before : ${entry.before.length} slugs`);
  console.log(`  missing: ${entry.missing.length}`);
  if (entry.missing.length > 0) {
    for (const slug of entry.missing) console.log(`    + ${slug}`);
  }
  console.log(`  after  : ${entry.after.length} slugs`);
}

const totalMissing = plans.reduce((sum, entry) => sum + entry.missing.length, 0);
if (totalMissing === 0) {
  console.log("\nNothing to do — both documents already cover the code catalog.");
  process.exit(0);
}

if (!apply) {
  console.log("\nDry run. Re-run with CONFIRM_CATALOG_SYNC=yes and --apply to write.");
  process.exit(0);
}

if (process.env.CONFIRM_CATALOG_SYNC !== "yes") {
  console.error("\nRefusing to write without CONFIRM_CATALOG_SYNC=yes");
  process.exit(1);
}

for (const entry of plans) {
  // The doc is a flattened slug array, so the union is the whole field.
  await entry.ref.set({ slugs: entry.after, updated_at: new Date() }, { merge: true });
  console.log(`\nwrote admin_permissions/${entry.ref.id} (${entry.after.length} slugs)`);
}

// A manager's session and every staff callable cache the permission documents
// under the `access` counter, so it has to move or the old set stays warm.
await db
  .collection("auth_epochs")
  .doc("current")
  .set({ access: FieldValue.increment(1), updated_at: new Date() }, { merge: true });
console.log("bumped auth_epochs/current.access");
