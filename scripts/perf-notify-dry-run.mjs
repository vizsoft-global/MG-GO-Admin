/**
 * Times audience resolution and active-token lookup. Read-only.
 * Writes and FCM throw. Prints counts and milliseconds only.
 */
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { assertProd, loadEnv, loadServiceAccount } from "./perf-env.mjs";
import { readOnlyDb } from "./perf-readonly-db.mjs";

const account = loadServiceAccount(loadEnv());
assertProd(account);
const app = getApps()[0] ?? initializeApp({ credential: cert(account), projectId: account.projectId });
const db = readOnlyDb(getFirestore(app, "default"));

const audienceStarted = Date.now();
const drivers = await db.collection("drivers").where("archived_at", "==", null).select("is_blocked").get();
const liveIds = [];
for (const doc of drivers.docs) {
  if (doc.data()?.is_blocked === true) continue;
  liveIds.push(doc.id);
}
const audienceMs = Date.now() - audienceStarted;

const allowed = new Set(liveIds);
const tokenStarted = Date.now();
const tokens = await db
  .collection("driver_push_tokens")
  .where("is_active", "==", true)
  .select("driver_id")
  .get();
let tokenCount = 0;
for (const doc of tokens.docs) {
  const driverId = doc.data()?.driver_id;
  if (typeof driverId === "string" && allowed.has(driverId)) tokenCount += 1;
}
const tokenMs = Date.now() - tokenStarted;

console.log(
  JSON.stringify({
    perf: "notify_dry_run",
    audienceMs,
    tokenMs,
    audienceCount: liveIds.length,
    tokenCount,
    fcm: "not_called",
    writes: "not_called",
  }),
);
