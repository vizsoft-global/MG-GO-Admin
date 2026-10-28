/**
 * Read-only audit: Keeta riders who cannot clock in because the zone gate has
 * no zone to test (`check_in_zone_unassigned`).
 *
 *   node scripts/audit-keeta-zone-gate.mjs
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

const env = loadEnv();
const account = serviceAccount(env);
if (account.projectId !== "musallam-delivery-prod") {
  throw new Error(`refusing project ${account.projectId}`);
}
initializeApp({ credential: cert(account), projectId: account.projectId });
const db = getFirestore(undefined, "default");

const [driversSnap, partnersSnap] = await Promise.all([
  db.collection("drivers").get(),
  db.collection("partners").get(),
]);

const keetaPartnerIds = new Set();
for (const doc of partnersSnap.docs) {
  const data = doc.data() ?? {};
  const key = String(data.key ?? "").toLowerCase();
  const name = String(data.name ?? "").toLowerCase();
  if (key.includes("keeta") || name.includes("keeta")) keetaPartnerIds.add(doc.id);
}

const keeta = [];
for (const doc of driversSnap.docs) {
  const d = doc.data() ?? {};
  if (d.archived_at) continue;
  const project = String(d.project_key ?? "").toLowerCase();
  const partner = String(d.partner_id ?? "");
  if (project !== "keeta" && !keetaPartnerIds.has(partner)) continue;
  keeta.push({
    id: doc.id,
    name: d.full_name ?? d.employee_id ?? doc.id,
    zoneId: d.zone_id ?? null,
    isOnDuty: d.is_on_duty === true,
  });
}

const noZone = keeta.filter((row) => !row.zoneId);
console.log(
  JSON.stringify(
    {
      project: account.projectId,
      keetaRiders: keeta.length,
      keetaWithoutZone: noZone.length,
      onDutyWithoutZone: noZone.filter((row) => row.isOnDuty).length,
      sample: noZone.slice(0, 20),
    },
    null,
    2,
  ),
);
