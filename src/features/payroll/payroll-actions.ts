"use server";

import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import type { Json } from "@/types/database";
import { kuwaitToday } from "@/features/performance/performance-formulas";
import { EMPTY_OPS_SLICERS } from "@/features/performance/performance-ops-types";
import { logAdminActivity } from "@/lib/audit/log-admin-activity";
import {
  assertPayrollMonth,
  attendanceLogHours,
  kuwaitMonthBounds,
  payrollMonths,
} from "./payroll-formulas";
import {
  assemblePayrollSnapshot,
  decoratePayrollSnapshot,
  kuwaitYmdFromIso,
  parseClientConfig,
  snapshotFromRpc,
  type RawOffStructure,
  type RawPayrollDriver,
  type RawPayrollRequest,
  type RawPayrollRuleSnapshot,
} from "./payroll-snapshot";
import { parseRules } from "./payroll-rules-engine";
import type {
  OffStructureBulkResult,
  PayrollAdjustmentAuditRow,
  PayrollAdjustmentCell,
  PayrollAdjustmentResult,
  PayrollRuleConfigSnapshot,
  PayrollSlicers,
  PayrollSnapshot,
} from "./payroll-types";

function requirePayrollView() {
  return requirePayrollPermission("payroll.view");
}

async function requirePayrollPermission(
  slug: "payroll.view" | "payroll.export" | "payroll.manage",
) {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, slug, session.isSuperAdmin)
  ) {
    throw new Error("not_authorized");
  }
  return session;
}

async function fetchAll<T>(
  run: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string; code?: string } | null }>,
): Promise<T[]> {
  const page = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += page) {
    const { data, error } = await run(from, from + page - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < page) break;
  }
  return out;
}

function kuwaitBoundIso(ymd: string): string {
  return `${ymd}T00:00:00+03:00`;
}

function emptyToUndef(values: string[]): string[] | undefined {
  return values.length ? values : undefined;
}

function payloadStr(payload: unknown, key: string): string | null {
  if (!payload || typeof payload !== "object") return null;
  const value = (payload as Record<string, unknown>)[key];
  if (value == null) return null;
  const s = String(value).trim();
  return s.length ? s : null;
}

function isMissingRpc(error: { code?: string; message?: string }): boolean {
  const code = error.code ?? "";
  const message = error.message ?? "";
  return (
    code === "PGRST202" ||
    message.includes("Could not find the function")
  );
}

export async function fetchPayrollMonthSnapshot(input: {
  monthKey: string;
  slicers?: PayrollSlicers;
}): Promise<PayrollSnapshot> {
  await requirePayrollView();
  const today = kuwaitToday();
  const month = assertPayrollMonth(input.monthKey, today);
  const slicers = input.slicers ?? EMPTY_OPS_SLICERS;
  const supabase = await createClient();

  // The rule snapshot is the source of truth: it already resolves hours,
  // requests, recon orders, per-month rules, zone category and adjustments in
  // one call, and the client engine re-evaluates it (the two cannot disagree).
  const rule = await supabase.rpc("admin_payroll_rule_snapshot", {
    p_month: `${month.key}-01`,
    p_zone_ids: emptyToUndef(slicers.zoneIds),
    p_project_keys: emptyToUndef(slicers.projectKeys),
    p_vehicle_keys: emptyToUndef(slicers.vehicleKeys),
    p_nationalities: emptyToUndef(slicers.nationalities),
    p_source_types: emptyToUndef(slicers.sourceTypes),
    p_source_companies: emptyToUndef(slicers.sourceCompanies),
    p_restaurant_ids: emptyToUndef(slicers.restaurantIds),
  });
  if (!rule.error && rule.data) {
    return snapshotFromRpc(rule.data as RawPayrollRuleSnapshot);
  }
  if (rule.error && !isMissingRpc(rule.error)) {
    throw new Error(rule.error.message);
  }

  const { data, error } = await supabase.rpc("admin_payroll_month_snapshot", {
    p_month: `${month.key}-01`,
    p_zone_ids: emptyToUndef(slicers.zoneIds),
    p_project_keys: emptyToUndef(slicers.projectKeys),
    p_vehicle_keys: emptyToUndef(slicers.vehicleKeys),
    p_nationalities: emptyToUndef(slicers.nationalities),
    p_source_types: emptyToUndef(slicers.sourceTypes),
    p_source_companies: emptyToUndef(slicers.sourceCompanies),
    p_restaurant_ids: emptyToUndef(slicers.restaurantIds),
  });

  if (!error && data) {
    return decoratePayrollSnapshot(data as PayrollSnapshot);
  }
  if (error && !isMissingRpc(error)) {
    throw new Error(error.message);
  }

  return assembleFromTables(supabase, today, month.key, slicers);
}

