/**
 * Read-only probe for the QA-40 leftovers that need production data.
 *
 *   node scripts/qa-40-probe.mjs
 *
 * Answers three questions the code pass could not:
 *   #25  do the salary_justification amount field defs still demand both amounts?
 *   #30  do the Keeta riders actually carry `drivers.project_key`?
 *   #28  does the default Storage bucket exist (the fuel-fill signing target)?
 *
 * Writes nothing. `loadEnv` / `assertProd` keep it pointed at
 * `musallam-delivery-prod` and fail closed on any other project.
 */
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { assertProd, loadEnv, loadServiceAccount } from "./perf-env.mjs";

const account = loadServiceAccount(loadEnv());
assertProd(account);
const app = getApps()[0] ?? initializeApp({ credential: cert(account), projectId: account.projectId });
const db = getFirestore(app, "default");

const SALARY_FIELDS = ["expected_amount", "received_amount"];

async function probeSalaryFields() {
  console.log("\n== #25 salary_justification field definitions ==");
  const snap = await db
    .collection("request_field_definitions")
    .where("type_key", "==", "salary_justification")
    .get();
  if (snap.empty) {
    console.log("  (no request_field_definitions rows for salary_justification)");
    return;
  }
  for (const doc of snap.docs.sort(
    (a, b) => (a.get("sort_order") ?? 0) - (b.get("sort_order") ?? 0),
  )) {
    const key = doc.get("field_key");
    const flag = SALARY_FIELDS.includes(key) ? " <<< AMOUNT" : "";
    console.log(
      `  ${String(key).padEnd(22)} server_required=${Boolean(doc.get("is_server_required"))}` +
        ` required=${Boolean(doc.get("is_required"))}` +
        ` kind=${doc.get("kind") ?? "-"} max=${doc.get("max_value") ?? "-"}${flag}`,
    );
  }
}

async function probeProjectKeys() {
  console.log("\n== #30-32 drivers.project_key (Keeta / filter source) ==");
  const snap = await db.collection("drivers").where("archived_at", "==", null).get();
  const counts = new Map();
  let live = 0;
  let blank = 0;
  for (const doc of snap.docs) {
    live += 1;
    const raw = doc.get("project_key");
    const key = typeof raw === "string" && raw.trim() ? raw.trim().toLowerCase() : "";
    if (!key) blank += 1;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  console.log(`  live drivers: ${live}; blank project_key: ${blank}`);
  for (const [key, count] of [...counts].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(key || "(blank)").padEnd(20)} ${count}`);
  }
}

async function probeStorageBucket() {
  console.log("\n== #28 rider upload bucket ==");
  const env = loadEnv();
  const configured = (
    env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ||
    env.FIREBASE_STORAGE_BUCKET ||
    ""
  ).trim();
  const candidates = [
    configured,
    "musallam-delivery-prod.appspot.com",
    "musallam-delivery-prod.firebasestorage.app",
  ].filter(Boolean);
  for (const name of [...new Set(candidates)]) {
    const bucket = getStorage(app).bucket(name);
    try {
      const [exists] = await bucket.exists();
      console.log(`  ${name.padEnd(48)} exists=${exists}`);
      if (!exists) continue;
      for (const prefix of ["fuel-fills/", ""]) {
        const [files] = await bucket.getFiles({ prefix, maxResults: 3 });
        console.log(`    prefix "${prefix || "(root)"}" -> ${files.length} sample`);
        for (const file of files) console.log(`      ${file.name}`);
      }
    } catch (error) {
      console.log(
        `  ${name.padEnd(48)} check failed: ${error instanceof Error ? error.message : error}`,
      );
    }
  }
}

try {
  await probeSalaryFields();
  await probeProjectKeys();
  await probeStorageBucket();
} catch (error) {
  console.error("probe failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
