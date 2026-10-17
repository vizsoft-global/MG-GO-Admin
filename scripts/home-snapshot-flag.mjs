/**
 * Flip the server Home snapshot (`driver_home_daily`) flags on `app_settings/1`.
 *
 *   node scripts/home-snapshot-flag.mjs                         # dry-run, prints current flags
 *   node scripts/home-snapshot-flag.mjs --enable --shadow --apply
 *   node scripts/home-snapshot-flag.mjs --enable --apply        # after the shadow week
 *   node scripts/home-snapshot-flag.mjs --disable --apply       # rollback
 *
 * `auth_epochs/current.config` is bumped with the write so every function
 * isolate drops its cached flags now instead of after the 5-minute TTL.
 */
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { assertProd, loadEnv, loadServiceAccount } from "./perf-env.mjs";

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const enable = args.has("--enable");
const disable = args.has("--disable");
if (enable && disable) throw new Error("pick one of --enable / --disable");

const account = loadServiceAccount(loadEnv());
assertProd(account);
const app = getApps()[0] ?? initializeApp({ credential: cert(account), projectId: account.projectId });
const db = getFirestore(app, "default");

const ref = db.collection("app_settings").doc("1");
const before = (await ref.get()).data() ?? {};
console.log("before", {
  home_snapshot_enabled: before.home_snapshot_enabled ?? null,
  home_snapshot_shadow: before.home_snapshot_shadow ?? null,
});

if (!enable && !disable) process.exit(0);

const patch = enable
  ? { home_snapshot_enabled: true, home_snapshot_shadow: args.has("--shadow") }
  : { home_snapshot_enabled: false, home_snapshot_shadow: false };
console.log(apply ? "writing" : "dry-run, would write", patch);
if (!apply) process.exit(0);

await ref.set(patch, { merge: true });
await db
  .collection("auth_epochs")
  .doc("current")
  .set({ config: FieldValue.increment(1) }, { merge: true });
const after = (await ref.get()).data() ?? {};
console.log("after", {
  home_snapshot_enabled: after.home_snapshot_enabled ?? null,
  home_snapshot_shadow: after.home_snapshot_shadow ?? null,
});