async function assembleFromTables(
  supabase: Awaited<ReturnType<typeof createClient>>,
  today: string,
  monthKey: string,
  slicers: PayrollSlicers,
): Promise<PayrollSnapshot> {
  const { startIso, endExclusiveIso } = kuwaitMonthBounds(monthKey);
  const startUtc = kuwaitBoundIso(startIso);
  const endUtc = kuwaitBoundIso(endExclusiveIso);

  const [driverRows, profileRows, zoneRows, vehicleRows, mapRows, restaurantRows, logRows, requestRows, offRows] =
    await Promise.all([
      fetchAll<{
        id: string;
        employee_id: string | null;
        driver_code: string | null;
        zone_id: string | null;
        project_key: string | null;
        nationality: string | null;
        rider_category: string | null;
        source_company: string | null;
        status: string | null;
        vehicle_id: string | null;
      }>((from, to) =>
        supabase
          .from("drivers")
          .select(
            "id, employee_id, driver_code, zone_id, project_key, nationality, rider_category, source_company, status, vehicle_id",
          )
          .is("archived_at", null)
          .range(from, to),
      ),
      fetchAll<{ id: string; full_name: string | null }>((from, to) =>
        supabase.from("profiles").select("id, full_name").range(from, to),
      ),
      fetchAll<{ id: string; name: string }>((from, to) =>
        supabase.from("zones").select("id, name").range(from, to),
      ),
      fetchAll<{ id: string; vehicle_type_key: string | null }>((from, to) =>
        supabase.from("vehicles").select("id, vehicle_type_key").range(from, to),
      ),
      fetchAll<{ driver_id: string; restaurant_id: string }>((from, to) =>
        supabase
          .from("driver_restaurants")
          .select("driver_id, restaurant_id")
          .order("restaurant_id", { ascending: true })
          .range(from, to),
      ),
      fetchAll<{ id: string; name: string }>((from, to) =>
        supabase.from("restaurants").select("id, name").range(from, to),
      ),
      fetchAll<{
        driver_id: string;
        check_in_at: string | null;
        check_out_at: string | null;
      }>((from, to) =>
        supabase
          .from("attendance_logs")
          .select("driver_id, check_in_at, check_out_at")
          .gte("check_in_at", startUtc)
          .lt("check_in_at", endUtc)
          .range(from, to),
      ),
      fetchAll<{
        id: string;
        request_code: string;
        driver_id: string;
        request_type: string;
        status: string;
        start_date: string | null;
        end_date: string | null;
        created_at: string;
        payload: unknown;
        current_step_label: string | null;
      }>((from, to) =>
        supabase
          .from("requests")
          .select(
            "id, request_code, driver_id, request_type, status, start_date, end_date, created_at, payload, current_step_label",
          )
          .or(
            [
              `and(start_date.not.is.null,start_date.lt.${endExclusiveIso},end_date.gte.${startIso})`,
              `and(start_date.not.is.null,start_date.lt.${endExclusiveIso},end_date.is.null,start_date.gte.${startIso})`,
              `and(start_date.is.null,end_date.gte.${startIso},created_at.lt.${endUtc})`,
              `and(start_date.is.null,end_date.is.null,created_at.gte.${startUtc},created_at.lt.${endUtc})`,
            ].join(","),
          )
          .range(from, to),
      ),
      fetchAll<{
        driver_id: string;
        off_days: number;
        source: string;
      }>((from, to) =>
        supabase
          .from("driver_off_structure")
          .select("driver_id, off_days, source")
          .eq("period_month", `${monthKey}-01`)
          .range(from, to),
      ).catch(() => [] as Array<{
        driver_id: string;
        off_days: number;
        source: string;
      }>),
    ]);

  const names = new Map(profileRows.map((p) => [p.id, p.full_name]));
  const zones = new Map(zoneRows.map((z) => [z.id, z.name]));
  const vehicles = new Map(vehicleRows.map((v) => [v.id, v.vehicle_type_key]));
  const restaurants = new Map(restaurantRows.map((r) => [r.id, r.name]));
  const storeByDriver = new Map<string, string>();
  for (const row of mapRows) {
    if (!storeByDriver.has(row.driver_id)) {
      storeByDriver.set(row.driver_id, row.restaurant_id);
    }
  }

  const roster: RawPayrollDriver[] = driverRows.map((d) => {
    const restaurantId = storeByDriver.get(d.id) ?? null;
    return {
      id: d.id,
      name: names.get(d.id)?.trim() || "—",
      employeeId: d.employee_id,
      driverCode: d.driver_code,
      zoneId: d.zone_id,
      zoneName: d.zone_id ? zones.get(d.zone_id) ?? null : null,
      projectKey: d.project_key,
      nationality: d.nationality,
      sourceType: d.rider_category,
      sourceCompany: d.source_company,
      status: d.status,
      vehicleKey: d.vehicle_id ? vehicles.get(d.vehicle_id) ?? null : null,
      restaurantId,
      restaurantName: restaurantId ? restaurants.get(restaurantId) ?? null : null,
    };
  });

  const requestIds = requestRows.map((r) => r.id);
  const stepRows: Array<{
    request_id: string;
    step_order: number;
    step_name: string;
    role_key: string;
    status: string;
  }> = [];
  for (let i = 0; i < requestIds.length; i += 200) {
    const chunk = requestIds.slice(i, i + 200);
    const part = await fetchAll<{
      request_id: string;
      step_order: number;
      step_name: string;
      role_key: string;
      status: string;
    }>((from, to) =>
      supabase
        .from("request_approval_steps")
        .select("request_id, step_order, step_name, role_key, status")
        .in("request_id", chunk)
        .range(from, to),
    );
    stepRows.push(...part);
  }

  const stepByRequest = new Map<string, { stepName: string; roleKey: string }>();
  const grouped = new Map<string, typeof stepRows>();
  for (const step of stepRows) {
    const list = grouped.get(step.request_id) ?? [];
    list.push(step);
    grouped.set(step.request_id, list);
  }
  for (const [id, steps] of grouped) {
    const ordered = [...steps].sort((a, b) => a.step_order - b.step_order);
    const pending = ordered.find((s) => s.status === "pending");
    const pick = pending ?? ordered[ordered.length - 1];
    if (pick) stepByRequest.set(id, { stepName: pick.step_name, roleKey: pick.role_key });
  }

  const requests: RawPayrollRequest[] = requestRows.map((r) => {
    const step = stepByRequest.get(r.id);
    return {
      id: r.id,
      code: r.request_code,
      driverId: r.driver_id,
      requestType: r.request_type,
      status: r.status,
      startDate: r.start_date,
      endDate: r.end_date,
      createdDate: kuwaitYmdFromIso(r.created_at),
      leaveType: payloadStr(r.payload, "leave_type"),
      leaveSubtype: payloadStr(r.payload, "leave_subtype"),
      currentStepLabel: r.current_step_label ?? step?.stepName ?? null,
      roleKey: step?.roleKey ?? null,
    };
  });

  const offStructures: RawOffStructure[] = (offRows ?? []).map((row) => ({
    driverId: row.driver_id,
    offDays: row.off_days,
    source: row.source === "bulk_upload" ? "bulk_upload" : "manual",
  }));

  return decoratePayrollSnapshot(
    assemblePayrollSnapshot({
      today,
      monthKey,
      slicers,
      roster,
      checkIns: logRows.flatMap((l) =>
        l.check_in_at
          ? [
              {
                driverId: l.driver_id,
                date: kuwaitYmdFromIso(l.check_in_at),
                hours: attendanceLogHours(l.check_in_at, l.check_out_at),
              },
            ]
          : [],
      ),
      requests,
      offStructures,
    }),
  );
}

