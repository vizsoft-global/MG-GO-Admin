#!/usr/bin/env node
/**
 * Create (or promote) a super admin on the PRODUCTION Supabase project.
 *
 * Creates the auth user (email confirmed), adds it to admin_allowlist, sets the
 * profile to the super_admin role with approval_status='approved', and marks the
 * super admin as claimed in app_settings.
 *
 * Service-role key is read from `supabase projects api-keys` (no secret in repo).
 *
 * Usage:
 *   SUPER_ADMIN_EMAIL=admin@vizsoft.in SUPER_ADMIN_PASSWORD='...' \
 *     node scripts/create-prod-super-admin.mjs
 */
import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const PROJECT_REF = "eoksxkdssptgyqyywdju";
const SUPABASE_URL = `https://${PROJECT_REF}.supabase.co`;

const email = process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.SUPER_ADMIN_PASSWORD;

if (!email || !password) {
  console.error("Missing SUPER_ADMIN_EMAIL or SUPER_ADMIN_PASSWORD");
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

console.log(`Provisioning super admin: ${email}`);

const { error: allowlistError } = await supabase
  .from("admin_allowlist")
  .upsert({ email, role: "staff" });
if (allowlistError) {
  console.error("Allowlist error:", allowlistError.message);
  process.exit(1);
}
console.log("✓ admin_allowlist");

const { data: list } = await supabase.auth.admin.listUsers();
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

const { data: superRole, error: roleError } = await supabase
  .from("admin_roles")
  .select("id")
  .eq("slug", "super_admin")
  .single();
if (roleError || !superRole) {
  console.error("super_admin role not found:", roleError?.message);
  process.exit(1);
}

const { error: profileError } = await supabase.from("profiles").upsert({
  id: userId,
  email,
  role: "staff",
  locale: "en",
  full_name: "Super Admin",
  admin_role_id: superRole.id,
  approval_status: "approved",
  approved_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
});
if (profileError) {
  console.error("Profile error:", profileError.message);
  process.exit(1);
}
console.log("✓ profile set to super_admin / approved");

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

console.log(`\nDone. Sign in at https://dpdadmin-prod.vercel.app/en/login`);
console.log(`  Email: ${email}`);
