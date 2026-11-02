/**
 * Accident backfill — **dry run only in this pass.**
 *
 *   node --import tsx scripts/accident-backfill.mjs            # dry run
 *   node --import tsx scripts/accident-backfill.mjs --apply    # refused here
 *
 * What the dry run does: opens Firestore read-only, reads `vehicle_accidents` and
 * the reference counter, and prints, per row, the reference it *would* take, the
 * case status it would set, the folded attachment key and the snapshot values it
 * would copy.
 *
 * What it never does: `runTransaction`, an increment of any counter, an R2 call,
 * an upload, or a write of any kind. The projected references come from
 * `projectAccidentReferences`, a pure function that only formats the number it is
 * handed — so a dry run cannot take a reference even by accident.
 *
 * The apply path is written but carries `DRY_RUN_ONLY`, which this pass does not
 * remove: `--apply` answers with the reason instead of writing.
 */
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { assertProd, loadEnv, loadServiceAccount } from "./perf-env.mjs";
import {
  accidentReferenceNumber,
  formatAccidentReference,
  projectAccidentReferences,
} from "../src/features/fleet/accidents/accident-reference.ts";

/** This pass ships the dry run. Flip deliberately, in a later, reviewed change. */
const DRY_RUN_ONLY = true;

const apply = process.argv.includes("--apply");
const confirmed = (process.env.CONFIRM_ACCIDENT_BACKFILL ?? "").trim().toLowerCase() === "yes";

if (apply) {
  if (DRY_RUN_ONLY) {
    console.error("refused: this build is dry-run only (DRY_RUN_ONLY is true).");
    console.error("Nothing was written. Remove the guard in a later reviewed change first.");
    process.exit(1);
  }
  if (!confirmed) {
    console.error("refused: set CONFIRM_ACCIDENT_BACKFILL=yes to apply.");
    process.exit(1);
  }
}

const account = loadServiceAccount(loadEnv());
assertProd(account);
const app = getApps()[0] ?? initializeApp({ credential: cert(account), projectId: account.projectId });
const db = getFirestore(app, "default");

const COUNTER_ID = "accident_reference_seq";
const VEHICLE_ACCIDENTS = "vehicle_accidents";

const str = (value) => (typeof value === "string" && value.trim() ? value.trim() : null);
const num = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);

function instant(value) {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return null;
}

// --- read only -----------------------------------------------------------------
const counterSnap = await db.collection("counters").doc(COUNTER_ID).get();
const counterValue = Number.isFinite(Number(counterSnap.get("value")))
  ? Number(counterSnap.get("value"))
  : 0;

const accidentsSnap = await db.collection(VEHICLE_ACCIDENTS).get();
const vehiclesSnap = await db.collection("vehicles").get();
const vehicles = new Map(vehiclesSnap.docs.map((doc) => [doc.id, doc.data()]));

const rows = accidentsSnap.docs.map((doc) => {
  const row = doc.data();
  const vehicleId = str(row.vehicle_id) ?? "";
  const vehicle = vehicles.get(vehicleId) ?? {};
  const plate = str(vehicle.reg_number) ?? str(vehicle.bike_id) ?? str(row.plate_snapshot) ?? null;
  const keys = Array.isArray(row.attachment_keys)
    ? row.attachment_keys.filter((key) => typeof key === "string")
    : [];
  const legacy = str(row.storage_key);
  const folded = legacy && !keys.includes(legacy) ? [...keys, legacy] : keys;
  const caseStatus = str(row.case_status);
  return {
    id: doc.id,
    current: {
      reference: str(row.reference),
      case_status: caseStatus,
      severity: str(row.severity),
      notes: row.notes ? 1 : 0,
      attachments: folded.length,
    },
    needsReference: accidentReferenceNumber(str(row.reference)) == null,
    needsCase: caseStatus == null,
    foldedKey: legacy && !keys.includes(legacy) ? legacy : null,
    snapshot: {
      plate,
      company_name: str(row.vehicle_company_name),
      model_year: num(row.model_year) ?? num(vehicle.model_year),
      driver_id: str(row.driver_id),
      driver_name: str(row.driver_name),
      occurred_at: instant(row.occurred_at),
    },
    wouldSetCase: caseStatus ?? "pending",
    projectedReference: "",
  };
});

// The projection is pure: it formats numbers, it does not reserve them.
const needingReference = rows.filter((row) => row.needsReference);
const projection = projectAccidentReferences(counterValue, needingReference.length);
let projectedIndex = 0;
for (const row of rows) {
  row.projectedReference = row.current.reference ?? projection.projected[projectedIndex++] ?? "";
}

// --- report --------------------------------------------------------------------
console.log("Accident backfill — DRY RUN (no transaction, no counter increment, no write)\n");
console.log(`accident documents        : ${rows.length}`);
console.log(`counter ${COUNTER_ID} : ${counterValue}`);
console.log(`rows needing a reference  : ${needingReference.length}`);
console.log(`projected references      : ${projection.range || "—"}`);
console.log(`rows needing a case       : ${rows.filter((row) => row.needsCase).length}`);
console.log(`legacy storage_key folded : ${rows.filter((row) => row.foldedKey).length}`);
console.log(
  `next after this run would : ${
    formatAccidentReference(counterValue + projection.projected.length) || "ACC-0001"
  }`,
);

console.log("\nid | reference (current -> projected) | case | files | plate | driver");
const sample = rows.slice(0, 50);
for (const row of sample) {
  console.log(
    [
      row.id,
      `${row.current.reference ?? "—"} -> ${row.projectedReference || "—"}`,
      `${row.current.case_status ?? "—"} -> ${row.wouldSetCase}`,
      String(row.current.attachments),
      row.snapshot.plate ?? "—",
      row.snapshot.driver_name ?? row.snapshot.driver_id ?? "—",
    ].join(" | "),
  );
}
if (rows.length > sample.length) {
  console.log(`… ${rows.length - sample.length} more rows not printed`);
}

console.log("\nNothing was written. No reference was allocated. The DRY_RUN_ONLY guard stays.");