export async function setDriverOffStructure(input: {
  driverId: string;
  monthKey: string;
  offDays: number | null;
}): Promise<{ ok: true } | { error: string }> {
  await requirePayrollPermission("payroll.manage");
  const today = kuwaitToday();
  try {
    assertPayrollMonth(input.monthKey, today);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "invalid_month" };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_set_driver_off_structure", {
    p_driver_id: input.driverId,
    p_month: `${input.monthKey}-01`,
    p_off_days: input.offDays as number,
  });
  if (error) return { error: error.message };
  await logAdminActivity({
    action: "update",
    entityType: "driver_off_structure",
    entityId: input.driverId,
    pagePath: "/payroll",
    routeName: "payroll",
    after: {
      month: input.monthKey,
      offDays: input.offDays,
      result: data,
    },
  });
  return { ok: true };
}

export async function applyOffStructureBulk(input: {
  monthKey: string;
  rows: Array<{ driverKey: string; offDays: number }>;
}): Promise<OffStructureBulkResult | { error: string }> {
  await requirePayrollPermission("payroll.manage");
  const today = kuwaitToday();
  try {
    assertPayrollMonth(input.monthKey, today);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "invalid_month" };
  }
  if (!input.rows.length) return { error: "no_rows" };
  if (input.rows.length > 2000) return { error: "too_many_rows" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_bulk_set_driver_off_structure", {
    p_month: `${input.monthKey}-01`,
    p_rows: input.rows.map((row) => ({
      driver_key: row.driverKey,
      off_days: row.offDays,
    })),
  });
  if (error) return { error: error.message };
  const result = data as OffStructureBulkResult;
  await logAdminActivity({
    action: "update",
    entityType: "driver_off_structure",
    pagePath: "/payroll",
    routeName: "payroll",
    after: {
      month: input.monthKey,
      applied: result.applied,
      skipped: result.skipped,
    },
  });
  return result;
}

