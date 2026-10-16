/**
 * QA #25 — stop `salary_justification` demanding both amount fields.
 *
 *   node scripts/qa-25-salary-fields.mjs           # dry run (default)
 *   CONFIRM_QA25=yes node scripts/qa-25-salary-fields.mjs --apply
 *
 * The rider form blocks submit on `is_required`, and both `expected_amount` and
 * `received_amount` carried it, so a rider who had only one figure could not send
 * the request at all. The pair is an alternative: `rcm_validate_request_input` now
 * returns `salary_amount_required` when both are empty, which is the real gate.
 *
 * Touches only `is_required` on those two rows. Everything else is left alone.
 */
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { assertProd, loadEnv, loadServiceAccount } from "./perf-env.mjs";

const SALARY_FIELDS = new Set(["expected_amount", "received_amount"]);
const apply = process.argv.includes("--apply");
if (apply && process.env.CONFIRM_QA25 !== "yes") {
  console.error("confirm_required: set CONFIRM_QA25=yes");
  process.exit(2);
}

const account = loadServiceAccount(loadEnv());
assertProd(account);
const app = getApps()[0] ?? initializeApp({ credential: cert(account), projectId: account.projectId });
const db = getFirestore(app, "default");

const snap = await db
  .collection("request_field_definitions")
  .where("type_key", "==", "salary_justification")
  .get();

const targets = snap.docs.filter((doc) => SALARY_FIELDS.has(doc.get("field_key")));
if (targets.length !== SALARY_FIELDS.size) {
  console.error(
    `expected ${SALARY_FIELDS.size} amount rows, found ${targets.length} — aborting`,
  );
  process.exit(2);
}

for (const doc of targets) {
  const current = doc.get("is_required") === true;
  console.log(
    `${doc.get("field_key").padEnd(18)} is_required=${current} -> ${apply ? false : "false (dry run)"}`,
  );
  if (apply && current) {
    await doc.ref.update({ is_required: false });
  }
}
console.log(apply ? "applied" : "dry run — pass --apply with CONFIRM_QA25=yes");
