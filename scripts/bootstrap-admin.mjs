#!/usr/bin/env node
/**
 * One-time admin bootstrap. Creates auth user + allowlist + staff profile.
 *
 * Required env (in .env.local or shell):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   ADMIN_EMAIL
 *   ADMIN_PASSWORD
 *
 * Usage: npm run bootstrap:admin
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function loadEnvFile() {
  const envPath = join(root, ".env.local");
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD;

if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  console.error("Get service role key: Supabase Dashboard → Project Settings → API");
  process.exit(1);
}

if (!email || !password) {
  console.error("Missing ADMIN_EMAIL or ADMIN_PASSWORD in .env.local");
  process.exit(1);
}

if (password.length < 8) {
  console.error("ADMIN_PASSWORD must be at least 8 characters");
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

console.log(`Bootstrapping admin: ${email}`);

const { error: allowlistError } = await supabase.from("admin_allowlist").upsert({
  email,
  role: "staff",
});

if (allowlistError) {
  console.error("Allowlist error:", allowlistError.message);
  process.exit(1);
}

console.log("✓ Added to admin_allowlist");

const { data: existingUsers } = await supabase.auth.admin.listUsers();
const existing = existingUsers?.users?.find((u) => u.email?.toLowerCase() === email);

let userId = existing?.id;

if (!userId) {
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (error) {
    console.error("Create user error:", error.message);
    process.exit(1);
  }

  userId = data.user.id;
  console.log("✓ Created auth user");
} else {
  const { error } = await supabase.auth.admin.updateUserById(userId, { password });
  if (error) {
    console.warn("Could not reset password:", error.message);
  } else {
    console.log("✓ Updated password for existing user");
  }
}

const { error: profileError } = await supabase.from("profiles").upsert({
  id: userId,
  email,
  role: "staff",
  locale: "en",
  full_name: "Admin",
  updated_at: new Date().toISOString(),
});

if (profileError) {
  console.error("Profile error:", profileError.message);
  process.exit(1);
}

console.log("✓ Profile set to staff");
console.log("\nDone. Sign in at /en/login with:");
console.log(`  Email:    ${email}`);
console.log(`  Password: (value from ADMIN_PASSWORD in .env.local)`);