export async function fetchPayrollMonths(): Promise<{
  today: string;
  months: ReturnType<typeof payrollMonths>;
}> {
  await requirePayrollView();
  const today = kuwaitToday();
  return { today, months: payrollMonths(today) };
}

/* ------------------------------------------------------------------ */
/* Payroll v4 — client rules, zone efficiency, manual adjustments      */
/* ------------------------------------------------------------------ */

function parseRuleConfigSnapshot(raw: unknown): PayrollRuleConfigSnapshot {
  const payload = (raw ?? {}) as Record<string, unknown>;
  const clients = (Array.isArray(payload.clients) ? payload.clients : [])
    .map((item) => {
      const parsed = parseClientConfig(item);
      if (!parsed) return null;
      const o = (item ?? {}) as Record<string, unknown>;
      return {
        ...parsed,
        riderCount: Number(o.riderCount ?? 0),
        effectiveMonth: o.effectiveMonth ? String(o.effectiveMonth) : null,
        hasRulesForMonth: Boolean(o.hasRulesForMonth),
      };
    })
    .filter((c): c is PayrollRuleConfigSnapshot["clients"][number] => c !== null);

  const audit = (Array.isArray(payload.audit) ? payload.audit : []).map((item) => {
    const o = (item ?? {}) as Record<string, unknown>;
    return {
      id: String(o.id ?? ""),
      clientKey: o.clientKey ? String(o.clientKey) : null,
      periodMonth: o.periodMonth ? String(o.periodMonth) : null,
      entity: String(o.entity ?? ""),
      action: String(o.action ?? ""),
      actorName: String(o.actorName ?? "—"),
      createdAt: String(o.createdAt ?? ""),
      before: o.before ?? null,
      after: o.after ?? null,
    };
  });

  return {
    month: String(payload.month ?? ""),
    canManage: Boolean(payload.canManage),
    clients,
    rules: parseRules(payload.rules),
    audit,
  };
}

/** The Settings tab / zone panel payload for one month. */
export async function fetchPayrollRuleConfig(input: {
  monthKey: string;
}): Promise<PayrollRuleConfigSnapshot> {
  await requirePayrollView();
  const today = kuwaitToday();
  const month = assertPayrollMonth(input.monthKey, today);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_payroll_rule_config", {
    p_month: `${month.key}-01`,
  });
  if (error) throw new Error(error.message);
  return parseRuleConfigSnapshot(data);
}

/** Open (auto-copy / seed) the rule month, then return the config. */
export async function openPayrollRuleMonth(input: {
  monthKey: string;
}): Promise<PayrollRuleConfigSnapshot> {
  await requirePayrollPermission("payroll.manage");
  const today = kuwaitToday();
  const month = assertPayrollMonth(input.monthKey, today);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_open_payroll_rule_month", {
    p_month: `${month.key}-01`,
  });
  if (error) throw new Error(error.message);
  return parseRuleConfigSnapshot(data);
}

