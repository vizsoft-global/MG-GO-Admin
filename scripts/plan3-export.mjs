#!/usr/bin/env node
/**
 * Plan 3: page public tables through the service role into JSONL.
 * Writes outside the git repo. Prints table names and counts only.
 */
import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve("C:/Users/Admin/Desktop/Vizsoft/dpd-plan3-dump/jsonl");

const SKIP = new Set([
  "_p1_def",
  "_p1_diag",
  "driver_location_events",
  "driver_telemetry_events",
  "fleet_events",
  "driver_operation_events",
  "geofence_events",
]);

/** pk columns; empty means no keyset (offset). */
const TABLES = {
  _plan3_auth_export: ["id"],
  admin_activity_logs: ["id"],
  admin_allowlist: ["email"],
  admin_permissions: ["slug"],
  admin_role_permissions: ["role_id", "permission_slug"],
  admin_role_ui_defaults: ["role_id", "preference_key"],
  admin_roles: ["id"],
  admin_ui_preferences: ["user_id", "preference_key"],
  admin_user_permissions: ["user_id", "permission_slug"],
  app_page_registry: ["id"],
  app_releases: ["id"],
  app_settings: ["id"],
  app_themes: ["id"],
  appointment_slots: ["id"],
  appointments: ["id"],
  asset_assignment_attachments: ["id"],
  asset_assignments: ["id"],
  asset_catalog: ["id"],
  attendance_exception_actions: ["id"],
  attendance_logs: ["id"],
  companies: ["id"],
  complaint_categories: ["id"],
  custom_field_definitions: ["id"],
  deliveries: ["id"],
  delivery_rule_scopes: ["id"],
  delivery_rules: ["id"],
  delivery_sla_overrides: ["id"],
  delivery_verifications: ["id"],
  document_tracking: ["id"],
  driver_app_version_history: ["id"],
  driver_assets: ["id"],
  driver_assignment_events: ["id"],
  driver_attendance: ["id"],
  driver_change_events: ["id"],
  driver_daily_shifts: ["id"],
  driver_device_sessions: ["id"],
  driver_documents: ["id"],
  driver_dpd_shift_notices: ["driver_id", "shift_date", "kind"],
  driver_earnings_daily: ["id"],
  driver_group_members: ["group_id", "driver_id"],
  driver_groups: ["id"],
  driver_home_banners: ["id"],
  driver_import_batches: ["id"],
  driver_intake_restaurants: ["intake_id", "restaurant_id"],
  driver_intakes: ["id"],
  driver_locations: ["driver_id"],
  driver_login_verifications: ["id"],
  driver_off_structure: ["driver_id", "period_month"],
  driver_payouts: ["id"],
  driver_performance_daily: ["driver_id", "log_date"],
  driver_performance_rating_notes: ["id"],
  driver_performance_ratings: ["id"],
  driver_push_tokens: ["id"],
  driver_restaurants: ["driver_id", "restaurant_id"],
  driver_restriction_reasons: ["id"],
  driver_security_events: ["id"],
  driver_sessions: ["id"],
  driver_telemetry_event_types: ["name"],
  driver_wallet_entries: ["id"],
  drivers: ["id"],
  esign_batch_rows: ["id"],
  esign_batches: ["id"],
  esign_categories: ["id"],
  esign_drafts: ["id"],
  esign_request_signers: ["id"],
  esign_requests: ["id"],
  esign_template_fields: ["id"],
  esign_templates: ["id"],
  fuel_fill_attachments: ["id"],
  fuel_fills: ["id"],
  fuel_withdrawn_overrides: ["driver_id", "vehicle_id", "month_key"],
  hygiene_submissions: ["id"],
  hygiene_tasks: ["id"],
  incentive_rule_scopes: ["id"],
  incentive_rule_tiers: ["id"],
  incentive_rules: ["id"],
  loan_tenure_options: ["id"],
  loan_terms: ["id"],
  locales: ["code"],
  menu_configs: ["id"],
  notification_analytics_daily: ["metric_date", "campaign_id"],
  notification_audience_snapshots: ["id"],
  notification_automation_events: ["id"],
  notification_automation_runs: ["id"],
  notification_automations: ["id"],
  notification_campaigns: ["id"],
  notification_dedup_keys: ["id"],
  notification_dispatch_items: ["id"],
  notification_dispatch_runs: ["id"],
  notification_events: ["id"],
  notification_remote_config: ["id"],
  notification_templates: ["id"],
  notifications: ["id"],
  offers: ["id"],
  order_recon_rows: ["id"],
  order_recon_runs: ["id"],
  order_recon_store_aliases: ["alias"],
  partners: ["id"],
  payout_runs: ["id"],
  payroll_client_rules: ["id"],
  payroll_clients: ["key"],
  payroll_column_config: ["column_key"],
  payroll_manual_adjustments: ["id"],
  payroll_rule_audit_logs: ["id"],
  payroll_zone_metrics: ["zone_id", "period_month"],
  payroll_zone_settings: ["period_month"],
  performance_rating_criteria: ["id"],
  performance_rating_team_members: ["id"],
  performance_rating_teams: ["key"],
  performance_score_components: ["key"],
  performance_target_dpd: ["id"],
  profiles: ["id"],
  request_approval_step_templates: ["id"],
  request_approval_steps: ["id"],
  request_attachments: ["id"],
  request_clarifications: ["id"],
  request_comments: ["id"],
  request_confidential_views: ["request_id", "viewer_id"],
  request_department_members: ["id"],
  request_departments: ["id"],
  request_field_definitions: ["id"],
  request_forwards: ["id"],
  request_staff_access: ["id"],
  request_type_definitions: ["id"],
  requests: ["id"],
  restaurant_geofences: ["id"],
  restaurants: ["id"],
  source_companies: ["key"],
  storage_uploads: ["id"],
  support_messages: ["id"],
  support_threads: ["id"],
  support_tickets: ["id"],
  vehicle_accidents: ["id"],
  vehicle_documents: ["id"],
  vehicle_handovers: ["id"],
  vehicle_import_batches: ["id"],
  vehicle_import_rows: ["id"],
  vehicle_services: ["id"],
  vehicle_types: ["key"],
  vehicle_use_types: ["key"],
  vehicles: ["id"],
  verification_balances: ["driver_id", "restaurant_id"],
  verification_import_batches: ["id"],
  visit_blocked_dates: ["id"],
  visit_booking_notes: ["id"],
  visit_bookings: ["id"],
  visit_branches: ["id"],
  visit_departments: ["id"],
  visit_slots: ["id"],
  wrong_actions: ["id"],
  zone_geofence_settings: ["zone_id"],
  zones: ["id"],
};

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

