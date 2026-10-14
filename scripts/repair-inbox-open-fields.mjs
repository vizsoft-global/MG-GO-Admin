/**
 * Sets dismissed_at / opened_at to null on inbox rows that omitted the fields.
 * Firestore `== null` cannot see a missing field, so those rows never listed.
 * Prints counts only.
 */
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { assertProd, loadEnv, loadServiceAccount } from "./perf-env.mjs";

const account = loadServiceAccount(loadEnv());
assertProd(account);
const app = getApps()[0] ?? initializeApp({ credential: cert(account), projectId: account.projectId });
const db = getFirestore(app, "default");

const snap = await db.collection("notification_dispatch_items").select("dismissed_at", "opened_at").get();
let patched = 0;
let already = 0;
const writes = [];
for (const doc of snap.docs) {
  const data = doc.data() ?? {};
  const missingDismissed = !Object.prototype.hasOwnProperty.call(data, "dismissed_at");
  const missingOpened = !Object.prototype.hasOwnProperty.call(data, "opened_at");
  if (!missingDismissed && !missingOpened) {
    already += 1;
    continue;
  }
  const patch = {};
  if (missingDismissed) patch.dismissed_at = null;
  if (missingOpened) patch.opened_at = null;
  writes.push(doc.ref.update(patch));
  patched += 1;
}

for (let index = 0; index < writes.length; index += 200) {
  await Promise.all(writes.slice(index, index + 200));
}

console.log(JSON.stringify({ collection: "notification_dispatch_items", scanned: snap.size, patched, already }));