export async function savePayrollClient(input: {
  key: string;
  name: string;
  usesZone: boolean;
  usesOrders: boolean;
  usesHours: boolean;
  fullDayHours: number;
  halfDayHours: number;
  reducedHours: number;
  requiredHoursPerDay: number;
  defaultOffDays: number;
  defaultResult: string;
  goodThreshold: number;
  averageThreshold: number;
  sortOrder?: number | null;
}): Promise<{ error: string } | { ok: true }> {
  await requirePayrollPermission("payroll.manage");
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_save_payroll_client", {
    p_key: input.key,
    p_name: input.name,
    p_uses_zone: input.usesZone,
    p_uses_orders: input.usesOrders,
    p_uses_hours: input.usesHours,
    p_full_day_hours: input.fullDayHours,
    p_half_day_hours: input.halfDayHours,
    p_reduced_hours: input.reducedHours,
    p_required_hours_per_day: input.requiredHoursPerDay,
    p_default_off_days: input.defaultOffDays,
    p_default_result: input.defaultResult,
    p_good_threshold: input.goodThreshold,
    p_average_threshold: input.averageThreshold,
    p_sort_order: input.sortOrder ?? undefined,
  });
  if (error) return { error: error.message };
  await logAdminActivity({
    action: "update",
    entityType: "payroll_client",
    entityId: input.key,
    pagePath: "/payroll/settings",
    routeName: "payroll-settings",
    after: {
      name: input.name,
      usesZone: input.usesZone,
      usesOrders: input.usesOrders,
      usesHours: input.usesHours,
      fullDayHours: input.fullDayHours,
      halfDayHours: input.halfDayHours,
      reducedHours: input.reducedHours,
      requiredHoursPerDay: input.requiredHoursPerDay,
      defaultOffDays: input.defaultOffDays,
      defaultResult: input.defaultResult,
      goodThreshold: input.goodThreshold,
      averageThreshold: input.averageThreshold,
      sortOrder: input.sortOrder ?? null,
    },
  });
  return { ok: true };
}

export async function addPayrollClient(input: {
  name: string;
  usesZone: boolean;
  usesOrders: boolean;
  usesHours: boolean;
  copyFrom?: string | null;
  monthKey: string;
}): Promise<{ error: string } | { ok: true; config: PayrollRuleConfigSnapshot }> {
  await requirePayrollPermission("payroll.manage");
  const today = kuwaitToday();
  let month: string;
  try {
    month = assertPayrollMonth(input.monthKey, today).key;
  } catch (e) {
    return { error: e instanceof Error ? e.message : "invalid_month" };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_add_payroll_client", {
    p_name: input.name,
    p_uses_zone: input.usesZone,
    p_uses_orders: input.usesOrders,
    p_uses_hours: input.usesHours,
    p_copy_from: input.copyFrom ?? undefined,
    p_month: `${month}-01`,
  });
  if (error) return { error: error.message };
  await logAdminActivity({
    action: "create",
    entityType: "payroll_client",
    entityId: input.name,
    pagePath: "/payroll/settings",
    routeName: "payroll-settings",
    after: { name: input.name, copyFrom: input.copyFrom ?? null, month },
  });
  return { ok: true, config: parseRuleConfigSnapshot(data) };
}

export async function savePayrollClientRules(input: {
  clientKey: string;
  monthKey: string;
  rules: ReadonlyArray<{
    label: string;
    conditions: unknown;
    result: unknown;
    sortOrder: number;
  }>;
}): Promise<{ error: string } | { ok: true; config: PayrollRuleConfigSnapshot }> {
  await requirePayrollPermission("payroll.manage");
  const today = kuwaitToday();
  let month: string;
  try {
    month = assertPayrollMonth(input.monthKey, today).key;
  } catch (e) {
    return { error: e instanceof Error ? e.message : "invalid_month" };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_save_payroll_client_rules", {
    p_client_key: input.clientKey,
    p_month: `${month}-01`,
    p_rules: input.rules.map((rule) => ({
      label: rule.label,
      conditions: rule.conditions,
      result: rule.result,
      sortOrder: rule.sortOrder,
    })) as unknown as Json,
  });
  if (error) return { error: error.message };
  await logAdminActivity({
    action: "update",
    entityType: "payroll_client_rules",
    entityId: input.clientKey,
    pagePath: "/payroll/settings",
    routeName: "payroll-settings",
    after: { month, ruleCount: input.rules.length },
  });
  return { ok: true, config: parseRuleConfigSnapshot(data) };
}

