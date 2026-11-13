/**
 * Write every rider's own Civil ID into their beneficiary Civil ID.
 *
 * `bank_details.beneficiary_civil_id` is meant to mirror the rider's Civil ID
 * unless someone overrides it, and the profile now fills it from the Civil ID
 * when nothing is stored. That is a display fix; the stored document stays
 * empty until the record is saved. This writes it for the whole fleet.
 *
 * What it will and will not touch:
 *
 *  - A rider with a Civil ID and **no** beneficiary Civil ID gets their own.
 *  - A rider who already has a different beneficiary Civil ID keeps it, because
 *    a different ID is a deliberate statement about who is paid.
 *  - A rider with the same value stored is skipped, so a second run writes
 *    nothing.
 *  - A rider with no Civil ID is skipped: there is nothing to mirror.
 *
 * The value is written as a NESTED object, not as a dotted key. `set()` with a
 * `"bank_details.beneficiary_civil_id"` string creates a field whose *name*
 * literally contains the dots — `bank_details` stays empty and every reader that
 * looks inside the map sees nothing. `merge: true` is recursive for nested maps,
 * so bank_code / account_number / iban / currency survive the write.
 *
 * The same mistake left a literal `"bank_details.beneficiary_civil_id"` field on
 * documents from an earlier run; `--clean-literal` deletes it. Addressing that
 * field requires a single-segment `FieldPath`, because a dotted string would
 * resolve to a nested path instead.
 *
 * Dry run by default. `--apply` writes, and `CONFIRM_BENEFICIARY_BACKFILL=yes`
 * has to be set with it so the flag cannot be passed by accident.
 */
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldPath, FieldValue, getFirestore } from "firebase-admin/firestore";
import { assertProd, loadEnv, loadServiceAccount } from "./perf-env.mjs";

const account = loadServiceAccount(loadEnv());
assertProd(account);
const app = getApps()[0] ?? initializeApp({ credential: cert(account), projectId: account.projectId });
const db = getFirestore(app, "default");

const LITERAL_KEY = "bank_details.beneficiary_civil_id";
/** A one-segment path is a literal field name; `"a.b"` as a string is a path. */
const literalPath = new FieldPath(LITERAL_KEY);

const apply = process.argv.includes("--apply");
const cleanLiteral = process.argv.includes("--clean-literal");
const confirmed = process.env.CONFIRM_BENEFICIARY_BACKFILL === "yes";
if (apply && !confirmed) {
  console.error("Refusing to write without CONFIRM_BENEFICIARY_BACKFILL=yes");
  process.exit(1);
}

const BATCH = 400;
const text = (value) => (typeof value === "string" ? value.trim() : "");

async function main() {
  const snap = await db.collection("drivers").get();
  console.log(`drivers scanned: ${snap.size}`);

  const planned = [];
  const stale = [];
  let keptOverride = 0;
  let skippedNoCivil = 0;
  let alreadySet = 0;

  for (const doc of snap.docs) {
    const row = doc.data() ?? {};
    const civilId = text(row.civil_id);
    const bank = row.bank_details ?? {};
    const beneficiary = text(bank.beneficiary_civil_id);
    const hasLiteral = Object.prototype.hasOwnProperty.call(row, LITERAL_KEY);

    if (hasLiteral) stale.push(doc.id);

    if (!civilId) {
      skippedNoCivil += 1;
      continue;
    }
    if (beneficiary === civilId) {
      alreadySet += 1;
      continue;
    }
    if (beneficiary) {
      // A different ID is an override; leave it alone.
      keptOverride += 1;
      continue;
    }
    planned.push({ id: doc.id, civilId });
  }

  console.log(`  already mirrored:      ${alreadySet}`);
  console.log(`  override kept:         ${keptOverride}`);
  console.log(`  skipped (no Civil ID): ${skippedNoCivil}`);
  console.log(`  nested value to write: ${planned.length}`);
  console.log(`  stale literal fields:  ${stale.length}`);

  if (!apply) {
    console.log("\ndry run - re-run with --apply and CONFIRM_BENEFICIARY_BACKFILL=yes to write");
    for (const row of planned.slice(0, 3)) console.log(`  would set ${row.id} -> ${row.civilId}`);
    if (cleanLiteral && stale.length > 0) {
      console.log(`  would delete the literal field on ${stale.length} documents`);
    }
    return;
  }

  let written = 0;
  for (let index = 0; index < planned.length; index += BATCH) {
    const batch = db.batch();
    for (const row of planned.slice(index, index + BATCH)) {
      // Nested map, not a dotted key: merge is recursive, so the rest of
      // bank_details is preserved.
      batch.set(
        db.collection("drivers").doc(row.id),
        {
          bank_details: { beneficiary_civil_id: row.civilId },
          updated_at: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }
    await batch.commit();
    written += Math.min(BATCH, planned.length - index);
    console.log(`  committed ${written}/${planned.length}`);
  }
  console.log(`done - ${written} riders updated`);

  if (!cleanLiteral) {
    if (stale.length > 0) {
      console.log(
        `\n${stale.length} documents still carry the literal "${LITERAL_KEY}" field; re-run with --clean-literal to remove it`,
      );
    }
    return;
  }

  let cleaned = 0;
  for (let index = 0; index < stale.length; index += BATCH) {
    const batch = db.batch();
    for (const id of stale.slice(index, index + BATCH)) {
      batch.update(db.collection("drivers").doc(id), literalPath, FieldValue.delete());
    }
    await batch.commit();
    cleaned += Math.min(BATCH, stale.length - index);
    console.log(`  cleaned ${cleaned}/${stale.length}`);
  }
  console.log(`done - literal field removed from ${cleaned} documents`);
}

main().catch((error) => {
  console.error("ERR", error);
  process.exit(1);
});
