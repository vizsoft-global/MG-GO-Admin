/**
 * Legacy `vehicle_services` backfill — DRY RUN BY DEFAULT.
 *
 * The 10 rows written before the Fleet Service module have no `stage`, no
 * service type and no `done_at`. The UI already reads them correctly (a missing
 * stage renders as Done and `odometer` is the odometer), so this backfill is not
 * required to ship — it only makes the stored rows match the new shape.
 *
 *   node --import tsx scripts/service-records-backfill.mjs            # prints only
 *   CONFIRM_SERVICE_BACKFILL=yes node --import tsx scripts/service-records-backfill.mjs --apply
 *
 * Never deletes. Never touches a row that already has a `stage`.
 */
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { assertProd, loadEnv, loadServiceAccount } from "./perf-env.mjs";
import { categoryForServiceType, serviceTypeKey } from "../src/features/fleet/service/service-types.ts";

const apply = process.argv.includes("--apply");
if (apply && process.env.CONFIRM_SERVICE_BACKFILL !== "yes") {
  console.error("Refusing --apply without CONFIRM_SERVICE_BACKFILL=yes");
  process.exit(1);
}

const account = loadServiceAccount(loadEnv());
assertProd(account);
const app = getApps()[0] ?? initializeApp({ credential: cert(account), projectId: account.projectId });
const db = getFirestore(app, "default");

const services = await db.collection("vehicle_services").get();
const vehicles = await db.collection("vehicles").get();
const plateById = new Map(vehicles.docs.map((doc) => [doc.id, doc.get("reg_number") ?? doc.get("bike_id") ?? doc.id]));

const toIso = (value) => {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return null;
};

const planned = [];
const skipped = [];
const highestKm = new Map();
const implausible = [];

/**
 * A reading outside this band is a typo, not a distance. The production rows
 * include `2345670965431234600`, `999999999`, `54210543` and `1`; seeding any of
 * them would make the maintenance baseline meaningless, so they are reported
 * and ignored rather than written.
 */
const MIN_PLAUSIBLE_KM = 100;
const MAX_PLAUSIBLE_KM = 2_000_000;

for (const doc of services.docs) {
  const row = doc.data() ?? {};
  if (row.stage) {
    skipped.push({ id: doc.id, reason: "already has a stage" });
    continue;
  }
  const kind = typeof row.kind === "string" ? row.kind.trim() : "";
  const label = kind || "Service";
  const servicedAt = toIso(row.serviced_at);
  const rawOdometer = typeof row.odometer === "number" ? row.odometer : null;
  const vehicleId = typeof row.vehicle_id === "string" ? row.vehicle_id : "";
  let odometer = rawOdometer;
  if (
    rawOdometer != null &&
    (rawOdometer < MIN_PLAUSIBLE_KM || rawOdometer > MAX_PLAUSIBLE_KM)
  ) {
    implausible.push({ id: doc.id, value: rawOdometer });
    odometer = null;
  }
  if (vehicleId && odometer != null) {
    highestKm.set(vehicleId, Math.max(highestKm.get(vehicleId) ?? 0, odometer));
  }
  const implausibleRow = rawOdometer != null && odometer == null;
  planned.push({
    id: doc.id,
    plate: (plateById.get(vehicleId) ?? vehicleId) || "(no vehicle linked)",
    vehicleId,
    rawOdometer,
    odometer,
    stage: "done",
    service_type_label: label,
    service_type_key: serviceTypeKey(label),
    category: categoryForServiceType(label),
    done_at: servicedAt,
    done_odometer_km: odometer,
    odometer_km: odometer,
    action: implausibleRow
      ? `stage=done, done_at=${servicedAt ?? "unset"}, odometer_km LEFT UNSET`
      : odometer == null
        ? `stage=done, done_at=${servicedAt ?? "unset"}, odometer_km LEFT UNSET (no reading stored)`
        : `stage=done, done_at=${servicedAt ?? "unset"}, odometer_km=${odometer}`,
    reason: [
      `legacy row without stage; kind "${kind || "(blank)"}" → service type "${label}"`,
      implausibleRow
        ? `odometer ${rawOdometer} is outside the plausible 100–2,000,000 band → value kept as stored, not seeded, not normalised`
        : "",
    ]
      .filter(Boolean)
      .join("; "),
  });
}

