#!/usr/bin/env node
/** Count finished Plan 3 collections. Prints names and counts only. */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const expected = {
  deliveries: 229533,
  storage_uploads: 130130,
  driver_sessions: 37058,
  drivers: 891,
  profiles: 910,
  attendance_logs: 16009,
  esign_requests: 21,
  driver_location_events: 23349142,
  driver_attendance: 16009,
  driver_change_events: 2132,
  driver_daily_shifts: 14434,
  driver_push_tokens: 1272,
  notification_campaigns: 2426,
  notification_dispatch_items: 2864,
  notification_dispatch_runs: 2423,
  notification_events: 2582,
  order_recon_rows: 6675,
};

const only = process.argv.slice(2);

function loadEnv() {
  const env = {};
  for (const line of readFileSync(resolve(root, ".env.local"), "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    let val = t.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[t.slice(0, i).trim()] = val;
  }
  return env;
}

function loadServiceAccount(env) {
  const raw = env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  let parsed = JSON.parse(raw);
  if (!parsed.project_id) {
    parsed = JSON.parse(raw.replace(/\\"/g, '"').replace(/\\\\n/g, "\\n"));
  }
  return {
    projectId: parsed.project_id,
    clientEmail: parsed.client_email,
    privateKey: parsed.private_key.replace(/\\n/g, "\n"),
  };
}

const account = loadServiceAccount(loadEnv());
if (account.projectId !== "musallam-delivery-prod") {
  console.error("refusing");
  process.exit(1);
}
const app = getApps()[0] ?? initializeApp({ credential: cert(account), projectId: account.projectId });
const db = getFirestore(app, "default");
let mismatches = 0;
const names = only.length ? only : Object.keys(expected);
for (const name of names) {
  const want = expected[name];
  const snap = await db.collection(name).count().get();
  const got = snap.data().count;
  const ok = got === want;
  if (!ok) mismatches += 1;
  console.log(`${ok ? "ok" : "DIFF"} ${name} firestore=${got} export=${want}`);
}
console.log(`verify_done mismatches=${mismatches}`);
process.exit(mismatches ? 2 : 0);
