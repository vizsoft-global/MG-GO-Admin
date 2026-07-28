#!/usr/bin/env node
/**
 * Set Preview env vars via Vercel REST API (all preview branches, no git link required).
 */
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { homedir } from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const projectPath = resolve(root, ".vercel/project.json");
const envPath = resolve(root, ".env.local");
const authPath = resolve(
  homedir(),
  "Library/Application Support/com.vercel.cli/auth.json",
);

const { projectId, orgId: teamId } = JSON.parse(readFileSync(projectPath, "utf8"));

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

function getToken() {
  const auth = JSON.parse(readFileSync(authPath, "utf8"));
  const token = auth.token;
  if (!token) throw new Error("No token in Vercel auth.json");
  return token;
}

const KEYS = [
  { key: "NEXT_PUBLIC_SUPABASE_URL", type: "plain" },
  { key: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", type: "plain" },
  { key: "NEXT_PUBLIC_SUPABASE_ANON_KEY", type: "plain" },
  { key: "SUPABASE_SERVICE_ROLE_KEY", type: "sensitive" },
  { key: "R2_BUCKET_NAME", type: "plain", fallback: "dpd-private" },
  { key: "R2_ACCOUNT_ID", type: "plain" },
  { key: "R2_S3_ENDPOINT", type: "plain" },
  { key: "R2_ACCESS_KEY_ID", type: "sensitive" },
  { key: "R2_SECRET_ACCESS_KEY", type: "sensitive" },
];

async function upsertEnv(token, key, value, type) {
  const url = `https://api.vercel.com/v10/projects/${projectId}/env?teamId=${teamId}&upsert=true`;
  const body = {
    key,
    value,
    type,
    target: ["preview"],
    gitBranch: null,
  };
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${key}: HTTP ${res.status} ${text.slice(0, 300)}`);
  }
  return JSON.parse(text);
}

const local = parseEnvFile(envPath);
const token = getToken();

let ok = 0;
let fail = 0;

for (const { key, type, fallback } of KEYS) {
  const value = (local[key] ?? fallback)?.trim();
  if (!value) {
    console.log(`skip ${key} (no value)`);
    continue;
  }
  try {
    await upsertEnv(token, key, value, type);
    console.log(`ok ${key} → preview (all branches)`);
    ok += 1;
  } catch (e) {
    console.error(`FAIL ${e.message}`);
    fail += 1;
  }
}

process.exit(fail > 0 ? 1 : 0);
