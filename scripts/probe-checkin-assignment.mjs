/**
 * Read-only probe: why does driverCheckInContext return candidates: 0?
 * Prints restaurant publish state, driver partner, and junction rows.
 *
 *   node scripts/probe-checkin-assignment.mjs [employee_id_or_name]
 */
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { assertProd, loadEnv, loadServiceAccount } from "./perf-env.mjs";

const account = loadServiceAccount(loadEnv());
assertProd(account);
const app = getApps()[0] ?? initializeApp({ credential: cert(account), projectId: account.projectId });
const db = getFirestore(app, "default");

const needle = (process.argv[2] ?? "10904").toLowerCase();

const drivers = await db.collection("drivers").get();
const hits = [];
for (const doc of drivers.docs) {
  const data = doc.data() ?? {};
  const hay = [data.employee_id, data.full_name, data.name, data.phone, data.driver_code]
    .filter((v) => typeof v === "string")
    .join(" | ")
    .toLowerCase();
  if (hay.includes(needle)) hits.push({ id: doc.id, data });
}

console.log(`drivers matched: ${hits.length}`);
for (const { id, data } of hits) {
  console.log(`\n#### driver ${id}`);
  const keep = [
    "employee_id", "driver_code", "full_name", "name", "phone", "status", "is_blocked",
    "archived_at", "partner_id", "zone_id", "restaurant_id", "restaurant_ids", "is_on_duty",
  ];
  for (const key of keep) if (data[key] !== undefined) console.log(`  d.${key}: ${JSON.stringify(data[key])}`);

  const junction = await db.collection("driver_restaurants").where("driver_id", "==", id).get();
  const ids = new Set();
  const single = data.restaurant_id;
  if (typeof single === "string" && single) ids.add(single);
  if (Array.isArray(data.restaurant_ids)) for (const r of data.restaurant_ids) if (typeof r === "string" && r) ids.add(r);
  for (const doc of junction.docs) {
    const rid = doc.data()?.restaurant_id;
    console.log(`  junction ${doc.id}: ${rid}`);
    if (typeof rid === "string" && rid) ids.add(rid);
  }
  if (ids.size === 0) {
    console.log("  >>> NO restaurant ids at all (candidates = 0)");
    continue;
  }

  for (const rid of ids) {
    const snap = await db.collection("restaurants").doc(rid).get();
    if (!snap.exists) {
      console.log(`  restaurant ${rid}: MISSING`);
      continue;
    }
    const r = snap.data() ?? {};
    const fences = await db.collection("restaurant_geofences").where("restaurant_id", "==", rid).get();
    const verdict = [];
    if (!(r.status === "published" && r.is_active === true)) verdict.push("NOT published+active");
    const owner = typeof r.partner_id === "string" ? r.partner_id.trim() : "";
    if (typeof data.partner_id === "string" && data.partner_id && owner !== "" && owner !== data.partner_id) {
      verdict.push(`partner mismatch (driver=${data.partner_id} restaurant=${owner})`);
    }
    console.log(
      `  restaurant ${rid}: name=${JSON.stringify(r.name)} status=${r.status} is_active=${r.is_active} partner_id=${r.partner_id ?? "null"} lat=${r.latitude ?? "null"} lng=${r.longitude ?? "null"} geofences=${fences.size}`,
    );
    console.log(`    -> ${verdict.length === 0 ? "ELIGIBLE" : verdict.join("; ")}`);
  }
}

const restaurants = await db.collection("restaurants").get();
console.log("\n#### restaurants snapshot (name/status/active/partner)");
for (const doc of restaurants.docs) {
  const r = doc.data() ?? {};
  console.log(
    `  ${doc.id} name=${JSON.stringify(r.name)} status=${r.status} is_active=${r.is_active} partner=${r.partner_id ?? "null"} geofence_pin=${r.latitude ?? "-"},${r.longitude ?? "-"}`,
  );
}
process.exit(0);
