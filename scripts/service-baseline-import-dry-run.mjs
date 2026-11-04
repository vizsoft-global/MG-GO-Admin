/**
 * Dry-run the client's baseline sheet against the live fleet.
 *
 * **Read-only.** It reads `vehicles`, `vehicle_maintenance_schedules` and
 * `service_maintenance_settings`, runs the same `previewBaselineImport` the panel
 * runs, and prints the four groups plus every `Next Km` disagreement. Nothing is
 * written and nothing is deployed.
 *
 *   node --import tsx scripts/service-baseline-import-dry-run.mjs
 *   node --import tsx scripts/service-baseline-import-dry-run.mjs --sheet="scripts/fixtures/service-cars.xlsx"
 */
import fs from "node:fs";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import XLSX from "xlsx";
import { assertProd, loadEnv, loadServiceAccount } from "./perf-env.mjs";
const baselineModule = await import(
  "../src/features/fleet/service/service-baseline-import"
);
const modelModule = await import(
  "../src/features/fleet/service/service-maintenance-model"
);
// tsx exposes a CommonJS-transpiled module either flat or under `default`.
const previewBaselineImport =
  baselineModule.previewBaselineImport ?? baselineModule.default?.previewBaselineImport;
const DEFAULT_MAINTENANCE_SETTINGS =
  modelModule.DEFAULT_MAINTENANCE_SETTINGS ?? modelModule.default?.DEFAULT_MAINTENANCE_SETTINGS;
if (!previewBaselineImport || !DEFAULT_MAINTENANCE_SETTINGS) {
  throw new Error("could not load the baseline-import preview from src");
}

const sheetArg = process.argv.find((arg) => arg.startsWith("--sheet="));
const sheetPath = sheetArg
  ? sheetArg.slice("--sheet=".length).replace(/^"|"$/g, "")
  : "scripts/fixtures/service-cars.xlsx";

const account = loadServiceAccount(loadEnv());
assertProd(account);
const app =
  getApps()[0] ?? initializeApp({ credential: cert(account), projectId: account.projectId });
