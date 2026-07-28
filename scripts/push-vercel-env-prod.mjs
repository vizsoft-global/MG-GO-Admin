#!/usr/bin/env node
/**
 * Push production env vars to Vercel project dpdadmin-prod.
 * Reads Supabase keys via CLI; R2/maps from .env.local when present.
 */
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import { randomBytes } from "crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const PROJECT = "dpdadmin-prod";
const SUPABASE_REF = "eoksxkdssptgyqyywdju";

function parseEnv(path) {
  const out = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      v = v.slice(1, -1);
    out[t.slice(0, i).trim()] = v;
  }
  return out;
}

function supabaseKeys() {
  const r = spawnSync(
    "supabase",
    ["projects", "api-keys", "--project-ref", SUPABASE_REF, "-o", "json"],
    { cwd: root, encoding: "utf8" },
  );
  if (r.status !== 0) throw new Error("supabase projects api-keys failed");
  const rows = JSON.parse(r.stdout);
  const map = {};
  for (const row of rows) {
    if (row.name === "anon") map.anon = row.api_key;
    if (row.name === "service_role") map.serviceRole = row.api_key;
    if (row.type === "publishable" || row.name === "default") {
      if (row.api_key?.startsWith("sb_publishable")) map.publishable = row.api_key;
    }
  }
  return map;
}

function vercelEnvAdd(key, value, envs = ["production"]) {
  const sensitive =
    key.startsWith("SUPABASE_SERVICE_ROLE") ||
    key.startsWith("R2_SECRET") ||
    key.startsWith("R2_ACCESS") ||
    key === "CRON_SECRET" ||
    key === "IMAGE_SIGNING_SECRET" ||
    key === "CLOUDFLARE_API_TOKEN" ||
    key === "FIREBASE_SERVICE_ACCOUNT_JSON" ||
    key === "FIREBASE_PRIVATE_KEY";
  for (const env of envs) {
    const args = ["env", "add", key, env, "--yes", "--force", "--value", value];
    if (sensitive) args.push("--sensitive");
    const r = spawnSync("vercel", args, { cwd: root, encoding: "utf8" });
    if (r.status !== 0) {
      console.error(`Failed ${key} (${env}):`, r.stderr || r.stdout);
      process.exit(1);
    }
  }
}

const local = parseEnv(resolve(root, ".env.local"));
const sb = supabaseKeys();
const cronSecret = randomBytes(24).toString("hex");
const r2Account = local.R2_ACCOUNT_ID || "04c485faa34d67d1758b61465202e9ce";
const r2Endpoint =
  local.R2_S3_ENDPOINT ||
  `https://${r2Account}.r2.cloudflarestorage.com`;

const vars = {
  NEXT_PUBLIC_SUPABASE_URL: `https://${SUPABASE_REF}.supabase.co`,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: sb.anon,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: sb.publishable || sb.anon,
  SUPABASE_SERVICE_ROLE_KEY: sb.serviceRole,
  NEXT_PUBLIC_APP_URL: "https://dpdadmin-prod.vercel.app",
  R2_ACCOUNT_ID: r2Account,
  R2_BUCKET_NAME: "dpd-private-prod",
  R2_ACCESS_KEY_ID: local.R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY: local.R2_SECRET_ACCESS_KEY,
  R2_S3_ENDPOINT: r2Endpoint,
  IMAGES_WORKER_URL:
    local.IMAGES_WORKER_URL || "https://dpd-images.vizsoft.workers.dev",
  IMAGE_SIGNING_SECRET: local.IMAGE_SIGNING_SECRET,
  CLOUDFLARE_API_TOKEN: local.CLOUDFLARE_API_TOKEN,
  CRON_SECRET: cronSecret,
  DRIVER_APP_ORIGINS: "https://dpdadmin-prod.vercel.app",
  FIREBASE_PROJECT_ID: "musallam-delivery-prod",
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: "musallam-delivery-prod",
  NEXT_PUBLIC_FIREBASE_API_KEY: "AIzaSyCkatUNl5XaIyibpn_-huemp0K854X-MD0",
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: "579224507592",
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: "musallam-delivery-prod.firebasestorage.app",
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "musallam-delivery-prod.firebaseapp.com",
  NEXT_PUBLIC_FIREBASE_APP_ID: "1:579224507592:web:566afbce6fb96ae84981fd",
  FIREBASE_APP_ID_ANDROID: "1:579224507592:android:ce14086cc2ea677d4981fd",
  FIREBASE_APP_ID_IOS: "1:579224507592:ios:53130e94d3c1f1364981fd",
  FIREBASE_APP_ID_WEB: "1:579224507592:web:566afbce6fb96ae84981fd",
  FIREBASE_ANALYTICS_ENABLED: "true",
  FIREBASE_CRASHLYTICS_ENABLED: "true",
  FIREBASE_PERFORMANCE_ENABLED: "true",
  FIREBASE_REMOTE_CONFIG_ENABLED: "true",
  NOTIFICATION_APPROVAL_REQUIRED_CATEGORIES: "high,broadcast,emergency",
  NOTIFICATION_SEND_RATE_PER_MINUTE: "600",
  NOTIFICATION_BATCH_SIZE: "500",
  NEXT_PUBLIC_MAPTILER_MAP_ID: "streets-v2",
};

if (local.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY)
  vars.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY = local.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
if (local.NEXT_PUBLIC_MAPTILER_API_KEY)
  vars.NEXT_PUBLIC_MAPTILER_API_KEY = local.NEXT_PUBLIC_MAPTILER_API_KEY;

if (!existsSync(resolve(root, ".vercel/project.json"))) {
  spawnSync("vercel", ["link", "--project", PROJECT, "--yes"], { cwd: root, stdio: "inherit" });
}

for (const [k, v] of Object.entries(vars)) {
  if (!v) {
    console.warn(`skip ${k} (empty)`);
    continue;
  }
  vercelEnvAdd(k, v);
  console.log(`set ${k}`);
}

console.log("Done — production env vars on", PROJECT);