function quoteFilter(value) {
  const s = String(value);
  if (/[,.():"\\]/.test(s) || /\s/.test(s)) return `"${s.replaceAll('"', '\\"')}"`;
  return s;
}

async function fetchPage(base, key, table, pk, cursor, offset) {
  const params = new URLSearchParams();
  params.set("select", "*");
  params.set("limit", "1000");
  if (pk.length === 1) {
    params.set("order", `${pk[0]}.asc`);
    if (cursor !== undefined) params.set(pk[0], `gt.${quoteFilter(cursor)}`);
  } else {
    params.set("offset", String(offset));
    if (pk.length) params.set("order", pk.map((c) => `${c}.asc`).join(","));
  }
  const url = `${base}/rest/v1/${encodeURIComponent(table)}?${params}`;
  let lastErr = "fetch_failed";
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
      },
    });
    if (res.ok) return res.json();
    lastErr = `http_${res.status}`;
    if (res.status !== 429 && res.status < 500) {
      const text = await res.text();
      let detail = lastErr;
      try {
        const body = JSON.parse(text);
        detail = `${body.code ?? lastErr} ${body.message ?? ""}`.trim();
      } catch {
        detail = text.slice(0, 180) || lastErr;
      }
      throw new Error(detail.replace(/[\r\n]/g, " ").slice(0, 200));
    }
    await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
  }
  throw new Error(lastErr);
}

async function exportTable(base, key, table, pk) {
  const fileName = table === "_plan3_auth_export" ? "auth_users.jsonl" : `${table}.jsonl`;
  const stream = createWriteStream(resolve(outDir, fileName), { flags: "w" });
  let rows = 0;
  let cursor;
  let offset = 0;
  for (;;) {
    const page = await fetchPage(base, key, table, pk, cursor, offset);
    if (!Array.isArray(page)) throw new Error("not_array");
    for (const row of page) {
      stream.write(`${JSON.stringify(row)}\n`);
      rows += 1;
    }
    if (page.length < 1000) break;
    if (pk.length === 1) {
      const next = page[page.length - 1][pk[0]];
      if (next === undefined || next === cursor) throw new Error("cursor_stuck");
      cursor = next;
    } else {
      offset += page.length;
    }
  }
  await new Promise((resolveClose, reject) => {
    stream.end(() => resolveClose());
    stream.on("error", reject);
  });
  return rows;
}

const env = loadEnv();
const base = env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!base || !key) {
  console.log("missing_supabase_env");
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
const manifest = {
  started: new Date().toISOString(),
  skipped: [...SKIP],
  tables: {},
  errors: {},
};

const only = new Set(process.argv.slice(2));
const names = Object.keys(TABLES).filter((name) => only.size === 0 || only.has(name));
names.sort((a, b) => (a === "_plan3_auth_export" ? -1 : b === "_plan3_auth_export" ? 1 : a.localeCompare(b)));

for (const table of names) {
  if (SKIP.has(table)) continue;
  try {
    const rows = await exportTable(base, key, table, TABLES[table]);
    manifest.tables[table] = rows;
    console.log(`exported ${table} rows=${rows}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "error";
    manifest.errors[table] = message.slice(0, 200);
    console.log(`failed ${table} ${message.slice(0, 120)}`);
  }
}

manifest.finished = new Date().toISOString();
const manifestName = only.size ? "manifest-retry.json" : "manifest.json";
writeFileSync(resolve(outDir, manifestName), JSON.stringify(manifest, null, 2));
console.log(`export_done tables=${Object.keys(manifest.tables).length} errors=${Object.keys(manifest.errors).length}`);
