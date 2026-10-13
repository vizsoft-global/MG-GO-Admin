import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = fileURLToPath(new URL("./perf-backfill.mjs", import.meta.url));
const functionsDir = path.join(root, "functions");

function allowEnv(extra) {
  const keep = [
    "PATH",
    "Path",
    "PATHEXT",
    "SystemRoot",
    "windir",
    "SystemDrive",
    "TEMP",
    "TMP",
    "USERPROFILE",
    "HOMEDRIVE",
    "HOMEPATH",
    "APPDATA",
    "LOCALAPPDATA",
    "COMSPEC",
    "PROGRAMFILES",
  ];
  const env = {};
  for (const key of keep) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return { ...env, ...extra };
}

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error("emulator_host_required");
  process.exit(2);
}

const { initializeApp } = await import("firebase-admin/app");
const { getFirestore } = await import("firebase-admin/firestore");
const { syntheticComparisonFixture } = await import("../functions/src/core/backfill-plan.ts");
const fixture = syntheticComparisonFixture();
const sample = fixture.deliveries[0];
assert.ok(sample);
const app = initializeApp({ projectId: "demo-backfill" });
const db = getFirestore(app);
await db.doc(`deliveries/${sample.id}`).set({
  status: "verified",
  external_order_id: "ORD-42",
  note: "keep",
});

const runApply = () => spawnSync(process.execPath, ["--import", "tsx", script, "--fixtures", "--apply"], {
  cwd: functionsDir,
  encoding: "utf8",
  env: allowEnv({
    FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST,
    CONFIRM_BACKFILL_APPLY: "yes",
    BACKFILL_SNAPSHOT_ID: "emu-snapshot",
    GCLOUD_PROJECT: "demo-backfill",
  }),
});

const first = runApply();
assert.equal(first.status, 0, `${first.stdout}\n${first.stderr}`);
assert.match(first.stdout, /target=emulator/);
assert.match(first.stdout, /snapshot=present/);
assert.match(first.stdout, /scan_mismatches=0/);
assert.equal(first.stdout.includes("emu-snapshot"), false);
assert.equal(first.stdout.includes("Jenson"), false);

const sumVerified = async () => {
  const snap = await db.collection("rollups_driver_day").get();
  let orders = 0;
  let parents = 0;
  for (const doc of snap.docs) {
    parents += 1;
    assert.equal(doc.get("partial"), false);
    orders += doc.get("verified") ?? 0;
  }
  return { parents, orders };
};

const once = await sumVerified();
assert.ok(once.parents > 0);
assert.ok(once.orders > 0);
const marker = await db.doc(`rollups_driver_day/${sample.driverId}_${sample.day}/applied/${sample.id}`).get();
assert.equal(marker.get("status"), sample.status);
const seeded = await db.doc(`deliveries/${sample.id}`).get();
assert.equal(seeded.get("note"), "keep");
assert.equal(seeded.get("status"), "verified");
assert.equal(seeded.get("order_id_lower"), "ord-42");

const second = runApply();
assert.equal(second.status, 0, `${second.stdout}\n${second.stderr}`);
const twice = await sumVerified();
assert.equal(twice.parents, once.parents);
assert.equal(twice.orders, once.orders);

const reconciled = spawnSync(process.execPath, ["--import", "tsx", script, "--fixtures", "--reconcile"], {
  cwd: functionsDir,
  encoding: "utf8",
  env: allowEnv({
    FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST,
    CONFIRM_BACKFILL_APPLY: "yes",
    BACKFILL_SNAPSHOT_ID: "emu-snapshot",
    GCLOUD_PROJECT: "demo-backfill",
  }),
});
assert.equal(reconciled.status, 0, `${reconciled.stdout}\n${reconciled.stderr}`);
assert.match(reconciled.stdout, /reconcile=true/);
assert.match(reconciled.stdout, /set_mode=absolute/);
assert.equal(reconciled.stdout.includes("emu-snapshot"), false);
const afterReconcile = await sumVerified();
assert.equal(afterReconcile.parents, once.parents);
assert.equal(afterReconcile.orders, once.orders);
console.log("emulator_apply_ok");
