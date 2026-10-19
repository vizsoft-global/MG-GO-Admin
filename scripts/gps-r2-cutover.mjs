/**
 * Stamps `app_settings/1.location_gps_r2_since` — the first Kuwait day whose GPS
 * history lives in R2 rather than `driver_location_events`.
 *
 *   node scripts/gps-r2-cutover.mjs --day 2026-10-24            # dry run
 *   CONFIRM_GPS_CUTOVER=yes node scripts/gps-r2-cutover.mjs --day 2026-10-24 --apply
 *
 * Run it only after the cutover-day export is complete and
 * `scripts/gps-dual-write-compare.mjs` is clean for all riders. Stamp this
 * before setting GPS_DUAL_WRITE=0 so readers switch while the Worker still has
 * the Firestore copy; from that day on, history readers go to the FleetRoom
 * archive first.
 */
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { assertProd, loadEnv, loadServiceAccount } from "./perf-env.mjs";

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const day = arg("day");
if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
  console.error("--day YYYY-MM-DD is required");
  process.exit(1);
}
const apply = process.argv.includes("--apply");

const account = loadServiceAccount(loadEnv());
assertProd(account);
const app = getApps()[0] ?? initializeApp({ credential: cert(account), projectId: account.projectId });
const db = getFirestore(app, "default");
const ref = db.collection("app_settings").doc("1");

const current = (await ref.get()).data()?.location_gps_r2_since ?? null;
console.log(`location_gps_r2_since: ${JSON.stringify(current)} -> ${JSON.stringify(day)}`);

if (!apply) {
  console.log("Dry run. Pass --apply with CONFIRM_GPS_CUTOVER=yes to write.");
  process.exit(0);
}
if (process.env.CONFIRM_GPS_CUTOVER !== "yes") {
  console.error("Refusing to write without CONFIRM_GPS_CUTOVER=yes");
  process.exit(1);
}
await ref.set({ location_gps_r2_since: day, updated_at: Timestamp.now() }, { merge: true });
console.log("Written.");
process.exit(0);
