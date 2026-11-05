/**
 * Seed the scheduled maintenance programs and the client-approved intervals.
 *
 * Two writes, both idempotent because every document id is deterministic:
 *
 *  1. `service_types/{oil_change|tire_front|tire_rear|brake|chain}` with
 *     `tracks_maintenance: true`. The 468 part rows are never touched, so
 *     costing keeps working exactly as it did — only these five participate in
 *     the maintenance calculation.
 *  2. `vehicle_maintenance_schedules/program_*` — the intervals exactly as the
 *     client approved them (see `src/features/fleet/service/service-programs.ts`).
 *     `0` on a dimension means the rule does not track it, and the maintenance
 *     tab prints a dash for it rather than `Unknown`.
 *
 * Dry-run by default; it prints the rules it would write and how many vehicles
 * each one reaches, so a wrong scope is visible before anything is stored.
 *
 *   node --import tsx scripts/service-maintenance-seed.mjs
 *   CONFIRM_MAINTENANCE_SEED=yes node --import tsx scripts/service-maintenance-seed.mjs --apply
 */
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { assertProd, loadEnv, loadServiceAccount } from "./perf-env.mjs";
import {
  APPROVED_PROGRAM_RULES,
  PROGRAM_ALERT_DAYS,
  PROGRAM_ALERT_KM,
  programCatalogRows,
  programApplies,
} from "../src/features/fleet/service/service-programs.ts";
import { makeKey, makeModelKey } from "../src/features/fleet/service/service-maintenance-model.ts";

const apply = process.argv.includes("--apply");
const confirmed = process.env.CONFIRM_MAINTENANCE_SEED === "yes";

if (apply && !confirmed) {
  console.error("Refusing to write without CONFIRM_MAINTENANCE_SEED=yes");
  process.exit(1);
}

const account = loadServiceAccount(loadEnv());
assertProd(account);
const app =
  getApps()[0] ?? initializeApp({ credential: cert(account), projectId: account.projectId });
const db = getFirestore(app, "default");

const now = new Date();

/* ------------------------------------------------------------ vehicles --- */

const vehicleSnap = await db.collection("vehicles").get();
const vehicles = vehicleSnap.docs
  .map((doc) => ({ id: doc.id, ...doc.data() }))
  .filter((row) => !row.archived_at)
  .map((row) => ({
    id: row.id,
    plate: String(row.reg_number ?? row.bike_id ?? row.id),
    make: typeof row.make === "string" ? row.make : null,
    model: typeof row.model === "string" ? row.model : null,
    vehicleTypeKey: typeof row.vehicle_type_key === "string" ? row.vehicle_type_key : null,
    currentKm: typeof row.current_odometer_km === "number" ? row.current_odometer_km : null,
  }));

const byType = new Map();
const byMake = new Map();
const byMakeModel = new Map();
for (const vehicle of vehicles) {
  const type = (vehicle.vehicleTypeKey ?? "").toLowerCase();
  if (type) byType.set(type, (byType.get(type) ?? 0) + 1);
  const mk = makeKey(vehicle.make);
  if (mk) byMake.set(mk, (byMake.get(mk) ?? 0) + 1);
  const mm = makeModelKey(vehicle.make, vehicle.model);
  if (mm) byMakeModel.set(mm, (byMakeModel.get(mm) ?? 0) + 1);
}

function reach(rule) {
  switch (rule.scope) {
    case "vehicle_type":
      return byType.get(rule.vehicleTypeKey ?? "") ?? 0;
    case "make":
      return byMake.get(rule.makeKey ?? "") ?? 0;
    case "make_model":
      return byMakeModel.get(rule.makeModelKey ?? "") ?? 0;
    case "vehicle":
      return vehicles.filter((vehicle) => vehicle.id === rule.vehicleId).length;
    default:
      return 0;
  }
}

