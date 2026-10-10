#!/usr/bin/env node
/**
 * Plan 3 load into Firestore database `default` on musallam-delivery-prod.
 * driver_location_events is never read and never written.
 */
import { createReadStream, existsSync, readFileSync, readdirSync } from "node:fs";
import { createInterface } from "node:readline";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
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

const DEFER = new Set([
  "deliveries",
  "driver_attendance",
  "driver_change_events",
  "driver_daily_shifts",
  "driver_push_tokens",
  "driver_sessions",
  "notification_campaigns",
  "notification_dispatch_items",
  "notification_dispatch_runs",
  "notification_events",
  "order_recon_rows",
  "storage_uploads",
]);

const PK = {
  admin_allowlist: ["email"],
  admin_permissions: ["slug"],
  admin_role_ui_defaults: ["role_id", "preference_key"],
  admin_ui_preferences: ["user_id", "preference_key"],
  locales: ["code"],
  payroll_clients: ["key"],
  payroll_column_config: ["column_key"],
  payroll_zone_settings: ["period_month"],
  performance_rating_teams: ["key"],
  performance_score_components: ["key"],
  source_companies: ["key"],
  vehicle_types: ["key"],
  vehicle_use_types: ["key"],
  order_recon_store_aliases: ["alias"],
  driver_telemetry_event_types: ["name"],
  zone_geofence_settings: ["zone_id"],
  driver_locations: ["driver_id"],
  driver_restaurants: ["driver_id", "restaurant_id"],
  driver_intake_restaurants: ["intake_id", "restaurant_id"],
  driver_group_members: ["group_id", "driver_id"],
  driver_off_structure: ["driver_id", "period_month"],
  driver_performance_daily: ["driver_id", "log_date"],
  driver_dpd_shift_notices: ["driver_id", "shift_date", "kind"],
  fuel_withdrawn_overrides: ["driver_id", "vehicle_id", "month_key"],
  notification_analytics_daily: ["metric_date", "campaign_id"],
  payroll_zone_metrics: ["zone_id", "period_month"],
  request_confidential_views: ["request_id", "viewer_id"],
  verification_balances: ["driver_id", "restaurant_id"],
};

const COUNTERS = {
  appointment_code_seq: 1002,
  driver_code_seq: 10900,
  esign_batch_code_seq: 1002,
  esign_code_seq: 1424,
  fuel_refund_code_seq: 16,
  request_code_seq: 182,
  restaurant_code_seq: 146,
  visit_booking_code_seq: 36,
};

const ISO_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

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

function safeId(value) {
  return String(value).replaceAll("/", "_");
}