const db = getFirestore(app, "default");

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}
function num(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/* --------------------------------------------------------------- fleet --- */

const vehicleSnap = await db.collection("vehicles").get();
const fleet = vehicleSnap.docs
  .map((doc) => ({ id: doc.id, ...doc.data() }))
  .filter((row) => !row.archived_at)
  .map((row) => ({
    id: row.id,
    plate: text(row.reg_number) || text(row.bike_id) || row.id,
    chassisNo: text(row.chassis_no) || null,
    make: text(row.make) || null,
    model: text(row.model) || null,
    vehicleTypeKey: text(row.vehicle_type_key) || null,
    condition: text(row.condition) || null,
    zoneName: null,
    driverName: null,
    currentKm: num(row.current_odometer_km),
  }));

/* --------------------------------------------------------------- rules --- */

const rulesArg = process.argv.find((arg) => arg.startsWith("--rules="));
const ruleSource = rulesArg ? rulesArg.slice("--rules=".length) : "approved";

const ruleSnap = await db.collection("vehicle_maintenance_schedules").get();
const storedRules = ruleSnap.docs.map((doc) => {
  const row = doc.data();
  const raw = text(row.scope);
  const scope =
    raw === "vehicle"
      ? "vehicle"
      : raw === "make"
        ? "make"
        : raw === "vehicle_type"
          ? "vehicle_type"
          : "make_model";
  return {
    id: doc.id,
    scope,
    vehicle_id: text(row.vehicle_id) || null,
    make_model_key: text(row.make_model_key) || null,
    make_key: text(row.make_key) || null,
    vehicle_type_key: text(row.vehicle_type_key) || null,
    service_type_key: text(row.service_type_key),
    service_type_label: text(row.service_type_label) || null,
    km_interval: num(row.km_interval) ?? 0,
    day_interval: num(row.day_interval) ?? 0,
    alert_km: num(row.alert_km) ?? 0,
    alert_days: num(row.alert_days) ?? 0,
    is_active: row.is_active !== false,
    created_at: null,
    updated_at: null,
  };
});

const programModule = await import("../src/features/fleet/service/service-programs");
const approvedRulesAsSchedules =
  programModule.approvedRulesAsSchedules ?? programModule.default?.approvedRulesAsSchedules;

// `stored` shows production as it is today (the seed has not been applied, so it
// resolves nothing); `approved` shows what the import will decide once the seed is
// written, which is the run that answers the client's question.
const rules = ruleSource === "stored" ? storedRules : approvedRulesAsSchedules();

const settingsSnap = await db
  .collection("service_maintenance_settings")
  .doc("current")
  .get();
const settingsRow = settingsSnap.exists ? settingsSnap.data() : {};
const settings = {
  ...DEFAULT_MAINTENANCE_SETTINGS,
  km_interval: num(settingsRow.km_interval) ?? DEFAULT_MAINTENANCE_SETTINGS.km_interval,
  day_interval: num(settingsRow.day_interval) ?? DEFAULT_MAINTENANCE_SETTINGS.day_interval,
  alert_km: num(settingsRow.alert_km) ?? DEFAULT_MAINTENANCE_SETTINGS.alert_km,
  alert_days: num(settingsRow.alert_days) ?? DEFAULT_MAINTENANCE_SETTINGS.alert_days,
  provisional: settingsRow.provisional !== false,
};
// Kept only so the report can say whether the fleet defaults are still unconfirmed;
// no row is judged by them any more.
void settings;

/* --------------------------------------------------------------- sheet --- */

const workbook = XLSX.read(fs.readFileSync(sheetPath), { type: "buffer" });
const worksheet = workbook.Sheets[workbook.SheetNames[0] ?? ""];
const rows = worksheet
  ? XLSX.utils.sheet_to_json(worksheet, { header: 1, blankrows: false, defval: "" })
  : [];

/* ------------------------------------------------------------- preview --- */

const preview = previewBaselineImport(rows, fleet, rules, settings);

console.log(`sheet: ${sheetPath}`);
console.log(`  sheet rows (incl. header): ${rows.length}   header row: ${preview.headerRow + 1}`);
console.log(`  fleet vehicles: ${fleet.length}   rules: ${rules.length} (${ruleSource})`);
console.log("");
console.log("groups:");
console.log(`  matched by plate  : ${preview.counts.plate}`);
console.log(`  matched by chassis: ${preview.counts.chassis}`);
console.log(`  created (new car) : ${preview.counts.create}`);
console.log(`  rejected          : ${preview.counts.reject}`);
console.log(`  total             : ${preview.counts.total}`);
console.log("");
console.log(`blocked (Current KM below last service): ${preview.kmBelowService}`);

const created = preview.items.filter((item) => item.group === "create");
if (created.length > 0) {
  console.log(`new vehicles (${created.length}):`);
  for (const item of created) {
    console.log(
      `  row ${String(item.sheetRow).padStart(3)}  ${item.plate.padEnd(10)} ` +
        `${String(item.modelRaw ?? "—").padEnd(24)} ` +
        `km ${String(item.currentKm ?? "—").padStart(7)}  ` +
        `last ${String(item.lastServiceKm ?? "—").padStart(7)}  ` +
        `${item.lastServiceDay ?? "—"}`,
    );
  }
  console.log("");
}

const chassis = preview.items.filter((item) => item.group === "chassis");
if (chassis.length > 0) {
  console.log(`matched by chassis (${chassis.length}):`);
  for (const item of chassis) {
    console.log(`  row ${item.sheetRow}  sheet ${item.plate} → fleet ${item.matchedPlate}`);
  }
  console.log("");
}

const rejected = preview.items.filter((item) => item.group === "reject");
if (rejected.length > 0) {
  console.log(`rejected (${rejected.length}):`);
  for (const item of rejected) {
    console.log(`  row ${item.sheetRow}  ${item.plate || "—"}  ${item.notes.join(", ")}`);
  }
  console.log("");
}

const mismatches = preview.items.filter((item) => item.nextKmDisagrees);
console.log(`Next Km disagreements: ${preview.nextKmMismatches} / ${preview.counts.total}`);
for (const item of mismatches) {
  console.log(
    `  row ${String(item.sheetRow).padStart(3)}  ${item.plate.padEnd(10)} ` +
      `last ${String(item.lastServiceKm).padStart(7)} + ${String(item.kmInterval).padStart(6)} ` +
      `= ${String(item.expectedNextKm).padStart(7)}   sheet says ${String(item.nextKm).padStart(7)}`,
  );
}
