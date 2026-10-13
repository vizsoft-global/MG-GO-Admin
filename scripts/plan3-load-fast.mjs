#!/usr/bin/env node
/**
 * Parallel Plan 3 writer. Refuses driver_location_events and the other hot histories.
 * Usage: node scripts/plan3-load-fast.mjs --collection deliveries --shard 0 --shards 4
 *        node scripts/plan3-load-fast.mjs --collection a,b,c
 */
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const jsonlDir = resolve("C:/Users/Admin/Desktop/Vizsoft/dpd-plan3-dump/jsonl");
const NEVER = new Set([
  "driver_location_events",
  "driver_telemetry_events",
  "fleet_events",
  "driver_operation_events",
  "geofence_events",
]);
const ISO_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
const PIPELINE = 6;
const BATCH = 400;

function arg(name, fallback) {
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
    try {
      parsed = JSON.parse(raw.replace(/\\"/g, '"').replace(/\\\\n/g, "\\n"));
    } catch {
      return null;
    }
  }
  const projectId = parsed.project_id?.trim();
  const clientEmail = parsed.client_email?.trim();
  const privateKey = parsed.private_key?.replace(/\\n/g, "\n").trim();
  if (!projectId || !clientEmail || !privateKey) return null;
  return { projectId, clientEmail, privateKey };
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

async function* readJsonl(file) {
  const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    yield JSON.parse(line);
  }
}

async function loadMaps() {
  const drivers = new Map();
  const profiles = new Map();
  for await (const row of readJsonl(resolve(jsonlDir, "drivers.jsonl"))) drivers.set(row.id, row);
  for await (const row of readJsonl(resolve(jsonlDir, "profiles.jsonl"))) profiles.set(row.id, row);
  return { drivers, profiles };
}

function enrich(table, row, maps) {
  if (table !== "deliveries") return row;
  const driver = maps.drivers.get(row.driver_id);
  const profile = maps.profiles.get(row.driver_id);
  if (driver) {
    if (!row.driver_code && driver.driver_code) row.driver_code = driver.driver_code;
    if (!row.employee_id && driver.employee_id) row.employee_id = driver.employee_id;
  }
  const name = profile?.full_name || driver?.full_name || driver?.name || null;
  if (!row.driver_name && name) row.driver_name = name;
  return row;
}

async function commitRetry(batch) {
  let wait = 500;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try {
      await batch.commit();
      return;
    } catch (error) {
      const code = error?.code ?? "";
      if (attempt === 6 || (code !== 8 && code !== 4 && code !== 13 && code !== 14)) throw error;
      await new Promise((resolveWait) => setTimeout(resolveWait, wait));
      wait *= 2;
    }
  }
}

async function writeCollection(db, table, maps, shard, shards) {
  if (NEVER.has(table)) {
    console.log(`skipped ${table}`);
    return 0;
  }
  const file = resolve(jsonlDir, `${table}.jsonl`);
  if (!existsSync(file)) {
    console.log(`missing ${table}`);
    return 0;
  }
  const col = db.collection(table);
  const inflight = [];
  let batch = db.batch();
  let pending = 0;
  let written = 0;
  let index = 0;
  async function queue(next) {
    inflight.push(next);
    if (inflight.length >= PIPELINE) await inflight.shift();
  }
  for await (const raw of readJsonl(file)) {
    if (index % shards !== shard) {
      index += 1;
      continue;
    }
    index += 1;
    const row = enrich(table, raw, maps);
    const id = row.id ? String(row.id).replaceAll("/", "_") : "";
    if (!id) continue;
    batch.set(col.doc(id), convert(row));
    pending += 1;
    written += 1;
    if (pending === BATCH) {
      const ready = batch;
      batch = db.batch();
      pending = 0;
      await queue(commitRetry(ready));
      if (written % 8000 === 0) console.log(`progress ${table} shard=${shard} docs=${written}`);
    }
  }
  if (pending) await queue(commitRetry(batch));
  await Promise.all(inflight);
  console.log(`loaded ${table} shard=${shard}/${shards} docs=${written}`);
  return written;
}

const tables = String(arg("--collection", ""))
  .split(",")
  .map((name) => name.trim())
  .filter(Boolean);
const shard = Number(arg("--shard", "0"));
const shards = Number(arg("--shards", "1"));
if (!tables.length || !Number.isInteger(shard) || !Number.isInteger(shards) || shard < 0 || shard >= shards) {
  console.error("usage: --collection name[,name] [--shard N --shards M]");
  process.exit(1);
}
for (const table of tables) {
  if (NEVER.has(table)) {
    console.log(`skipped ${table}`);
    process.exit(0);
  }
}

const account = loadServiceAccount(loadEnv());
if (!account || account.projectId !== "musallam-delivery-prod") {
  console.error("refusing: firebase project is not musallam-delivery-prod");
  process.exit(1);
}
const app = getApps()[0] ?? initializeApp({ credential: cert(account), projectId: account.projectId });
const db = getFirestore(app, "default");
db.settings({ ignoreUndefinedProperties: true });
console.log(`project=${account.projectId} database=default`);

const needsMaps = tables.includes("deliveries");
const maps = needsMaps ? await loadMaps() : { drivers: new Map(), profiles: new Map() };
let total = 0;
for (const table of tables) {
  total += await writeCollection(db, table, maps, shard, shards);
}
console.log(`fast_done tables=${tables.join(",")} shard=${shard} docs=${total}`);
