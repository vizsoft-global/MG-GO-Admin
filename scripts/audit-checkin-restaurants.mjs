/**
 * Read-only audit: assigned restaurants that cannot pass the clock-in gate
 * because they carry no pin (or a 0,0 pin) and no inclusion geofence.
 *
 *   node scripts/audit-checkin-restaurants.mjs [--limit 40]
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
const limit = Number(arg("limit", "40"));

const edges = await db.collection("driver_restaurants").get();
const assignedCount = new Map();
for (const doc of edges.docs) {
  const data = doc.data() ?? {};
  const id = data.restaurant_id;
  if (!id) continue;
  assignedCount.set(id, (assignedCount.get(id) ?? 0) + 1);
}

const ids = [...assignedCount.keys()];
const unusable = [];
for (let i = 0; i < ids.length; i += 200) {
  const chunk = ids.slice(i, i + 200);
  const snaps = await db.getAll(
    ...chunk.map((id) => db.collection("restaurants").doc(id)),
  );
  for (const snap of snaps) {
    if (!snap.exists) continue;
    const data = snap.data() ?? {};
    const lat = Number(data.latitude);
    const lng = Number(data.longitude);
    const hasPin =
      Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);
    const fences = await db
      .collection("restaurant_geofences")
      .where("restaurant_id", "==", snap.id)
      .get();
    const inclusions = fences.docs.filter(
      (fence) => (fence.data() ?? {}).kind === "inclusion",
    );
    if (hasPin || inclusions.length > 0) continue;
    unusable.push({
      restaurantId: snap.id,
      name: data.name ?? snap.id,
      partner: data.partner_id ?? null,
      published: data.published !== false,
      riders: assignedCount.get(snap.id) ?? 0,
      latitude: Number.isFinite(lat) ? lat : null,
      longitude: Number.isFinite(lng) ? lng : null,
    });
  }
}

unusable.sort((a, b) => b.riders - a.riders);

console.log(
  JSON.stringify(
    {
      project: account.projectId,
      assignedRestaurants: assignedCount.size,
      assignedButUnmatchable: unusable.length,
      ridersAffected: unusable.reduce((sum, row) => sum + row.riders, 0),
      sample: unusable.slice(0, limit),
    },
    null,
    2,
  ),
);