function appliesToSomeVehicle(rule) {
  if (rule.scope !== "make" && rule.scope !== "make_model" && rule.scope !== "vehicle_type") {
    return true;
  }
  return vehicles.some((vehicle) => {
    if (!programApplies(rule.programKey, vehicle.vehicleTypeKey)) return false;
    if (rule.scope === "vehicle_type") {
      return (vehicle.vehicleTypeKey ?? "").toLowerCase() === rule.vehicleTypeKey;
    }
    if (rule.scope === "make") return makeKey(vehicle.make) === rule.makeKey;
    return makeModelKey(vehicle.make, vehicle.model) === rule.makeModelKey;
  });

/* ------------------------------------------------------------ report --- */

console.log(`fleet: ${vehicles.length} vehicles`);
console.log(
  `  by type: ${[...byType.entries()].map(([key, count]) => `${key} ${count}`).join(" · ")}`,
);
console.log(`  makes with vehicles: ${byMake.size}`);

console.log(`\nprograms to write: ${programCatalogRows().length}`);
for (const program of programCatalogRows()) {
  console.log(
    `  ${program.key.padEnd(12)} ${program.label_en.padEnd(14)} ${program.category.padEnd(13)} order ${program.sort_order}`,
  );
}

console.log(
  `\nrules to write: ${APPROVED_PROGRAM_RULES.length}  (alert ${PROGRAM_ALERT_KM} km / ${PROGRAM_ALERT_DAYS} days)`,
);
let emptyRules = 0;
for (const rule of APPROVED_PROGRAM_RULES) {
  const scopeValue =
    rule.scope === "vehicle_type" ? rule.vehicleTypeKey : rule.scope === "make" ? rule.makeKey : "—";
  const vehiclesReached = reach(rule);
  const reachable = appliesToSomeVehicle(rule);
  if (!reachable) emptyRules += 1;
  console.log(
    `  ${rule.programKey.padEnd(12)} ${rule.scope.padEnd(13)} ${String(scopeValue ?? "—").padEnd(22)} ` +
      `km ${String(rule.kmInterval).padStart(6)}  days ${String(rule.dayInterval).padStart(4)}  ` +
      `vehicles ${String(vehiclesReached).padStart(3)}${reachable ? "" : "   <-- reaches nothing"}`,
  );
}
if (emptyRules > 0) {
  console.log(
    `\n${emptyRules} rule(s) reach no vehicle. That is allowed — a make the fleet does not hold yet — but check the spelling.`,
  );
}

if (!apply) {
  console.log("\nDry run. Re-run with CONFIRM_MAINTENANCE_SEED=yes and --apply to write.");
  process.exit(0);
}

/* ------------------------------------------------------------- write --- */

for (const program of programCatalogRows()) {
  const ref = db.collection("service_types").doc(program.key);
  const snap = await ref.get();
  const existing = snap.exists ? (snap.data() ?? {}) : null;
  await ref.set(
    {
      key: program.key,
      // The Arabic label is the client's own wording, never machine translated.
      label_en: existing?.label_en ?? program.label_en,
      label_ar: existing?.label_ar || program.label_ar,
      category: program.category,
      is_active: existing?.is_active !== false,
      sort_order: program.sort_order,
      tracks_maintenance: true,
      updated_at: now,
      ...(existing ? {} : { created_at: now }),
    },
    { merge: true },
  );
}
console.log(`\nwrote ${programCatalogRows().length} service_types rows`);

for (const rule of APPROVED_PROGRAM_RULES) {
  const ref = db.collection("vehicle_maintenance_schedules").doc(rule.id);
  await ref.set(
    {
      id: rule.id,
      scope: rule.scope,
      vehicle_id: rule.vehicleId ?? null,
      make_model_key: rule.makeModelKey ?? null,
      make_key: rule.makeKey ?? null,
      vehicle_type_key: rule.vehicleTypeKey ?? null,
      service_type_key: rule.programKey,
      service_type_label:
        programCatalogRows().find((program) => program.key === rule.programKey)?.label_en ??
        rule.programKey,
      km_interval: rule.kmInterval,
      day_interval: rule.dayInterval,
      alert_km: rule.alertKm,
      alert_days: rule.alertDays,
      is_active: true,
      note: rule.note,
      source: "client_approved",
      updated_at: now,
      created_at: now,
    },
    { merge: true },
  );
}
console.log(`wrote ${APPROVED_PROGRAM_RULES.length} interval rules`);
console.log(
  "\nConfirm intervals still has to be pressed once in the panel: it clears `provisional` and stamps who approved the fleet defaults.",
);

}
