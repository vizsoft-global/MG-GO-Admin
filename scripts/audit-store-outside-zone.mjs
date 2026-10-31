/**
 * Read-only audit: riders whose assigned store pin sits outside their own zone
 * polygon. Those riders were reported as "outside your delivery area" while
 * standing at the counter, because the phone used to test the zone polygon only.
 *
 *   node scripts/audit-store-outside-zone.mjs [--partner americana] [--limit 40]
 *
 * Never writes. Exits 0.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv() {
  const text = readFileSync(resolve(root, ".env.local"), "utf8");
  const env = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index < 0) continue;
    let value = trimmed.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[trimmed.slice(0, index).trim()] = value;
  }
  return env;
}

function serviceAccount(env) {
  const raw = env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON missing");
  let parsed = JSON.parse(raw);
  if (!parsed.project_id) parsed = JSON.parse(raw.replace(/\\"/g, '"').replace(/\\\\n/g, "\\n"));
  return {
    projectId: parsed.project_id,
    clientEmail: parsed.client_email,
    privateKey: parsed.private_key.replace(/\\n/g, "\n"),
  };
}

function ringOf(geometry) {
  const g = geometry?.geometry ?? geometry;
  if (!g) return null;
  if (g.type === "Feature") return ringOf(g.geometry);
  if (g.type === "Polygon") return g.coordinates?.[0] ?? null;
  if (g.type === "MultiPolygon") return g.coordinates?.[0]?.[0] ?? null;
  return null;
}

function circleOf(geometry) {
  const g = geometry?.geometry ?? geometry;
  if (!g) return null;
  if (g.type === "Feature") return circleOf(g.geometry);
  if (g.type === "Point") {
    const [lng, lat] = g.coordinates ?? [];
    const radius = Number(geometry?.properties?.radiusMeters ?? geometry?.properties?.radius ?? 0);
    return Number.isFinite(lat) && Number.isFinite(lng) && radius > 0 ? { lat, lng, radius } : null;
  }
  return null;
}

function insideRing(lat, lng, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function metersBetween(aLat, aLng, bLat, bLng) {
  const R = 6371008.8;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Distance from the point to the nearest ring edge, projected locally. */
function metersToRing(lat, lng, ring) {
  if (!ring?.length) return null;
  const cos = Math.cos((lat * Math.PI) / 180);
  const toXY = (pLat, pLng) => [
    (pLng - lng) * cos * 111320,
    (pLat - lat) * 110540,
  ];
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = toXY(ring[j][1], ring[j][0]);
    const [bx, by] = toXY(ring[i][1], ring[i][0]);
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 === 0 ? 0 : -(ax * dx + ay * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return Number.isFinite(best) ? Math.round(best) : null;
}

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const env = loadEnv();
const account = serviceAccount(env);
if (account.projectId !== "musallam-delivery-prod") {
  throw new Error(`refusing project ${account.projectId}`);
}
initializeApp({ credential: cert(account), projectId: account.projectId });
const db = getFirestore(undefined, "default");

const partnerFilter = (arg("partner") ?? "").toLowerCase();
const limit = Number(arg("limit", "40"));

const [driversSnap, zonesSnap] = await Promise.all([
  db.collection("drivers").get(),
  db.collection("zones").get(),
]);

const zoneById = new Map();
for (const doc of zonesSnap.docs) {
  const data = doc.data() ?? {};
  zoneById.set(doc.id, { name: data.name ?? doc.id, geometry: data.geometry });
}

const restaurants = new Map();
const edges = await db.collection("driver_restaurants").get();
const restaurantIds = new Set();
for (const doc of edges.docs) {
  const data = doc.data() ?? {};
  if (data.restaurant_id) restaurantIds.add(data.restaurant_id);
}
for (const id of restaurantIds) {
  const snap = await db.collection("restaurants").doc(id).get();
  if (snap.exists) restaurants.set(id, { id, ...(snap.data() ?? {}) });
}

const edgesByDriver = new Map();
for (const doc of edges.docs) {
  const data = doc.data() ?? {};
  const driverId = data.driver_id ?? doc.id.split("_")[0];
  if (!edgesByDriver.has(driverId)) edgesByDriver.set(driverId, []);
  edgesByDriver.get(driverId).push(data.restaurant_id);
}

let checked = 0;
let noZone = 0;
let noStore = 0;
let outCount = 0;
const rows = [];

for (const doc of driversSnap.docs) {
  const d = doc.data() ?? {};
  if (d.archived_at) continue;
  const partner = String(d.partner_id ?? "");
  if (partnerFilter && !partner.toLowerCase().includes(partnerFilter)) continue;
  const zoneId = String(d.zone_id ?? "");
  if (!zoneId) {
    noZone += 1;
    continue;
  }
  const zone = zoneById.get(zoneId);
  if (!zone) continue;
  const ids = edgesByDriver.get(doc.id) ?? [];
  const pins = ids
    .map((id) => restaurants.get(id))
    .filter((r) => r && r.published !== false)
    .map((r) => ({ id: r.id, name: r.name ?? r.id, lat: Number(r.latitude), lng: Number(r.longitude) }))
    .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng));
  if (pins.length === 0) {
    noStore += 1;
    continue;
  }
  const ring = ringOf(zone.geometry);
  const circle = circleOf(zone.geometry);
  if (!ring && !circle) continue;
  checked += 1;

  const outside = pins.filter((pin) => {
    if (ring) return !insideRing(pin.lat, pin.lng, ring);
    return metersBetween(pin.lat, pin.lng, circle.lat, circle.lng) > circle.radius;
  });
  if (outside.length === 0) continue;
  outCount += 1;
  if (rows.length < limit) {
    const nearest = outside
      .map((pin) => ({
        name: pin.name,
        meters: ring
          ? metersToRing(pin.lat, pin.lng, ring)
          : Math.round(
              metersBetween(pin.lat, pin.lng, circle.lat, circle.lng) - circle.radius,
            ),
      }))
      .sort((a, b) => (a.meters ?? Infinity) - (b.meters ?? Infinity))[0];
    rows.push({
      id: doc.id,
      name: d.full_name ?? d.employee_id ?? doc.id,
      employeeId: d.employee_id ?? null,
      zone: zone.name,
      stores: outside.map((pin) => pin.name).join(" | "),
      nearestMeters: nearest?.meters ?? null,
      onDuty: d.is_on_duty === true,
    });
  }
}

console.log(
  JSON.stringify(
    {
      project: account.projectId,
      driversChecked: checked,
      ridersWithStoreOutsideZone: outCount,
      ridersWithoutZone: noZone,
      ridersWithoutStorePin: noStore,
      sample: rows,
    },
    null,
    2,
  ),
);