export async function resetPayrollClientRules(input: {
  clientKey: string;
  monthKey: string;
}): Promise<{ error: string } | { ok: true; config: PayrollRuleConfigSnapshot }> {
  await requirePayrollPermission("payroll.manage");
  const today = kuwaitToday();
  let month: string;
  try {
    month = assertPayrollMonth(input.monthKey, today).key;
  } catch (e) {
    return { error: e instanceof Error ? e.message : "invalid_month" };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_reset_payroll_client_rules", {
    p_client_key: input.clientKey,
    p_month: `${month}-01`,
  });
  if (error) return { error: error.message };
  await logAdminActivity({
    action: "update",
    entityType: "payroll_client_rules",
    entityId: input.clientKey,
    pagePath: "/payroll/settings",
    routeName: "payroll-settings",
    after: { month, action: "reset_to_defaults" },
  });
  return { ok: true, config: parseRuleConfigSnapshot(data) };
}

/** Roll the previous completed month's zone figures forward and recompute. */
export async function recomputePayrollZoneMetrics(input: {
  monthKey: string;
}): Promise<{ error: string } | { ok: true; month: string; zones: unknown }> {
  await requirePayrollPermission("payroll.manage");
  const today = kuwaitToday();
  let month: string;
  try {
    month = assertPayrollMonth(input.monthKey, today).key;
  } catch (e) {
    return { error: e instanceof Error ? e.message : "invalid_month" };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_recompute_payroll_zone_metrics", {
    p_month: `${month}-01`,
  });
  if (error) return { error: error.message };
  const payload = (data ?? {}) as Record<string, unknown>;
  await logAdminActivity({
    action: "update",
    entityType: "payroll_zone_metrics",
    entityId: month,
    pagePath: "/payroll/settings",
    routeName: "payroll-settings",
    after: { month, reason: "recompute" },
  });
  return {
    ok: true,
    month: String(payload.month ?? month),
    zones: payload.zones ?? [],
  };
}

export async function savePayrollZoneOverride(input: {
  zoneId: string;
  monthKey: string;
  dpdUsed: number | null;
  targetDpdUsed: number | null;
  categoryOverride: "good" | "average" | "low" | null;
  efficiencyOverride?: number | null;
}): Promise<{ error: string } | { ok: true }> {
  await requirePayrollPermission("payroll.manage");
  const today = kuwaitToday();
  let month: string;
  try {
    month = assertPayrollMonth(input.monthKey, today).key;
  } catch (e) {
    return { error: e instanceof Error ? e.message : "invalid_month" };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_save_payroll_zone_override", {
    p_zone_id: input.zoneId,
    p_month: `${month}-01`,
    p_dpd_used: input.dpdUsed ?? undefined,
    p_target_dpd_used: input.targetDpdUsed ?? undefined,
    p_category_override: input.categoryOverride ?? undefined,
    p_efficiency_override: input.efficiencyOverride ?? undefined,
  });
  if (error) return { error: error.message };
  await logAdminActivity({
    action: "update",
    entityType: "payroll_zone_override",
    entityId: input.zoneId,
    pagePath: "/payroll/settings",
    routeName: "payroll-settings",
    after: {
      month,
      dpdUsed: input.dpdUsed,
      targetDpdUsed: input.targetDpdUsed,
      categoryOverride: input.categoryOverride,
      efficiencyOverride: input.efficiencyOverride ?? null,
    },
  });
  return { ok: true };
}

export async function fetchPayrollZoneSettings(input: {
  monthKey: string;
}): Promise<import("./payroll-types").PayrollZoneSettings> {
  await requirePayrollView();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_payroll_zone_settings", {
    p_month: `${input.monthKey}-01`,
  });
  if (error) throw new Error(error.message);
  const o = (data ?? {}) as Record<string, unknown>;
  return {
    periodMonth: String(o.periodMonth ?? `${input.monthKey}-01`),
    targetDpdOverride: o.targetDpdOverride == null ? null : Number(o.targetDpdOverride),
    goodThreshold: Number(o.goodThreshold ?? 110),
    averageThreshold: Number(o.averageThreshold ?? 70),
    autoTargetDpd: o.autoTargetDpd == null ? null : Number(o.autoTargetDpd),
  };
}

