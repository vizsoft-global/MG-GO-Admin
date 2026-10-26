"use server";

import { getSessionUser } from "@/lib/auth/get-session";
import { callAdminFunction } from "@/lib/firebase/callable";
import {
  emptyOperationsDashboard,
  normalizeOperationsDashboard,
  parseLeaveCsv,
  type LeaveImportRow,
  type OperationsDashboard,
} from "./shape";

function canView(permissions: ReadonlySet<string>, isSuperAdmin: boolean): boolean {
  return isSuperAdmin || permissions.has("operations_dashboard.view");
}

async function requireOpsView(): Promise<{ ok: true } | { ok: false }> {
  const session = await getSessionUser();
  if (!session || !canView(session.permissions, session.isSuperAdmin)) return { ok: false };
  return { ok: true };
}

export async function fetchOperationsDashboard(input: {
  projectKey?: string;
  month?: string;
  day?: string;
  from?: string;
  to?: string;
  zoneId?: string;
  vehicle?: string;
}): Promise<{ dashboard: OperationsDashboard; failed: boolean }> {
  const gate = await requireOpsView();
  if (!gate.ok) return { dashboard: emptyOperationsDashboard(), failed: true };
  const args: Record<string, unknown> = {};
  if (input.projectKey) args.projectKey = input.projectKey;
  if (input.month) args.month = input.month;
  if (input.day) args.day = input.day;
  if (input.from) args.from = input.from;
  if (input.to) args.to = input.to;
  if (input.zoneId) args.zoneId = input.zoneId;
  if (input.vehicle) args.vehicle = input.vehicle;
  const { data, error } = await callAdminFunction<unknown>("adminOperationsDashboard", args);
  if (error || data == null) return { dashboard: emptyOperationsDashboard(), failed: true };
  return { dashboard: normalizeOperationsDashboard(data), failed: false };
}

export async function upsertLeavePlan(input: LeaveImportRow): Promise<{ error?: string }> {
  const gate = await requireOpsView();
  if (!gate.ok) return { error: "not_authorized" };
  const { error } = await callAdminFunction("adminUpsertLeavePlan", { ...input });
  if (error) return { error: error.message || "save_failed" };
  return {};
}

export async function setLeavePlanStatus(input: {
  id: string;
  status: string;
}): Promise<{ error?: string }> {
  const gate = await requireOpsView();
  if (!gate.ok) return { error: "not_authorized" };
  const { error } = await callAdminFunction("adminSetLeavePlanStatus", {
    id: input.id,
    status: input.status,
  });
  if (error) return { error: error.message || "save_failed" };
  return {};
}

export async function deleteLeavePlan(id: string): Promise<{ error?: string }> {
  const gate = await requireOpsView();
  if (!gate.ok) return { error: "not_authorized" };
  const { error } = await callAdminFunction("adminDeleteLeavePlan", { id });
  if (error) return { error: error.message || "save_failed" };
  return {};
}

export async function importLeavePlans(
  csv: string,
): Promise<{ error?: string; imported?: number; failed?: number }> {
  const gate = await requireOpsView();
  if (!gate.ok) return { error: "not_authorized" };
  const parsed = parseLeaveCsv(csv);
  if ("error" in parsed) return { error: parsed.error === "empty" ? "empty_csv" : "invalid_csv" };
  const { data, error } = await callAdminFunction<{ written?: number; errors?: unknown[] }>(
    "adminImportLeavePlans",
    { csv, rows: parsed.rows },
  );
  if (error) return { error: error.message || "save_failed" };
  const failed = Array.isArray(data?.errors) ? data.errors.length : 0;
  const imported = typeof data?.written === "number" ? data.written : parsed.rows.length;
  if (failed > 0) return { imported, failed, error: "partial" };
  return { imported };
}
