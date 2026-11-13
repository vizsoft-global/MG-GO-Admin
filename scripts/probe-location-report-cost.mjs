/**
 * Read-only probe: what does one `driverReportLocation` call cost in read units?
 *
 * The database is Enterprise edition, which bills a read by the size of what is
 * read, in 4 KiB steps: a 40 KiB zone polygon costs ten units, not one. This
 * measures the documents a location report reads and prints their size in
 * units, so the expensive ones can be named instead of guessed.
 *
 *   node scripts/probe-location-report-cost.mjs
 *
 * Writes nothing. Reads `zones` (all), `app_settings/1`, and a sample of
 * `drivers`, `profiles`, `driver_locations`, `restaurants`,
 * `restaurant_geofences` and `driver_restaurants`. Sizes are the JSON length of
 * each document, which is close to, not exactly, the stored size.
 */
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { assertProd, loadEnv, loadServiceAccount } from "./perf-env.mjs";

const account = loadServiceAccount(loadEnv());
assertProd(account);
const app = getApps()[0] ?? initializeApp({ credential: cert(account), projectId: account.projectId });
const db = getFirestore(app, "default");

const UNIT = 4096;
const SAMPLE = 40;

function sizeOf(doc) {
  return Buffer.byteLength(JSON.stringify(doc.data() ?? {}), "utf8") + doc.ref.path.length;
}

function summary(name, docs) {
  if (docs.length === 0) {
    console.log(`${name.padEnd(24)} no documents`);
    return { units: 0, count: 0 };
  }
  const sizes = docs.map(sizeOf).sort((a, b) => a - b);
  const units = sizes.map((size) => Math.max(1, Math.ceil(size / UNIT)));
  const total = units.reduce((sum, value) => sum + value, 0);
  const kib = (bytes) => `${(bytes / 1024).toFixed(1)} KiB`;
  console.log(
    `${name.padEnd(24)} n=${String(docs.length).padStart(4)}  median ${kib(sizes[Math.floor(sizes.length / 2)]).padStart(10)}  largest ${kib(sizes[sizes.length - 1]).padStart(10)}  units each: avg ${(total / docs.length).toFixed(1)}, max ${Math.max(...units)}`,
  );
  return { units: total / docs.length, count: docs.length };
}

const [zones, settings, drivers, profiles, locations, restaurants, fences, links] = await Promise.all([
  db.collection("zones").get(),
  db.collection("app_settings").doc("1").get(),
  db.collection("drivers").where("is_on_duty", "==", true).limit(SAMPLE).get(),
  db.collection("profiles").limit(SAMPLE).get(),
  db.collection("driver_locations").limit(SAMPLE).get(),
  db.collection("restaurants").limit(SAMPLE).get(),
  db.collection("restaurant_geofences").limit(SAMPLE).get(),
  db.collection("driver_restaurants").limit(400).get(),
]);

console.log("Document sizes (one read unit = 4 KiB)\n");
const zone = summary("zones", zones.docs);
const setting = summary("app_settings/1", [settings]);
const driver = summary("drivers (on duty)", drivers.docs);
const profile = summary("profiles", profiles.docs);
const location = summary("driver_locations", locations.docs);
const restaurant = summary("restaurants", restaurants.docs);
const fence = summary("restaurant_geofences", fences.docs);

// How many restaurants a rider is tied to, from the junction sample.
const perDriver = new Map();
for (const doc of links.docs) {
  const id = doc.data().driver_id;
  perDriver.set(id, (perDriver.get(id) ?? 0) + 1);
}
const linkCounts = [...perDriver.values()];
const avgLinks = linkCounts.length ? linkCounts.reduce((sum, value) => sum + value, 0) / linkCounts.length : 0;
console.log(`\nRestaurants per rider in the junction sample: avg ${avgLinks.toFixed(1)}, max ${Math.max(0, ...linkCounts)}`);

// Zone sizes by the riders on duty that point at them: the size a report actually reads.
const zoneUnits = new Map(zones.docs.map((doc) => [doc.id, Math.max(1, Math.ceil(sizeOf(doc) / UNIT))]));
const onDutyZone = drivers.docs.map((doc) => zoneUnits.get(doc.data().zone_id) ?? 0);
const avgZone = onDutyZone.length ? onDutyZone.reduce((sum, value) => sum + value, 0) / onDutyZone.length : zone.units;
console.log(`Zone read by an on-duty rider in the sample: avg ${avgZone.toFixed(1)} units`);

const links1 = Math.max(1, avgLinks);
const always = driver.units + profile.units + location.units + setting.units;
const full = always + avgZone + links1 * (restaurant.units + fence.units + 1) + 1;
console.log("\nEstimated units per report (before any caching)");
console.log(`  every report (rider, profile, pin, settings):        ${always.toFixed(1)}`);
console.log(`  a report that is not coalesced adds zone, restaurants,`);
console.log(`  geofences, the assignment query and the last history: ${(full - always).toFixed(1)}`);
console.log(`  total for a full report:                              ${full.toFixed(1)}`);
