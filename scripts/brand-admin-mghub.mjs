/**
 * Rename the Admin panel to "MGHub" — admin only.
 *
 *   node scripts/brand-admin-mghub.mjs            # dry run
 *   CONFIRM_BRAND=yes node scripts/brand-admin-mghub.mjs --apply
 *
 * `app_settings.app_name` drives the Admin sidebar header, the launcher header
 * and the document title. The code default already reads "MGHub"
 * (`src/config/site.ts`), but the stored value was still "MGGO", and the stored
 * copy is what the panel renders.
 *
 * Deliberately NOT touched:
 *   - `app_subtitle`      — stays "Delivery Panel".
 *   - `driver_app_title`  — the **rider app's** name. It is restored to
 *                           "Delivery Partner" if a previous run of this family
 *                           of scripts had set it to "MGHub".
 *
 * The write also bumps the `settings` epoch on `auth_epochs/current`, which is
 * what makes every rendered page drop its cached branding row immediately
 * instead of waiting out `EPOCH_CACHE_MAX_TTL_MS` (5 minutes).
 */
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { assertProd, loadEnv, loadServiceAccount } from "./perf-env.mjs";

const ADMIN_NAME = "MGHub";
const RIDER_TITLE = "Delivery Partner";

const apply = process.argv.includes("--apply");
if (apply && process.env.CONFIRM_BRAND !== "yes") {
  console.error("confirm_required: set CONFIRM_BRAND=yes");
  process.exit(2);
}

const account = loadServiceAccount(loadEnv());
assertProd(account);
const app = getApps()[0] ?? initializeApp({ credential: cert(account), projectId: account.projectId });
const db = getFirestore(app, "default");
const settingsRef = db.collection("app_settings").doc("1");
const epochRef = db.collection("auth_epochs").doc("current");

const snap = await settingsRef.get();
if (!snap.exists) {
  console.error("app_settings/1 is missing — aborting");
  process.exit(2);
}

const currentName = snap.get("app_name") ?? null;
const currentDriverTitle = snap.get("driver_app_title") ?? null;
const currentSubtitle = snap.get("app_subtitle") ?? null;
const epochBefore = (await epochRef.get()).get("settings") ?? 0;

console.log(`app_subtitle        ${JSON.stringify(currentSubtitle)} (unchanged)`);
console.log(`app_name            ${JSON.stringify(currentName)} -> ${JSON.stringify(ADMIN_NAME)}`);
console.log(
  `driver_app_title    ${JSON.stringify(currentDriverTitle)}${
    currentDriverTitle === ADMIN_NAME
      ? ` -> ${JSON.stringify(RIDER_TITLE)} (rider app: restore)`
      : " (unchanged — rider app)"
  }`,
);
console.log(`auth_epochs.settings ${JSON.stringify(epochBefore)} -> +1`);

if (!apply) {
  console.log("dry run — pass --apply with CONFIRM_BRAND=yes");
  process.exit(0);
}

const patch = {};
if (currentName !== ADMIN_NAME) patch.app_name = ADMIN_NAME;
if (currentDriverTitle === ADMIN_NAME) patch.driver_app_title = RIDER_TITLE;
if (Object.keys(patch).length > 0) {
  patch.updated_at = new Date().toISOString();
  await settingsRef.set(patch, { merge: true });
}
await epochRef.set({ settings: FieldValue.increment(1) }, { merge: true });

console.log("applied:", Object.keys(patch).join(", ") || "(no field change)", "+ settings epoch");
process.exit(0);
