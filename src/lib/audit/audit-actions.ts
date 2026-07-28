"use server";

import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import type { AdminActivityAction } from "./log-admin-activity";
import { logAdminMutation } from "./log-admin-activity";

export type AdminActivityLogRow = {
  id: string;
  admin_user_id: string | null;
  admin_role_slug: string | null;
  admin_name: string | null;
  action: AdminActivityAction;
  entity_type: string | null;
  entity_id: string | null;
  page_path: string | null;
  route_name: string | null;
  success: boolean;
  error_message: string | null;
  context: Record<string, unknown>;
  before_state: Record<string, unknown> | null;
  after_state: Record<string, unknown> | null;
  changed_fields: string[];
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
};

export type AdminActivityLogFilters = {
  startDate?: string;
  endDate?: string;
  action?: AdminActivityAction;
  entityType?: string;
  adminUserId?: string;
  search?: string;
  limit?: number;
  offset?: number;
};

async function requireAuditView() {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, "audit.view", session.isSuperAdmin)
  ) {
    return { error: "not_authorized" as const };
  }
  return { session };
}

export async function listAdminActivityLogs(
  filters: AdminActivityLogFilters = {},
): Promise<{ rows: AdminActivityLogRow[]; total: number } | { error: string }> {
  const auth = await requireAuditView();
  if ("error" in auth) return { error: "not_authorized" };

  const supabase = await createClient();
  const limit = Math.min(filters.limit ?? 50, 200);
  const offset = filters.offset ?? 0;

  let query = supabase
    .from("admin_activity_logs")
    .select(
      "id, admin_user_id, admin_role_slug, action, entity_type, entity_id, page_path, route_name, success, error_message, context, before_state, after_state, changed_fields, ip_address, user_agent, created_at",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (filters.startDate) {
    query = query.gte("created_at", `${filters.startDate}T00:00:00.000Z`);
  }
  if (filters.endDate) {
    query = query.lte("created_at", `${filters.endDate}T23:59:59.999Z`);
  }
  if (filters.action) {
    query = query.eq("action", filters.action);
  }
  if (filters.entityType) {
    query = query.eq("entity_type", filters.entityType);
  }
  if (filters.adminUserId) {
    query = query.eq("admin_user_id", filters.adminUserId);
  }
  if (filters.search?.trim()) {
    const term = `%${filters.search.trim()}%`;
    query = query.or(
      `entity_type.ilike.${term},entity_id.ilike.${term},route_name.ilike.${term},page_path.ilike.${term}`,
    );
  }

  const { data, error, count } = await query;
  if (error) return { error: "fetch_failed" };

  const userIds = [...new Set((data ?? []).map((r) => r.admin_user_id).filter(Boolean))] as string[];
  const nameById = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", userIds);
    for (const p of profiles ?? []) {
      if (p.full_name) nameById.set(p.id, p.full_name);
    }
  }

  const rows: AdminActivityLogRow[] = (data ?? []).map((row) => ({
    id: row.id,
    admin_user_id: row.admin_user_id,
    admin_role_slug: row.admin_role_slug,
    admin_name: row.admin_user_id ? nameById.get(row.admin_user_id) ?? null : null,
    action: row.action as AdminActivityAction,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    page_path: row.page_path,
    route_name: row.route_name,
    success: row.success,
    error_message: row.error_message,
    context: (row.context as Record<string, unknown>) ?? {},
    before_state: row.before_state as Record<string, unknown> | null,
    after_state: row.after_state as Record<string, unknown> | null,
    changed_fields: row.changed_fields ?? [],
    ip_address: row.ip_address,
    user_agent: row.user_agent,
    created_at: row.created_at,
  }));

  return { rows, total: count ?? rows.length };
}

async function requireAuditExport() {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, "audit.export", session.isSuperAdmin)
  ) {
    return { error: "not_authorized" as const };
  }
  return { session };
}

export async function exportAdminActivityLogsCsv(
  filters: AdminActivityLogFilters = {},
): Promise<{ csv: string } | { error: string }> {
  const auth = await requireAuditExport();
  if ("error" in auth) return { error: "not_authorized" };

  const result = await listAdminActivityLogs({ ...filters, limit: 5000, offset: 0 });
  if ("error" in result) return result;

  void logAdminMutation({
    action: "export",
    entityType: "admin_activity_logs",
    routeName: "exportAdminActivityLogsCsv",
    context: { row_count: result.rows.length, filters },
  });

  const header = [
    "created_at",
    "admin_name",
    "admin_role",
    "action",
    "entity_type",
    "entity_id",
    "route_name",
    "success",
    "changed_fields",
  ];
  const lines = [header.join(",")];
  for (const row of result.rows) {
    lines.push(
      [
        row.created_at,
        csvEscape(row.admin_name ?? ""),
        csvEscape(row.admin_role_slug ?? ""),
        row.action,
        csvEscape(row.entity_type ?? ""),
        csvEscape(row.entity_id ?? ""),
        csvEscape(row.route_name ?? ""),
        row.success ? "true" : "false",
        csvEscape(row.changed_fields.join(";")),
      ].join(","),
    );
  }
  return { csv: "\uFEFF" + lines.join("\n") };
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}
