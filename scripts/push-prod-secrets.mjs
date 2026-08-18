#!/usr/bin/env node
/** Push FIREBASE + CLOUDFLARE secrets to dpdadmin-prod (production only). */
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv(path) {
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

function add(key, value, sensitive = true) {
  const args = ["env", "add", key, "production", "--yes", "--force", "--value", value];
  if (sensitive) args.push("--sensitive");
  const bin = process.platform === "win32" ? "vercel.cmd" : "vercel";
  const r = spawnSync(bin, args, {
    cwd: root,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (r.status !== 0) {
    console.error(`failed ${key}:`, r.stderr || r.stdout || r.error);
    process.exit(1);
  }
  console.log(`set ${key}`);
}

const saPath = resolve(root, "config/firebase-prod/service-account.json");
if (!existsSync(saPath)) {
  console.error("Missing config/firebase-prod/service-account.json — run: node scripts/create-prod-firebase-sa.mjs");
  process.exit(1);
}
const sa = JSON.parse(readFileSync(saPath, "utf8"));
const testingVercel = loadEnv("/tmp/dpdadmin-vercel-env");
const cfToken = testingVercel.CLOUDFLARE_API_TOKEN;

add("FIREBASE_SERVICE_ACCOUNT_JSON", JSON.stringify(sa));
add("FIREBASE_PROJECT_ID", sa.project_id, false);
add("FIREBASE_CLIENT_EMAIL", sa.client_email, false);
// Split PEM is a fallback. Admin prefers FIREBASE_SERVICE_ACCOUNT_JSON.
// `vercel env add --value` cannot take a multi-line PEM on Windows.
if (!sa.private_key) {
  console.warn("service account JSON has no private_key");
} else {
  console.warn("skip FIREBASE_PRIVATE_KEY (JSON credential is the source of truth)");
}

if (cfToken) {
  add("CLOUDFLARE_API_TOKEN", cfToken);
} else {
  console.warn("skip CLOUDFLARE_API_TOKEN (not in testing Vercel env)");
}

console.log("Done.");
