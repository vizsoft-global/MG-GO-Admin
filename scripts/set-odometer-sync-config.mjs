/**
 * Write the dashcam sync config.
 *
 * The secret is already in Secret Manager (`SERVICE_ODOMETER_APP_SECRET`); this
 * document holds only the non-sensitive half — the host, the AppCid, and which
 * field of the reply is the odometer.
 *
 * `enabled: false` on purpose. The scheduled run is four times a day and the
 * vendor's host has not answered a successful login from this network yet, so
 * enabling it now would only fill the run log with 401s. The operator flips it
 * on in the panel once **Test connection** shows a real row.
 *
 *   node scripts/set-odometer-sync-config.mjs            (dry run)
 *   CONFIRM_ODOMETER_CONFIG=yes node scripts/set-odometer-sync-config.mjs --apply
 */
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { assertProd, loadEnv, loadServiceAccount } from "./perf-env.mjs";

const DOC = "service_odometer_sync/current";

const CONFIG = {
  enabled: false,
  base_url: "https://api.vssgpsmea.live/vehicle-admin",
  auth_mode: "headers",
  app_cid: "5531229d354e42febb258f34b2825302",
  vehicles_path: "/vehicle/list",
  odometer_field: "mileage",
  plate_field: "licenseNum",
  chassis_field: "vin",
};

const apply = process.argv.includes("--apply");
const account = loadServiceAccount(loadEnv());
assertProd(account);
const app = getApps()[0] ?? initializeApp({ credential: cert(account), projectId: account.projectId });
const db = getFirestore(app, "default");

const snap = await db.doc(DOC).get();
console.log(`${DOC} exists: ${snap.exists}`);
console.log("before:", JSON.stringify(snap.data() ?? {}, null, 1));
console.log("after :", JSON.stringify(CONFIG, null, 1));

if (!apply) {
  console.log("\nDry run. Re-run with CONFIRM_ODOMETER_CONFIG=yes and --apply to write.");
  process.exit(0);
}
if (process.env.CONFIRM_ODOMETER_CONFIG !== "yes") {
  console.error("\nRefusing to write without CONFIRM_ODOMETER_CONFIG=yes");
  process.exit(1);
}

await db.doc(DOC).set({ ...CONFIG, updated_at: new Date() }, { merge: true });
console.log("\nwritten");
