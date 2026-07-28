#!/usr/bin/env node
/**
 * Create (or promote) an approved admin panel user on PRODUCTION Supabase.
 *
 * Creates the auth user (email confirmed), adds it to admin_allowlist, and sets
 * the profile to the requested admin role with approval_status='approved'.
 *
 * Service-role key is read from `supabase projects api-keys` (no secret in repo).
 *
 * Usage:
 *   ADMIN_EMAIL=mg@vizsoft.in ADMIN_PASSWORD='...' \
 *     node scripts/create-prod-admin-user.mjs
 *
 * Optional:
 *   ADMIN_ROLE_SLUG=administrator   (default; also: operator, super_admin)
 *   ADMIN_FULL_NAME='Administrator'
 */
import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const PROJECT_REF = "eoksxkdssptgyqyywdju";
const SUPABASE_URL = `https://${PROJECT_REF}.supabase.co`;

const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD;
const roleSlug = process.env.ADMIN_ROLE_SLUG?.trim() || "administrator";
const fullName = process.env.ADMIN_FULL_NAME?.trim() || "Administrator";

if (!email || !password) {
  console.error("Missing ADMIN_EMAIL or ADMIN_PASSWORD");
  process.exit(1);
}

function serviceRoleKey() {
  const r = spawnSync(
    "supabase",
    ["projects", "api-keys", "--project-ref", PROJECT_REF, "-o", "json"],
    { encoding: "utf8" },
  );
  if (r.status !== 0) {
    console.error("supabase projects api-keys failed:", r.stderr || r.stdout);
    process.exit(1);
  }
  const rows = JSON.parse(r.stdout);
  const row = rows.find((x) => x.name === "service_role");
  if (!row?.api_key) {
    console.error("service_role key not found");
    process.exit(1);
  }
  return row.api_key;
}

const supabase = createClient(SUPABASE_URL, serviceRoleKey(), {
  auth: { autoRefreshToken: false, persistSession: false },
});

console.log(`Provisioning ${roleSlug}: ${email}`);

const { error: allowlistError } = await supabase
  .from("admin_allowlist")
  .upsert({ email, role: "staff" });
if (allowlistError) {
  console.error("Allowlist error:", allowlistError.message);
  process.exit(1);
}
console.log("✓ admin_allowlist");

const { data: list } = await supabase.auth.admin.listUsers({
  page: 1,
  perPage: 1000,
});
let userId = list?.users?.find((u) => u.email?.toLowerCase() === email)?.id;

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
  console.log("✓ created auth user");
} else {
  const { error } = await supabase.auth.admin.updateUserById(userId, {
    password,
    email_confirm: true,
  });
  if (error) {
    console.warn("Could not reset password:", error.message);
  } else {
    console.log("✓ reset password for existing user");
  }
}

const { data: adminRole, error: roleError } = await supabase
  .from("admin_roles")
  .select("id, name")
  .eq("slug", roleSlug)
  .single();
if (roleError || !adminRole) {
  console.error(`${roleSlug} role not found:`, roleError?.message);
  process.exit(1);
}

const { error: profileError } = await supabase.from("profiles").upsert({
  id: userId,
  email,
  role: "staff",
  locale: "en",
  full_name: fullName,
  admin_role_id: adminRole.id,
  approval_status: "approved",
  approved_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
});
if (profileError) {
  console.error("Profile error:", profileError.message);
  process.exit(1);
}
console.log(`✓ profile set to ${roleSlug} / approved`);

if (roleSlug === "super_admin") {
  const { error: settingsError } = await supabase
    .from("app_settings")
    .update({
      super_admin_claimed: true,
      super_admin_user_id: userId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1);
  if (settingsError) {
    console.warn("app_settings update warning:", settingsError.message);
  } else {
    console.log("✓ app_settings.super_admin_claimed = true");
  }
}

console.log(`\nDone. Sign in at https://dpdadmin-prod.vercel.app/en/login`);
console.log(`  Email: ${email}`);
