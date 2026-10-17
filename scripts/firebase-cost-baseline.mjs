/**
 * Read-only baseline for the Firebase cost plan.
 *
 *   node scripts/firebase-cost-baseline.mjs
 *
 * Reports the refresh/GPS flags on `app_settings/1`, the rider app version
 * spread (old builds keep polling Home), and the size of the location
 * collections. Count aggregates bill 1 read per 1000 index entries, so the
 * whole run costs a few tens of thousands of reads.
 */
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { assertProd, loadEnv, loadServiceAccount } from "./perf-env.mjs";

const FLAGS = [
  "home_poll_enabled",
  "home_snapshot_enabled",
  "rider_signal_mode",
  "rider_fallback_refresh_minutes",
  "gps_sink",
  "gps_r2_rollout_percent",
  "location_gps_r2_since",
  "driver_app_min_version_code",
  "driver_app_force_update",
  "config_epoch",
];

const account = loadServiceAccount(loadEnv());
assertProd(account);
const app = getApps()[0] ?? initializeApp({ credential: cert(account), projectId: account.projectId });
const db = getFirestore(app, "default");

const settings = (await db.collection("app_settings").doc("1").get()).data() ?? {};
console.log("app_settings/1");
for (const key of FLAGS) console.log(`  ${key.padEnd(32)} ${JSON.stringify(settings[key] ?? null)}`);

const drivers = await db
  .collection("drivers")
  .select("current_app_version_code", "app_version_code", "is_on_duty", "archived_at")
  .get();
const byVersion = new Map();
let onDuty = 0;
for (const doc of drivers.docs) {
  const d = doc.data();
  if (d.archived_at) continue;
  if (d.is_on_duty === true) onDuty += 1;
  const v = d.current_app_version_code ?? d.app_version_code ?? "unknown";
  byVersion.set(v, (byVersion.get(v) ?? 0) + 1);
}
console.log(`\ndrivers (live) ${[...byVersion.values()].reduce((a, b) => a + b, 0)}, on duty now ${onDuty}`);
for (const [v, n] of [...byVersion.entries()].sort((a, b) => String(b[0]).localeCompare(String(a[0])))) {
  console.log(`  version ${String(v).padEnd(10)} ${n}`);
}

for (const name of [
  "driver_locations",
  "driver_location_events",
  "driver_home_daily",
  "rider_signals",
  "rider_day_stats",
  "driver_operation_events",
  "driver_telemetry_events",
]) {
  const count = (await db.collection(name).count().get()).data().count;
  console.log(`  ${name.padEnd(28)} ${count}`);
}
process.exit(0);
