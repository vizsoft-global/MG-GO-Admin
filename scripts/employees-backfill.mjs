/**
 * Dry-run planner for employee HR stamps.
 *
 * Default is read-only. Never writes unless --apply AND CONFIRM_EMPLOYEE_BACKFILL=yes.
 * This pass must not be run with --apply.
 *
 * Status writes:
 *   - ONLY live (archived_at == null) rows with an empty employee_status_key
 *     are planned as employee_status_key=running
 *   - never writes new, absent_mosal, absent_moi, transfer_from_company,
 *     on_hold, training, extension, accident, running (already set), or any
 *     custom non-empty key
 *   - never writes employee_status_key on archived drivers/intakes
 *   - never touches drivers.status, is_blocked, or archived_at
 *   - archived and live rows may still be planned for civil_id_lower /
 *     passport_lower search stamps
 *   - passport uniqueness is among live rows only (archived_at == null)
 */
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { assertProd, loadEnv, loadServiceAccount } from "./perf-env.mjs";

const apply = process.argv.includes("--apply");
if (apply) {
  if (process.env.CONFIRM_EMPLOYEE_BACKFILL !== "yes") {
    console.error("confirm_required");
    process.exit(2);
  }
  console.error("apply_blocked_this_pass");
  process.exit(2);
}

const account = loadServiceAccount(loadEnv());
assertProd(account);
const app = getApps()[0] ?? initializeApp({ credential: cert(account), projectId: account.projectId });
const db = getFirestore(app, "default");

function lower(value) {
  return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : null;
}

function isArchived(data) {
  return data.archived_at != null && data.archived_at !== "";
}

function planDoc(collection, id, data) {
  const archived = isArchived(data);
  const civil = lower(data.civil_id ?? data.civilId);
  const passport = lower(data.passport_number ?? data.passportNumber);
  const status = typeof data.employee_status_key === "string" ? data.employee_status_key.trim() : "";
  const planned = [];
  if (civil && data.civil_id_lower !== civil) planned.push("civil_id_lower");
  if (passport && data.passport_lower !== passport) planned.push("passport_lower");
  if (!archived && !status) planned.push("employee_status_key:running");
  return {
    collection,
    id,
    archived,
    planned,
    wouldSetRunning: !archived && !status,
    stampSearchOnly: archived && planned.length > 0,
  };
}

const [driversSnap, intakesSnap] = await Promise.all([
  db.collection("drivers").select(
    "archived_at",
    "civil_id",
    "passport_number",
    "civil_id_lower",
    "passport_lower",
    "employee_status_key",
  ).get(),
  db.collection("driver_intakes").select(
    "archived_at",
    "civil_id",
    "passport_number",
    "civil_id_lower",
    "passport_lower",
    "employee_status_key",
  ).get(),
]);

const plans = [
  ...driversSnap.docs.map((doc) => planDoc("drivers", doc.id, doc.data() ?? {})),
  ...intakesSnap.docs.map((doc) => planDoc("driver_intakes", doc.id, doc.data() ?? {})),
];

const live = plans.filter((row) => !row.archived);
const archived = plans.filter((row) => row.archived);
const liveMissingStatus = live.filter((row) => row.wouldSetRunning).length;
const archivedStatusSkipped = archived.length;
const stampCivil = plans.filter((row) => row.planned.includes("civil_id_lower")).length;
const stampPassport = plans.filter((row) => row.planned.includes("passport_lower")).length;
const archivedSearchOnly = archived.filter((row) => row.stampSearchOnly).length;
const writes = plans.filter((row) => row.planned.length > 0).length;

console.log(
  JSON.stringify(
    {
      mode: "dry-run",
      scanned: plans.length,
      drivers: driversSnap.size,
      intakes: intakesSnap.size,
      live: live.length,
      archived: archived.length,
      live_missing_status_would_set_running: liveMissingStatus,
      archived_status_never_written: archivedStatusSkipped,
      archived_search_stamps_only: archivedSearchOnly,
      stamp_civil_id_lower: stampCivil,
      stamp_passport_lower: stampPassport,
      planned_writes_if_apply: writes,
      statuses_never_written: [
        "new",
        "running (already set)",
        "absent_mosal",
        "absent_moi",
        "transfer_from_company",
        "on_hold",
        "training",
        "extension",
        "accident",
        "any custom non-empty employee_status_key",
        "any status on archived drivers/intakes",
        "drivers.status / is_blocked / archived_at (login fields)",
      ],
      archived_rule:
        "archived rows never receive employee_status_key=running; search lowers may still be stamped; passport uniqueness is live-only",
    },
    null,
    2,
  ),
);
