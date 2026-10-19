/**
 * Lists the riders a GPS rollout percentage covers, using the same FNV-1a hash as
 * `inGpsRollout` in `infra/workers/dpd-live/src/gps-archive.ts`.
 *
 *   node scripts/gps-probe-riders.mjs --percent 1
 *   node scripts/gps-probe-riders.mjs --percent 1 --duty-only
 *
 * Read-only. Useful before a probe deploy: it names the riders whose history will
 * land in R2 instead of `driver_location_events`.
 */
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import { assertProd, loadEnv, loadServiceAccount } from "./perf-env.mjs";

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const percent = Number(arg("percent") ?? "1");
if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
  console.error("--percent must be a number between 0 and 100");
  process.exit(1);
}
const dutyOnly = process.argv.includes("--duty-only");

/** FNV-1a over UTF-16 code units, byte-compatible with the Worker's rolloutBucket. */
function rolloutBucket(driverId) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < driverId.length; i += 1) {
    hash ^= driverId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % 100;
}

const account = loadServiceAccount(loadEnv());
assertProd(account);
const app = getApps()[0] ?? initializeApp({ credential: cert(account), projectId: account.projectId });
const db = getFirestore(app, "default");

const snap = await db.collection("drivers").get();
const rows = snap.docs
  .map((doc) => ({
    id: doc.id,
    bucket: rolloutBucket(doc.id),
    code: doc.get("driver_code") ?? null,
    onDuty: doc.get("is_on_duty") === true,
  }))
  .filter((row) => row.bucket < percent)
  .filter((row) => !dutyOnly || row.onDuty)
  .sort((a, b) => a.bucket - b.bucket || a.id.localeCompare(b.id));

console.log(`rollout ${percent}%: ${rows.length} of ${snap.size} drivers${dutyOnly ? " (on duty)" : ""}`);
console.log("bucket  on_duty  driver_code        driver_id");
for (const row of rows) {
  console.log(
    `${String(row.bucket).padStart(6)}  ${row.onDuty ? "yes" : "no "}      ${String(row.code ?? "—").padEnd(18)}${row.id}`,
  );
}
process.exit(0);
