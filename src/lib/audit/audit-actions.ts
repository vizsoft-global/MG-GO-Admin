"use server";

import type { DocumentData, Firestore, Query } from "firebase-admin/firestore";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { COLLECTIONS } from "@/lib/firebase/db";
import { staffDb } from "@/lib/firebase/staff-db";
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

const ACTIONS = new Set<AdminActivityAction>([
  "create",
  "update",
  "delete",
  "view",
  "read",
  "auth",
  "export",
  "recalculate",
]);

function iso(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  if (
    value &&
    typeof value === "object" &&
    "toDate" in value &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return "";
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asAction(value: unknown): AdminActivityAction {
  return typeof value === "string" && ACTIONS.has(value as AdminActivityAction)
    ? (value as AdminActivityAction)
    : "view";
}

function rowFromDoc(id: string, data: DocumentData): AdminActivityLogRow {
  const changed = Array.isArray(data.changed_fields)
    ? data.changed_fields.filter((field): field is string => typeof field === "string")
    : [];
  return {
    id: text(data.id) ?? id,
    admin_user_id: text(data.admin_user_id),
    admin_role_slug: text(data.admin_role_slug),
    admin_name: null,
    action: asAction(data.action),
    entity_type: text(data.entity_type),
    entity_id: text(data.entity_id),
    page_path: text(data.page_path),
    route_name: text(data.route_name),
    success: data.success !== false,
    error_message: text(data.error_message),
    context: record(data.context) ?? {},
    before_state: record(data.before_state),
    after_state: record(data.after_state),
    changed_fields: changed,
    ip_address: text(data.ip_address),
    user_agent: text(data.user_agent),
    created_at: iso(data.created_at),
  };
}

function includesFold(value: string | null, needle: string): boolean {
  return (value ?? "").toLowerCase().includes(needle);
}

function matchesFilters(row: AdminActivityLogRow, filters: AdminActivityLogFilters, needle: string): boolean {
  if (filters.action && row.action !== filters.action) return false;
  if (filters.entityType && row.entity_type !== filters.entityType) return false;
  if (filters.adminUserId && row.admin_user_id !== filters.adminUserId) return false;
  if (filters.startDate && row.created_at < `${filters.startDate}T00:00:00.000Z`) return false;
  if (filters.endDate && row.created_at > `${filters.endDate}T23:59:59.999Z`) return false;
  if (
    needle &&
    !includesFold(row.entity_type, needle) &&
    !includesFold(row.entity_id, needle) &&
    !includesFold(row.route_name, needle) &&
    !includesFold(row.page_path, needle)
  ) {
    return false;
  }
  return true;
}

async function attachNames(db: Firestore, rows: AdminActivityLogRow[]): Promise<void> {
  const userIds = [...new Set(rows.map((row) => row.admin_user_id).filter((id): id is string => Boolean(id)))];
  if (userIds.length === 0) return;
  const nameById = new Map<string, string>();
  for (let i = 0; i < userIds.length; i += 100) {
    const refs = userIds.slice(i, i + 100).map((id) => db.collection(COLLECTIONS.profiles).doc(id));
    const snaps = await db.getAll(...refs);
    for (const snap of snaps) {
      const name = text(snap.data()?.full_name);
      if (name) nameById.set(snap.id, name);
    }
  }
  for (const row of rows) {
    row.admin_name = row.admin_user_id ? (nameById.get(row.admin_user_id) ?? null) : null;
  }
}

function filteredQuery(db: Firestore, filters: AdminActivityLogFilters): Query {
  let query: Query = db.collection(COLLECTIONS.adminActivityLogs);
  if (filters.action) query = query.where("action", "==", filters.action);
  if (filters.entityType) query = query.where("entity_type", "==", filters.entityType);
  if (filters.adminUserId) query = query.where("admin_user_id", "==", filters.adminUserId);
  if (filters.startDate) {
    query = query.where("created_at", ">=", new Date(`${filters.startDate}T00:00:00.000Z`));
  }
  if (filters.endDate) {
    query = query.where("created_at", "<=", new Date(`${filters.endDate}T23:59:59.999Z`));
  }
  return query.orderBy("created_at", "desc");
}

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

  const db = await staffDb();
  if (!db) return { error: "fetch_failed" };

  const limit = Math.min(filters.limit ?? 50, 200);
  const offset = filters.offset ?? 0;
  const needle = filters.search?.trim().toLowerCase() ?? "";

  try {
    let rows: AdminActivityLogRow[] = [];
    let total = 0;

    if (needle) {
      const snap = await db
        .collection(COLLECTIONS.adminActivityLogs)
        .orderBy("created_at", "desc")
        .limit(2000)
        .get();
      const matched = snap.docs
        .map((doc) => rowFromDoc(doc.id, doc.data()))
        .filter((row) => matchesFilters(row, filters, needle));
      total = matched.length;
      rows = matched.slice(offset, offset + limit);
    } else {
      const query = filteredQuery(db, filters);
      const [countSnap, page] = await Promise.all([
        query.count().get(),
        query.offset(offset).limit(limit).get(),
      ]);
      total = countSnap.data().count;
      rows = page.docs.map((doc) => rowFromDoc(doc.id, doc.data()));
    }

    await attachNames(db, rows);
    return { rows, total };
  } catch {
    try {
      const snap = await db
        .collection(COLLECTIONS.adminActivityLogs)
        .orderBy("created_at", "desc")
        .limit(2000)
        .get();
      const matched = snap.docs
        .map((doc) => rowFromDoc(doc.id, doc.data()))
        .filter((row) => matchesFilters(row, filters, needle));
      const rows = matched.slice(offset, offset + limit);
      await attachNames(db, rows);
      return { rows, total: matched.length };
    } catch {
      return { error: "fetch_failed" };
    }
  }
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