function docId(table, row) {
  if (table === "app_settings") return "1";
  if (table === "driver_restaurants") return safeId(`${row.driver_id}_${row.restaurant_id}`);
  if (table === "driver_intake_restaurants") return safeId(`${row.intake_id}_${row.restaurant_id}`);
  if (table === "admin_ui_preferences") {
    return safeId(`${row.user_id}_${encodeURIComponent(row.preference_key ?? "")}`);
  }
  if (table === "admin_role_ui_defaults") {
    return safeId(`${row.role_id}_${encodeURIComponent(row.preference_key ?? "")}`);
  }
  const pk = PK[table];
  if (pk) {
    const parts = pk.map((col) => row[col] ?? "");
    if (parts.every((part) => part === "") && row.id) return safeId(row.id);
    return safeId(parts.join("_"));
  }
  if (row.id) return safeId(row.id);
  return "";
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

async function loadMaps() {
  const drivers = new Map();
  const profiles = new Map();
  const zones = new Map();
  const partners = new Map();
  const partnerBySlug = new Map();
  const restaurantsByDriver = new Map();
  for await (const row of readJsonl(resolve(jsonlDir, "drivers.jsonl"))) {
    drivers.set(row.id, row);
  }
  for await (const row of readJsonl(resolve(jsonlDir, "profiles.jsonl"))) {
    profiles.set(row.id, row);
  }
  for await (const row of readJsonl(resolve(jsonlDir, "zones.jsonl"))) {
    zones.set(row.id, row.name ?? null);
  }
  for await (const row of readJsonl(resolve(jsonlDir, "partners.jsonl"))) {
    partners.set(row.id, row);
    if (row.slug) partnerBySlug.set(row.slug, row.id);
  }
  for await (const row of readJsonl(resolve(jsonlDir, "driver_restaurants.jsonl"))) {
    const list = restaurantsByDriver.get(row.driver_id) ?? [];
    list.push(row.restaurant_id);
    restaurantsByDriver.set(row.driver_id, list);
  }
  return { drivers, profiles, zones, partners, partnerBySlug, restaurantsByDriver };
}

function enrich(table, row, maps) {
  if (table !== "attendance_logs" && table !== "deliveries" && table !== "requests") return row;
  const driver = maps.drivers.get(row.driver_id);
  const profile = maps.profiles.get(row.driver_id);
  if (driver) {
    if (!row.driver_code && driver.driver_code) row.driver_code = driver.driver_code;
    if (!row.employee_id && driver.employee_id) row.employee_id = driver.employee_id;
    if (!row.zone_id && driver.zone_id) row.zone_id = driver.zone_id;
    if (!row.partner_id && driver.partner_id) row.partner_id = driver.partner_id;
  }
  const name = profile?.full_name || driver?.full_name || driver?.name || null;
  if (!row.driver_name && name) row.driver_name = name;
  if (table !== "attendance_logs") return row;
  const phone = profile?.phone || driver?.phone || null;
  if (!row.driver_phone && phone) row.driver_phone = phone;
  if (!row.zone_name && row.zone_id) row.zone_name = maps.zones.get(row.zone_id) ?? null;
  if (!row.partner_name && row.partner_id) row.partner_name = maps.partners.get(row.partner_id)?.name ?? null;
  if (!row.restaurant_ids) row.restaurant_ids = maps.restaurantsByDriver.get(row.driver_id) ?? [];
  if (!row.partner_match_keys) {
    const keys = new Set();
    if (row.partner_id) keys.add(row.partner_id);
    const project = driver?.project_key;
    if (project && maps.partnerBySlug.has(project)) keys.add(maps.partnerBySlug.get(project));
    row.partner_match_keys = [...keys];
  }
  return row;
}

async function writeDocs(db, table, rows) {
  let batch = db.batch();
  let pending = 0;
  let written = 0;
  const col = db.collection(table);
  for (const row of rows) {
    const id = docId(table, row);
    if (!id) continue;
    batch.set(col.doc(id), convert(row));
    pending += 1;
    written += 1;
    if (pending === 400) {
      await batch.commit();
      batch = db.batch();
      pending = 0;
    }
  }
  if (pending) await batch.commit();
  return written;
}

async function writeCollection(db, table, maps) {
  const file = resolve(jsonlDir, `${table}.jsonl`);
  if (!existsSync(file)) {
    console.log(`missing ${table}`);
    return 0;
  }
  let batch = db.batch();
  let pending = 0;
  let written = 0;
  const col = db.collection(table);
  for await (const raw of readJsonl(file)) {
    const row = enrich(table, raw, maps);
    const id = docId(table, row);
    if (!id) continue;
    batch.set(col.doc(id), convert(row));
    pending += 1;
    written += 1;
    if (pending === 400) {
      await batch.commit();
      batch = db.batch();
      pending = 0;
    }
  }
  if (pending) await batch.commit();
  console.log(`loaded ${table} docs=${written}`);
  return written;
}

async function writeGrouped(db, table, ownerField) {
  const file = resolve(jsonlDir, `${table}.jsonl`);
  const byOwner = new Map();
  for await (const row of readJsonl(file)) {
    const owner = row[ownerField];
    if (!owner) continue;
    const list = byOwner.get(owner) ?? [];
    if (row.permission_slug) list.push(row.permission_slug);
    byOwner.set(owner, list);
  }
  const rows = [...byOwner.entries()].map(([owner, slugs]) => ({
    id: owner,
    permission_slugs: [...new Set(slugs)],
  }));
  const written = await writeDocs(db, table, rows.map((row) => ({ ...row })));
  console.log(`loaded ${table} docs=${written}`);
}

function blank(value) {
  return value == null || String(value).trim() === "";
}

async function writeLocks(db, maps) {
  const locks = [];
  const seen = new Set();
  function add(collection, value, ownerId, driverId) {
    if (blank(value)) return;
    const trimmed = String(value).trim();
    const key = `${collection}:${trimmed}`;
    if (seen.has(key)) return;
    seen.add(key);
    const id = collection === "uniq_passcode" ? trimmed : encodeURIComponent(trimmed);
    locks.push({
      collection,
      id,
      data: {
        owner_id: ownerId,
        driver_id: driverId,
        value: trimmed,
        created_at: Timestamp.now(),
        updated_at: Timestamp.now(),
      },
    });
  }
  for (const driver of maps.drivers.values()) {
    if (driver.archived_at) continue;
    const profile = maps.profiles.get(driver.id);
    add("uniq_employee_id", driver.employee_id, driver.id, driver.id);
    add("uniq_phone", driver.phone || profile?.phone, driver.id, driver.id);
    add("uniq_civil_id", driver.civil_id, driver.id, driver.id);
    add("uniq_passcode", driver.app_passcode, driver.id, driver.id);
  }
  for await (const vehicle of readJsonl(resolve(jsonlDir, "vehicles.jsonl"))) {
    add("uniq_plate", vehicle.reg_number, vehicle.id, vehicle.current_driver_id ?? null);
  }
  let batch = db.batch();
  let pending = 0;
  for (const lock of locks) {
    batch.set(db.collection(lock.collection).doc(lock.id), lock.data);
    pending += 1;
    if (pending === 400) {
      await batch.commit();
      batch = db.batch();
      pending = 0;
    }
  }
  if (pending) await batch.commit();
  console.log(`loaded uniq_locks docs=${locks.length}`);
}

async function importAuth(auth) {
  const file = resolve(jsonlDir, "auth_users.jsonl");
  const users = [];
  for await (const row of readJsonl(file)) {
    const user = { uid: row.id };
    if (row.email) user.email = row.email;
    if (row.encrypted_password) user.passwordHash = Buffer.from(row.encrypted_password);
    if (row.email_confirmed_at) user.emailVerified = true;
    users.push(user);
  }
  const result = await auth.importUsers(users, { hash: { algorithm: "BCRYPT" } });
  const codes = {};
  for (const error of result.errors) {
    const code = error.error?.code ?? "unknown";
    codes[code] = (codes[code] ?? 0) + 1;
  }
  console.log(`auth_import users=${users.length} failures=${result.failureCount} codes=${JSON.stringify(codes)}`);
}

const deferredOnly = process.argv.includes("--deferred");
const env = loadEnv();
const account = loadServiceAccount(env);
if (!account || account.projectId !== "musallam-delivery-prod") {
  console.log("refused_project");
  process.exit(1);
}
console.log(`project=${account.projectId} database=default`);

const app = getApps()[0] ?? initializeApp({
  credential: cert({
    projectId: account.projectId,
    clientEmail: account.clientEmail,
    privateKey: account.privateKey,
  }),
});
const db = getFirestore(app, "default");
db.settings({ ignoreUndefinedProperties: true });

console.log("skipped driver_location_events");

const maps = await loadMaps();
const files = readdirSync(jsonlDir).filter((name) => name.endsWith(".jsonl"));
const skipNames = new Set(["auth_users.jsonl", "manifest.json"]);

if (!deferredOnly) {
  await importAuth(getAuth(app));
  await writeCollection(db, "admin_permissions", maps);
  const slugs = [];
  for await (const row of readJsonl(resolve(jsonlDir, "admin_permissions.jsonl"))) {
    if (row.slug) slugs.push(row.slug);
  }
  await writeDocs(db, "admin_permissions", [
    { id: "catalog", slugs },
    { id: "permissions", slugs },
  ]);
  console.log(`loaded admin_permissions catalog slugs=${slugs.length}`);
  await writeGrouped(db, "admin_role_permissions", "role_id");
  await writeGrouped(db, "admin_user_permissions", "user_id");
  await writeDocs(
    db,
    "counters",
    Object.entries(COUNTERS).map(([id, value]) => ({ id, value })),
  );
  console.log(`loaded counters docs=${Object.keys(COUNTERS).length}`);
  await writeLocks(db, maps);
}

for (const name of files) {
  if (skipNames.has(name)) continue;
  const table = name.slice(0, -".jsonl".length);
  if (NEVER.has(table)) {
    console.log(`skipped ${table}`);
    continue;
  }
  if (table === "admin_permissions" || table === "admin_role_permissions" || table === "admin_user_permissions") {
    continue;
  }
  if (deferredOnly ? !DEFER.has(table) : DEFER.has(table)) continue;
  await writeCollection(db, table, maps);
}

console.log("load_done");
