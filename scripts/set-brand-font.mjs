/**
 * Point the Admin panel at the local brand font stack — admin only.
 *
 *   node scripts/set-brand-font.mjs            # dry run
 *   CONFIRM_BRAND=yes node scripts/set-brand-font.mjs --apply
 *
 * `app_settings/1.font_family` is what `HtmlLocaleAttributes` renders as
 * `data-font=<id>`. The code default is already `gotham`
 * (`DEFAULT_APP_SETTINGS`), but a stored `inter` value would win, and the
 * `html[data-font="inter"]` rule is gone — so the stored row is updated here to
 * make the written attribute match the brand stack.
 *
 * The write also bumps the `settings` epoch on `auth_epochs/current`, so every
 * rendered page drops its cached branding row immediately instead of waiting
 * out `EPOCH_CACHE_MAX_TTL_MS` (5 minutes).
 */
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { assertProd, loadEnv, loadServiceAccount } from "./perf-env.mjs";

const BRAND_FONT = "gotham";

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

const currentFont = snap.get("font_family") ?? null;
const epochBefore = (await epochRef.get()).get("settings") ?? 0;

console.log(`font_family          ${JSON.stringify(currentFont)} -> ${JSON.stringify(BRAND_FONT)}`);
console.log(`auth_epochs.settings ${JSON.stringify(epochBefore)} -> +1`);

if (!apply) {
  console.log("dry run — pass --apply with CONFIRM_BRAND=yes");
  process.exit(0);
}

if (currentFont === BRAND_FONT) {
  console.log("already on the brand font — nothing to write");
  process.exit(0);
}

await settingsRef.set({ font_family: BRAND_FONT, updated_at: new Date() }, { merge: true });
await epochRef.set({ settings: Number(epochBefore) + 1 }, { merge: true });
console.log(`wrote app_settings/1.font_family=${BRAND_FONT} and bumped the settings epoch`);
