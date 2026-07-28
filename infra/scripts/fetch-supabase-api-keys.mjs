#!/usr/bin/env node
/**
 * Fetch anon + service_role (+ publishable if available) for a Supabase project.
 * Usage: SUPABASE_ACCESS_TOKEN=sbp_... node infra/scripts/fetch-supabase-api-keys.mjs <project_ref>
 *
 * After running, set Pulumi secrets:
 *   pulumi config set --secret dpd-infra:supabaseAnonKey "..."
 *   pulumi config set --secret dpd-infra:supabaseServiceRoleKey "..."
 *   pulumi config set --secret dpd-infra:supabasePublishableKey "..."  # if returned
 */
const projectRef = process.argv[2];
const token = process.env.SUPABASE_ACCESS_TOKEN;

if (!projectRef || !token) {
  console.error(
    "Usage: SUPABASE_ACCESS_TOKEN=sbp_... node infra/scripts/fetch-supabase-api-keys.mjs <project_ref>",
  );
  process.exit(1);
}

const base = "https://api.supabase.com/v1";

async function get(path) {
  const res = await fetch(`${base}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${path} ${res.status}: ${text}`);
  }
  return res.json();
}

async function main() {
  const keys = await get(`/projects/${projectRef}/api-keys`);
  const legacy = keys?.filter?.((k) => k.name === "anon" || k.name === "service_role") ?? keys;
  const publishable = keys?.find?.((k) => k.type === "publishable" || k.name === "publishable");

  console.log(JSON.stringify({ projectRef, keys: legacy, publishable }, null, 2));
  console.error("\nSet these as Pulumi secrets on stack production, then run pulumi up again.");
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