console.log(`vehicle_services rows read : ${services.size}`);
console.log(`rows to backfill           : ${planned.length}`);
console.log(`rows skipped               : ${skipped.length}`);
for (const row of skipped) console.log(`  skip ${row.id}: ${row.reason}`);

console.log("\n--- per-record plan (dry run) ---");
for (const row of planned) {
  console.log("");
  console.log(`record id      : ${row.id}`);
  console.log(`vehicle / plate: ${row.vehicleId || "(none)"} / ${row.plate}`);
  console.log(`odometer stored: ${row.rawOdometer ?? "(none)"}`);
  console.log(`service type   : ${row.service_type_label} (${row.service_type_key}) / category ${row.category}`);
  console.log(`projected      : ${row.action}`);
  console.log(`reason         : ${row.reason}`);
}

console.log("\n--- vehicles.current_odometer_km that would be seeded ---");
if (highestKm.size === 0) console.log("  (none — every plausible reading belongs to a record with no vehicle)");
for (const [vehicleId, km] of highestKm) {
  const current = vehicles.docs.find((doc) => doc.id === vehicleId)?.get("current_odometer_km");
  console.log(`  ${plateById.get(vehicleId) ?? vehicleId}: ${current ?? "unknown"} → ${Math.max(Number(current ?? 0), km)}`);
}

if (implausible.length > 0) {
  console.log("\n--- readings outside the plausible band (kept as stored, not written) ---");
  for (const row of implausible) {
    const plan = planned.find((entry) => entry.id === row.id);
    console.log(`  ${row.id} | ${plan?.plate ?? "?"} | ${row.value} | skipped: outside 100–2,000,000 | odometer_km left unset`);
  }
}

// Prove nothing was written: the same rows must still carry no stage/done_at/odometer_km.
const after = await db.collection("vehicle_services").get();
let staged = 0;
let doneAt = 0;
let odometerKm = 0;
for (const doc of after.docs) {
  if (doc.get("stage") != null) staged += 1;
  if (doc.get("done_at") != null) doneAt += 1;
  if (doc.get("odometer_km") != null) odometerKm += 1;
}
console.log("\n--- write check (re-read after the dry run) ---");
console.log(`  rows with a stage      : ${staged} (expected 0)`);
console.log(`  rows with done_at      : ${doneAt} (expected 0)`);
console.log(`  rows with odometer_km  : ${odometerKm} (expected 0)`);
console.log(`  Firestore writes by this run: ${apply ? "apply mode" : "0"}`);

if (!apply) {
  console.log("\nDRY RUN — nothing written. Re-run with --apply and CONFIRM_SERVICE_BACKFILL=yes to write.");
  process.exit(0);
}

let updated = 0;
for (const row of planned) {
  // Implausible readings are never written: the legacy `odometer` keeps whatever
  // it holds and no `odometer_km` / `done_odometer_km` is created from a typo.
  const payload = {
    stage: row.stage,
    service_type_label: row.service_type_label,
    service_type_key: row.service_type_key,
    category: row.category,
    done_at: row.done_at,
    backfilled_at: new Date(),
  };
  if (row.odometer != null) {
    payload.done_odometer_km = row.odometer;
    payload.odometer_km = row.odometer;
  }
  await db.collection("vehicle_services").doc(row.id).set(payload, { merge: true });
  updated += 1;
}
let seeded = 0;
for (const [vehicleId, km] of highestKm) {
  const ref = db.collection("vehicles").doc(vehicleId);
  const snap = await ref.get();
  const current = snap.get("current_odometer_km");
  if (typeof current === "number" && current >= km) continue;
  await ref.set(
    { current_odometer_km: km, odometer_source: "service", odometer_updated_at: new Date() },
    { merge: true },
  );
  seeded += 1;
}
console.log(`\napplied: ${updated} service rows, ${seeded} vehicle odometers`);
