/**
 * Delete ONE junk Fleet Service record — DRY RUN BY DEFAULT.
 *
 * `vehicle_services/32b331a9-573c-4016-83a0-a953042df6f5` is the legacy row that
 * cost analysis choked on: vendor "2345670lkhgvtdsdc", odometer
 * 2345670965431234600, cost 2.3456709654312347e+75, no description, no parts and
 * no stage history. Every figure in it is junk from the old free-text form.
 *
 *   node --import tsx scripts/service-record-delete.mjs
 *   CONFIRM_SERVICE_DELETE=yes node --import tsx scripts/service-record-delete.mjs --apply
 *
 * Deletes that one document and nothing else. Refuses any other id.
 */
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { assertProd, loadEnv, loadServiceAccount } from "./perf-env.mjs";

const TARGET_ID = "32b331a9-573c-4016-83a0-a953042df6f5";
const CONFIRM = "CONFIRM_SERVICE_DELETE";

const apply = process.argv.includes("--apply");
const asked = process.argv.find((arg) => arg.startsWith("--id="))?.slice(5);
if (asked && asked !== TARGET_ID) {
  console.error(`Refusing id ${asked}: this script only removes ${TARGET_ID}`);
  process.exit(1);
}
if (apply && process.env[CONFIRM] !== "yes") {
  console.error(`Refusing --apply without ${CONFIRM}=yes`);
  process.exit(1);
}

const account = loadServiceAccount(loadEnv());
assertProd(account);
const app = getApps()[0] ?? initializeApp({ credential: cert(account), projectId: account.projectId });
const db = getFirestore(app, "default");

const ref = db.collection("vehicle_services").doc(TARGET_ID);
const snapshot = await ref.get();

if (!snapshot.exists) {
  console.log(`vehicle_services/${TARGET_ID} is already gone — nothing to do.`);
  process.exit(0);
}

const data = snapshot.data() ?? {};
const vehicleId = data.vehicle_id ?? null;
const vehicle = vehicleId ? await db.collection("vehicles").doc(String(vehicleId)).get() : null;
const subcollections = await ref.listCollections();

console.log(`document   : vehicle_services/${TARGET_ID}`);
console.log(`vehicle_id : ${vehicleId}`);
console.log(`vehicle    : ${vehicle?.exists ? (vehicle.get("reg_number") ?? vehicleId) : "missing"}`);
console.log(`subcolls   : ${subcollections.map((c) => c.id).join(", ") || "none"}`);
console.log("fields     :");
for (const [key, value] of Object.entries(data)) {
  const shown = typeof value === "object" && value !== null ? JSON.stringify(value).slice(0, 90) : String(value);
  console.log(`  ${key} = ${shown}`);
}
if (vehicle?.exists) {
  console.log(
    `vehicle.current_odometer_km = ${String(vehicle.get("current_odometer_km") ?? "—")}`,
  );
}

if (!apply) {
  console.log(`\nDRY RUN — nothing deleted. Re-run with ${CONFIRM}=yes and --apply.`);
  process.exit(0);
}

await ref.delete();
const after = await ref.get();
console.log(`\nDeleted. Still present after delete: ${after.exists}`);
const remaining = await db.collection("vehicle_services").count().get();
console.log(`vehicle_services rows left: ${remaining.data().count}`);
