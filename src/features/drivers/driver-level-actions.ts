"use server";

import { callAdminFunction } from "@/lib/firebase/callable";
import { requireMutationAuth } from "@/lib/auth/require-mutation-auth";
import { logAdminMutation, logAdminRead } from "@/lib/audit/log-admin-activity";

export type DriverLevelKey = "D" | "standard";
export type DriverLevelFilter = "all" | "D" | "standard" | "override";

export type DriverLevelMetrics = {
  month: string;
  active_days: number;
  mtd_verified_deliveries: number;
  target_dpd: number;
  required_orders: number;
  gap: number;
  dpd: number | null;
  days_elapsed: number;
};

export type DriverLevelRow = {
  driver_id: string;
  driver_code: string | null;
  employee_id: string | null;
  driver_name: string | null;
  auto_level: DriverLevelKey;
  level: DriverLevelKey;
  override_level: DriverLevelKey | null;
  override_reason: string | null;
  override_updated_at: string | null;
  override_by_name: string | null;
  classified: boolean;
  metrics: DriverLevelMetrics;
};

export type DriverLevelListResult = {
  month: string;
  rows: DriverLevelRow[];
  total: number;
  counts: { total: number; d: number; standard: number; overridden: number; unclassified: number };
};

type ActionError = "not_authorized" | "not_configured" | "invalid_input" | "unknown";

function mapError(error: { message?: string } | null): ActionError {
  const text = (error?.message ?? "").toLowerCase();
  if (
    text.includes("not_authorized") ||
    text.includes("permission_denied") ||
    text.includes("unauthenticated")
  ) {
    return "not_authorized";
  }
  if (text.includes("not_configured")) return "not_configured";
  if (text.includes("invalid")) return "invalid_input";
  return "unknown";
}

function asRow(raw: unknown): DriverLevelRow | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const metrics = (row.metrics ?? {}) as Record<string, unknown>;
  const id = typeof row.driver_id === "string" ? row.driver_id : "";
  if (!id) return null;
  const level = row.level === "D" ? "D" : "standard";
  const auto = row.auto_level === "D" ? "D" : "standard";
  return {
    driver_id: id,
    driver_code: typeof row.driver_code === "string" ? row.driver_code : null,
    employee_id: typeof row.employee_id === "string" ? row.employee_id : null,
    driver_name: typeof row.driver_name === "string" ? row.driver_name : null,
    auto_level: auto,
    level,
    override_level: row.override_level === "D" || row.override_level === "standard" ? row.override_level : null,
    override_reason: typeof row.override_reason === "string" ? row.override_reason : null,
    override_updated_at: typeof row.override_updated_at === "string" ? row.override_updated_at : null,
    override_by_name: typeof row.override_by_name === "string" ? row.override_by_name : null,
    classified: row.classified === true,
    metrics: {
      month: typeof metrics.month === "string" ? metrics.month : "",
      active_days: Number(metrics.active_days ?? 0),
      mtd_verified_deliveries: Number(metrics.mtd_verified_deliveries ?? 0),
      target_dpd: Number(metrics.target_dpd ?? 0),
      required_orders: Number(metrics.required_orders ?? 0),
      gap: Number(metrics.gap ?? 0),
      dpd: metrics.dpd == null ? null : Number(metrics.dpd),
      days_elapsed: Number(metrics.days_elapsed ?? 0),
    },
  };
}

export async function listDriverLevels(input: {
  level?: DriverLevelFilter;
  driverId?: string;
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<{ data: DriverLevelListResult | null; error: ActionError | null }> {
  const { data, error } = await callAdminFunction<DriverLevelListResult>("adminListDriverLevels", {
    level: input.level && input.level !== "all" ? input.level : undefined,
    driverId: input.driverId,
    search: input.search,
    limit: input.limit ?? 500,
    offset: input.offset ?? 0,
    sort: "level_first",
  });
  if (error || !data) return { data: null, error: mapError(error) };
  const rows = Array.isArray(data.rows) ? data.rows.map(asRow).filter((row): row is DriverLevelRow => Boolean(row)) : [];
  void logAdminRead("drivers", "driver-levels", { requestId: input.driverId });
  return {
    data: {
      month: data.month,
      rows,
      total: Number(data.total ?? rows.length),
      counts: data.counts ?? { total: rows.length, d: 0, standard: 0, overridden: 0, unclassified: 0 },
    },
    error: null,
  };
}

export async function setDriverLevelOverride(input: {
  driverId: string;
  level: "D" | "standard" | "clear";
  reason?: string;
}): Promise<{ ok: true; level: string } | { ok: false; error: ActionError }> {
  const auth = await requireMutationAuth("drivers.manage");
  if ("error" in auth) return { ok: false, error: auth.error === "not_configured" ? "not_configured" : "not_authorized" };
  const { data, error } = await callAdminFunction<{ ok: boolean; level: string }>("adminSetDriverLevelOverride", {
    driverId: input.driverId,
    level: input.level,
    reason: input.reason?.trim() || undefined,
  });
  if (error || !data?.ok) {
    void logAdminMutation({
      action: "update",
      entityType: "drivers",
      entityId: input.driverId,
      routeName: "driver-levels",
      success: false,
      errorMessage: error?.message ?? "unknown",
    });
    return { ok: false, error: mapError(error) };
  }
  void logAdminMutation({
    action: "update",
    entityType: "drivers",
    entityId: input.driverId,
    routeName: "driver-levels",
    after: { level: input.level },
  });
  return { ok: true, level: data.level };
}

export async function evaluateDriverLevels(): Promise<
  { ok: true; evaluated: number; notified: number } | { ok: false; error: ActionError }
> {
  const auth = await requireMutationAuth("drivers.manage");
  if ("error" in auth) return { ok: false, error: auth.error === "not_configured" ? "not_configured" : "not_authorized" };
  const { data, error } = await callAdminFunction<{
    rows?: number;
    notified?: number;
  }>("adminEvaluateDriverLevelsSweep", { notify: true });
  if (error || !data) return { ok: false, error: mapError(error) };
  void logAdminMutation({
    action: "update",
    entityType: "drivers",
    routeName: "driver-levels",
    after: { rows: data.rows ?? 0, notified: data.notified ?? 0 },
  });
  return { ok: true, evaluated: Number(data.rows ?? 0), notified: Number(data.notified ?? 0) };
}
