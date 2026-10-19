#!/usr/bin/env node
/**
 * Seeds the vehicle_companies catalog that backs `vehicles.company_id`
 * (Fleet → Add / Edit vehicle → "Vehicle Company").
 *
 * Dry-run unless --apply AND CONFIRM_VEHICLE_COMPANIES=yes.
 * `merge: true` so an operator's rename or deactivation survives; pass
 * --overwrite to force this file's labels back over an existing doc.
 * Never deletes. Project musallam-delivery-prod, named database "default".
 */
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { assertProd, loadEnv, loadServiceAccount } from "./perf-env.mjs";

const PROJECT = "musallam-delivery-prod";
const DATABASE = "default";
const COLLECTION = "vehicle_companies";
const APPLY = process.argv.includes("--apply");
const OVERWRITE = process.argv.includes("--overwrite");
const CONFIRM = process.env.CONFIRM_VEHICLE_COMPANIES === "yes";

/** key, label_en, label_ar, sort_order — matches the Fleet form screenshot. */
const COMPANIES = [
  ["americana", "Americana", "أمريكانا", 10],
  ["door_dash", "Door Dash", "دور داش", 20],
  ["keeta", "Keeta", "كيتا", 30],
  ["talabat", "Talabat", "طلبات", 40],
  ["uber_eats", "Uber Eats", "أوبر إيتس", 50],
];

const KEY_RE = /^[a-z0-9_]{1,32}$/;

async function main() {
  for (const [key, labelEn, labelAr] of COMPANIES) {
    if (!KEY_RE.test(key)) throw new Error(`invalid_key:${key}`);
    if (!labelEn.trim() || !labelAr.trim()) throw new Error(`missing_label:${key}`);
  }

  const account = loadServiceAccount(loadEnv());
  assertProd(account);

  const app =
    getApps()[0] ??
    initializeApp({
      credential: cert({
        projectId: account.projectId,
        clientEmail: account.clientEmail,
        privateKey: account.privateKey,
      }),
      projectId: PROJECT,
    });
  const db = getFirestore(app, DATABASE);

  const existing = await db.collection(COLLECTION).get();
  const byKey = new Map(existing.docs.map((doc) => [doc.id, doc.data() ?? {}]));
  console.log(`vehicle_companies: ${existing.size} existing`);
  if (existing.size > 0) {
    const keys = existing.docs.map((doc) => doc.id).sort();
    console.log(`existing keys: ${keys.join(", ")}`);
  }

  const plan = [];
  for (const [key, labelEn, labelAr, sortOrder] of COMPANIES) {
    const current = byKey.get(key);
    if (!current) {
      plan.push({ key, action: "create", payload: { key, label_en: labelEn, label_ar: labelAr, is_active: true, sort_order: sortOrder } });
      continue;
    }
    const active = current.is_active !== false;
    if (OVERWRITE) {
      plan.push({
        key,
        action: "overwrite",
        payload: { key, label_en: labelEn, label_ar: labelAr, is_active: active, sort_order: sortOrder },
      });
      continue;
    }
    if (typeof current.sort_order === "number" && current.sort_order === sortOrder) {
      plan.push({ key, action: "skip" });
      continue;
    }
    plan.push({
      key,
      action: "sort_only",
      payload: { key, label_en: String(current.label_en ?? labelEn), label_ar: String(current.label_ar ?? labelAr), is_active: active, sort_order: sortOrder },
    });
  }

  for (const item of plan) console.log(`  ${item.action.padEnd(9)} ${item.key}`);
  const writes = plan.filter((item) => item.action !== "skip");

  if (!APPLY) {
    console.log(`\ndry-run: ${writes.length} write(s) planned. Re-run with --apply and CONFIRM_VEHICLE_COMPANIES=yes.`);
    return;
  }
  if (!CONFIRM) {
    throw new Error("refusing: set CONFIRM_VEHICLE_COMPANIES=yes to write production");
  }

  for (const item of writes) {
    const ref = db.collection(COLLECTION).doc(item.key);
    await ref.set({ ...item.payload, updated_at: FieldValue.serverTimestamp() }, { merge: true });
    console.log(`  wrote ${item.key}`);
  }
  console.log(`\napplied: ${writes.length} doc(s)`);
}

await main();
