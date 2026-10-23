import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { loadEnv, loadServiceAccount, assertProd } from "./perf-env.mjs";

const env = loadEnv();
const account = loadServiceAccount(env);
assertProd(account);
const app = getApps()[0] ?? initializeApp({ credential: cert(account), projectId: account.projectId });
const db = getFirestore(app, "default");

const codes = [
  "EMP13123", "40028", "112233", "1961", "20012", "1640", "40022", "9003", "114477", "Em26",
];

const snap = await db.collection("drivers").limit(400).get();
const rows = [];
for (const doc of snap.docs) {
  const d = doc.data();
  const code = d.driver_code ?? d.employee_id ?? doc.id;
  const edges = await db.collection("driver_restaurants").where("driver_id", "==", doc.id).limit(10).get();
  rows.push({
    code,
    name: d.driver_name ?? "",
    project_key: d.project_key ?? null,
    partner_name: d.partner_name ?? null,
    partner_id: d.partner_id ?? null,
    zone_id: d.zone_id ?? null,
    edges: edges.size,
    has_intake_restaurant: Boolean(d.restaurant_id),
  });
}

const byProject = new Map();
for (const r of rows) {
  const k = String(r.project_key);
  byProject.set(k, (byProject.get(k) ?? 0) + 1);
}
console.log("project_key histogram:", Object.fromEntries(byProject));
console.log("rows with 0 edges by project:", rows.filter((r) => r.edges === 0).reduce((acc, r) => {
  const k = String(r.project_key);
  acc[k] = (acc[k] ?? 0) + 1;
  return acc;
}, {}));
console.log("sample no-edge rows:", rows.filter((r) => r.edges === 0).slice(0, 12));
console.log("screenshot codes:", rows.filter((r) => codes.includes(String(r.code))).slice(0, 12));