export async function savePayrollZoneSettings(input: {
  monthKey: string;
  targetDpdOverride: number | null;
  goodThreshold: number;
  averageThreshold: number;
}): Promise<{ error: string } | { ok: true }> {
  await requirePayrollPermission("payroll.manage");
  const today = kuwaitToday();
  let month: string;
  try {
    month = assertPayrollMonth(input.monthKey, today).key;
  } catch (e) {
    return { error: e instanceof Error ? e.message : "invalid_month" };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_save_payroll_zone_settings", {
    p_month: `${month}-01`,
    p_target_dpd_override: input.targetDpdOverride ?? undefined,
    p_good_threshold: input.goodThreshold,
    p_average_threshold: input.averageThreshold,
  });
  if (error) return { error: error.message };
  await logAdminActivity({
    action: "update",
    entityType: "payroll_zone_settings",
    entityId: month,
    pagePath: "/payroll/settings",
    routeName: "payroll-settings",
    after: {
      month,
      targetDpdOverride: input.targetDpdOverride,
      goodThreshold: input.goodThreshold,
      averageThreshold: input.averageThreshold,
    },
  });
  return { ok: true };
}

export async function deletePayrollClient(input: {
  key: string;
}): Promise<{ error: string } | { ok: true }> {
  await requirePayrollPermission("payroll.manage");
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_delete_payroll_client", {
    p_key: input.key,
  });
  if (error) return { error: error.message };
  await logAdminActivity({
    action: "delete",
    entityType: "payroll_client",
    entityId: input.key,
    pagePath: "/payroll/settings",
    routeName: "payroll-settings",
    after: { key: input.key },
  });
  return { ok: true };
}

function normaliseAdjustmentCells(
  cells: ReadonlyArray<PayrollAdjustmentCell>,
): Array<Record<string, unknown>> {
  return cells.map((cell) => ({
    driverId: cell.driverId,
    date: cell.date,
    status: cell.status,
    hours: cell.hours ?? null,
  }));
}

export async function applyPayrollAdjustments(input: {
  cells: ReadonlyArray<PayrollAdjustmentCell>;
  reason: string;
}): Promise<{ error: string } | { ok: true } & PayrollAdjustmentResult> {
  await requirePayrollPermission("payroll.manage");
  const reason = input.reason.trim();
  if (!reason) return { error: "reason_required" };
  if (!input.cells.length) return { error: "no_cells" };
  if (input.cells.length > 2000) return { error: "too_many_cells" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_apply_payroll_adjustments", {
    p_cells: normaliseAdjustmentCells(input.cells) as unknown as Json,
    p_reason: reason,
  });
  if (error) return { error: error.message };
  const payload = (data ?? {}) as Record<string, unknown>;
  await logAdminActivity({
    action: "update",
    entityType: "payroll_manual_adjustment",
    entityId: `batch:${input.cells.length}`,
    pagePath: "/payroll",
    routeName: "payroll",
    after: {
      applied: Number(payload.applied ?? input.cells.length),
      reason,
      cells: input.cells.length,
    },
  });
  return {
    ok: true,
    applied: Number(payload.applied ?? input.cells.length),
    reason: String(payload.reason ?? reason),
    by: String(payload.by ?? ""),
  };
}

export async function fetchPayrollAdjustmentAudit(input: {
  from?: string | null;
  to?: string | null;
  driverId?: string | null;
}): Promise<PayrollAdjustmentAuditRow[]> {
  await requirePayrollView();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_payroll_adjustment_audit", {
    p_from: (input.from ?? null) as unknown as string,
    p_to: (input.to ?? null) as unknown as string,
    p_driver_id: input.driverId ?? undefined,
  });
  if (error) throw new Error(error.message);
  const list = Array.isArray(data) ? data : [];
  return list.map((item) => {
    const o = (item ?? {}) as Record<string, unknown>;
    return {
      id: String(o.id ?? ""),
      driverId: String(o.driverId ?? ""),
      driverName: String(o.driverName ?? "—"),
      mgId: String(o.mgId ?? "—"),
      workDate: String(o.workDate ?? ""),
      originalStatus: o.originalStatus ? String(o.originalStatus) : null,
      adjustedStatus: String(o.adjustedStatus ?? ""),
      adjustedHours: o.adjustedHours == null ? null : Number(o.adjustedHours),
      reason: String(o.reason ?? ""),
      actorName: String(o.actorName ?? "—"),
      adjustedAt: String(o.adjustedAt ?? ""),
    };
  });
}
