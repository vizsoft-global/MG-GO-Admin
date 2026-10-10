#!/usr/bin/env node
/**
 * Stream the five live history tables from Supabase into Firestore `default`.
 * UUID hex range keeps shards disjoint. Prints counts only.
 *
 *   node scripts/plan3-load-history.mjs --table driver_location_events --lo 0 --hi 2
 *   node scripts/plan3-load-history.mjs --table geofence_events
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const stateDir = resolve("C:/Users/Admin/Desktop/Vizsoft/dpd-plan3-dump/state");
const ALLOW = new Set([
  "driver_location_events",
  "driver_telemetry_events",
  "fleet_events",
  "driver_operation_events",
  "geofence_events",
]);
const BIGINT_ID = new Set([
  "driver_telemetry_events",
  "fleet_events",
  "driver_operation_events",
]);
const ISO_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
const PAGE = 1000;
const BATCH = 400;
const PIPELINE = 4;
const KUWAIT_MS = 3 * 60 * 60 * 1000;

function arg(name, fallback = "") {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

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
  if (!raw) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = JSON.parse(raw.replace(/\\"/g, '"').replace(/\\\\n/g, "\\n"));
  }
  const privateKey = parsed.private_key?.replace(/\\n/g, "\n").trim();
  if (!parsed.project_id || !parsed.client_email || !privateKey) return null;
  return { projectId: parsed.project_id, clientEmail: parsed.client_email, privateKey };
}

function bound(hex) {
  if (!hex) return "";
  return `${hex.padEnd(8, "0")}-0000-0000-0000-000000000000`;
}

function kuwaitDay(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.getTime() + KUWAIT_MS).toISOString().slice(0, 10);
}

function convert(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    if (ISO_TS.test(value)) {
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) return Timestamp.fromDate(date);
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(convert);
  if (typeof value === "object") {
    const out = {};
    for (const [key, child] of Object.entries(value)) {
      if (child !== undefined) out[key] = convert(child);
    }
    return out;
  }
  return value;
}

function shape(table, row) {
  if (table !== "driver_location_events") return row;
  if (row.latitude != null && row.lat == null) row.lat = row.latitude;
  if (row.longitude != null && row.lng == null) row.lng = row.longitude;
  if (row.recorded_at && row.at == null) row.at = row.recorded_at;
  if (row.recorded_at && row.day == null) row.day = kuwaitDay(row.recorded_at);
  return row;
}

async function commitRetry(batch) {
  let wait = 400;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try {
      await batch.commit();
      return;
    } catch (error) {
      const code = error?.code ?? "";
      if (attempt === 6 || (code !== 4 && code !== 8 && code !== 13 && code !== 14)) throw error;
      await new Promise((resolveWait) => setTimeout(resolveWait, wait));
      wait *= 2;
    }
  }
}

const probe = process.argv.includes("--probe");
const table = arg("--table");
const lo = arg("--lo").toLowerCase();
const hi = arg("--hi").toLowerCase();
const since = arg("--since");
if (since && table !== "driver_location_events") {
  console.error("since is only for driver_location_events");
  process.exit(1);
}
if (since && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(since)) {
  console.error("since must be UTC ISO");
  process.exit(1);
}
if (!ALLOW.has(table)) {
  console.error("refusing table");
  process.exit(1);
}
const bigint = BIGINT_ID.has(table);
if (bigint) {
  if ((lo && !/^\d+$/.test(lo)) || (hi && !/^\d+$/.test(hi))) {
    console.error("bigint lo/hi must be decimal ids");
    process.exit(1);
  }
} else if ((lo && !/^[0-9a-f]$/.test(lo)) || (hi && !/^[0-9a-g]$/.test(hi))) {
  console.error("lo/hi must be one hex digit, hi may be g");
  process.exit(1);
}

const env = loadEnv();
const account = loadServiceAccount(env);
const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!account || account.projectId !== "musallam-delivery-prod" || !supabaseUrl || !serviceKey) {
  console.error("refusing: firebase project or supabase env");
  process.exit(1);
}

const app = getApps()[0] ?? initializeApp({ credential: cert(account), projectId: account.projectId });
const db = getFirestore(app, "default");
db.settings({ ignoreUndefinedProperties: true });
const col = db.collection(table);
mkdirSync(stateDir, { recursive: true });
const sinceTag = since ? `-since-${since.replaceAll(":", "")}` : "";
const statePath = resolve(stateDir, `${table}-${lo || "all"}-${hi || "end"}${sinceTag}.txt`);
let cursor = existsSync(statePath) ? readFileSync(statePath, "utf8").trim() : "";
const lower = bigint ? lo : bound(lo);
const upper = bigint ? hi : hi && hi !== "g" ? bound(hi) : "";
console.log(`project=${account.projectId} database=default table=${table} lo=${lo || "all"} hi=${hi || "end"} resume=${cursor ? "yes" : "no"}`);

async function fetchPage(after) {
  const url = new URL(`${supabaseUrl}/rest/v1/${table}`);
  url.searchParams.set("select", "*");
  url.searchParams.set("order", "id.asc");
  url.searchParams.set("limit", String(PAGE));
  const start = after || lower;
  if (start) url.searchParams.set("id", `gte.${start}`);
  if (after) url.searchParams.set("id", `gt.${after}`);
  if (upper) url.searchParams.append("id", `lt.${upper}`);
  if (since) url.searchParams.set("recorded_at", `gte.${since}`);
  let wait = 500;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const res = await fetch(url, {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        Accept: "application/json",
      },
    });
    if (res.ok) return res.json();
    if (attempt === 6 || (res.status !== 429 && res.status < 500)) {
      const body = await res.text();
      const message = body.replace(/\s+/g, " ").slice(0, 180);
      console.error(`page_failed status=${res.status} ${message}`);
      process.exit(1);
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, wait));
    wait *= 2;
  }
  return [];
}

let written = 0;
if (probe) {
  const sample = await fetchPage(cursor);
  console.log(`probe table=${table} rows=${Array.isArray(sample) ? sample.length : 0}`);
  process.exit(0);
}
while (true) {
  const rows = await fetchPage(cursor);
  if (!Array.isArray(rows) || rows.length === 0) break;
  const inflight = [];
  let batch = db.batch();
  let pending = 0;
  for (const raw of rows) {
    const id = raw?.id ? String(raw.id).replaceAll("/", "_") : "";
    if (!id) continue;
    batch.set(col.doc(id), convert(shape(table, raw)));
    pending += 1;
    written += 1;
    if (pending === BATCH) {
      const ready = batch;
      batch = db.batch();
      pending = 0;
      inflight.push(commitRetry(ready));
      if (inflight.length >= PIPELINE) await inflight.shift();
    }
  }
  if (pending) inflight.push(commitRetry(batch));
  await Promise.all(inflight);
  cursor = String(rows[rows.length - 1].id);
  writeFileSync(statePath, cursor);
  if (written % 8000 < PAGE) console.log(`progress ${table} lo=${lo || "all"} docs=${written}`);
  if (rows.length < PAGE) break;
}
console.log(`history_done table=${table} lo=${lo || "all"} hi=${hi || "end"} docs=${written}`);
