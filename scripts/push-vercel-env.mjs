#!/usr/bin/env node
/**
 * Push env vars from .env.local to Vercel (production + preview + development).
 * WARNING: this currently applies identical values to all Vercel environments.
 * Do not run for split test/prod setups unless you intentionally want that.
 * Usage: node scripts/push-vercel-env.mjs
 */

import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const envPath = resolve(root, ".env.local");

const EXTRA = {
  R2_ACCOUNT_ID: "04c485faa34d67d1758b61465202e9ce",
  R2_BUCKET_NAME: "dpd-private",
  R2_S3_ENDPOINT:
    "https://04c485faa34d67d1758b61465202e9ce.r2.cloudflarestorage.com",
  IMAGES_WORKER_URL: "https://dpd-images-testing.vizsoft.workers.dev",
};

const KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_MAPTILER_API_KEY",
  "NEXT_PUBLIC_MAPTILER_MAP_ID",
  "NEXT_PUBLIC_GOOGLE_MAPS_API_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET_NAME",
  "R2_S3_ENDPOINT",
  "IMAGES_WORKER_URL",
  "IMAGE_SIGNING_SECRET",
];

const ENVIRONMENTS = ["production", "preview", "development"];

function parseEnvFile(path) {
  const out = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function addEnv(name, value, environment) {
  const sensitive =
    name.includes("SECRET") ||
    name.includes("KEY") ||
    name.includes("PASSWORD") ||
    name === "SUPABASE_SERVICE_ROLE_KEY";

  const args = [
    "env",
    "add",
    name,
    environment,
    "--yes",
    "--force",
    "--value",
    value,
  ];
  if (sensitive) args.push("--sensitive");

  const result = spawnSync("vercel", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });

  if (result.status !== 0) {
    const err = (result.stderr || result.stdout || "").trim();
    if (err.includes("already exists") || err.includes("Updated")) {
      return "updated";
    }
    console.error(`  FAIL ${name}@${environment}: ${err}`);
    return "fail";
  }
  return "ok";
}

const local = { ...parseEnvFile(envPath), ...EXTRA };

console.log("Pushing env to Vercel project dpdadmin...\n");

let ok = 0;
let skip = 0;
let fail = 0;

for (const key of KEYS) {
  const value = local[key]?.trim();
  if (!value) {
    console.log(`skip ${key} (no value in .env.local or extras)`);
    skip += 1;
    continue;
  }

  for (const env of ENVIRONMENTS) {
    const status = addEnv(key, value, env);
    if (status === "ok" || status === "updated") {
      console.log(`  ok ${key} → ${env}`);
      ok += 1;
    } else if (status === "fail") {
      fail += 1;
    }
  }
}

console.log(`\nDone: ${ok} set, ${skip} keys skipped, ${fail} failures`);
if (skip > 0 && !local.R2_ACCESS_KEY_ID) {
  console.log(
    "\nAdd R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY to .env.local, then re-run this script.",
  );
}
process.exit(fail > 0 ? 1 : 0);
