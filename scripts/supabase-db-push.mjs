#!/usr/bin/env node
/**
 * Push pending Supabase migrations using the Management API.
 * Requires SUPABASE_ACCESS_TOKEN in .env.local or environment.
 *
 * Usage: node scripts/supabase-db-push.mjs
 * Or:    supabase login && supabase link --project-ref ytfmsgckjatiserpgdbz && supabase db push
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const PROJECT_REF = "ytfmsgckjatiserpgdbz";

function loadEnv() {
  const envPath = join(root, ".env.local");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    const value = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnv();

const token = process.env.SUPABASE_ACCESS_TOKEN?.trim();
if (!token) {
  console.error(
    "Missing SUPABASE_ACCESS_TOKEN. Run: supabase login\n" +
      "Or add SUPABASE_ACCESS_TOKEN to .env.local from https://supabase.com/dashboard/account/tokens",
  );
  process.exit(1);
}

const migrationsDir = join(root, "supabase", "migrations");
const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

async function runQuery(query) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    },
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.message ?? body.error ?? res.statusText);
  }
  return body;
}

console.log(`Applying ${files.length} migration file(s) via Management API…`);

for (const file of files) {
  const sql = readFileSync(join(migrationsDir, file), "utf8");
  process.stdout.write(`  ${file} … `);
  try {
    await runQuery(sql);
    console.log("ok");
  } catch (err) {
    console.log("failed");
    console.error(err.message);
    process.exit(1);
  }
}

console.log("Done.");
