"use server";

import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { kuwaitToday } from "@/features/performance/performance-formulas";
import { EMPTY_OPS_SLICERS } from "@/features/performance/performance-ops-types";
import { assertPayrollMonth, kuwaitMonthBounds, payrollMonths } from "./payroll-formulas";
import {
  assemblePayrollSnapshot,
  decoratePayrollSnapshot,
  kuwaitYmdFromIso,
  type RawPayrollDriver,
  type RawPayrollRequest,
} from "./payroll-snapshot";
import type { PayrollSlicers, PayrollSnapshot } from "./payroll-types";

function requirePayrollView() {
  return requirePayrollPermission("payroll.view");
}

async function requirePayrollPermission(slug: "payroll.view" | "payroll.export") {
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

  const [driverRows, profileRows, zoneRows, vehicleRows, mapRows, restaurantRows, logRows, requestRows] =
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
      fetchAll<{ driver_id: string; check_in_at: string | null }>((from, to) =>
        supabase
          .from("attendance_logs")
          .select("driver_id, check_in_at")
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

  return assemblePayrollSnapshot({
    today,
    monthKey,
    slicers,
    roster,
    checkIns: logRows.flatMap((l) =>
      l.check_in_at
        ? [{ driverId: l.driver_id, date: kuwaitYmdFromIso(l.check_in_at) }]
        : [],
    ),
    requests,
  });
}

export async function fetchPayrollMonths(): Promise<{
  today: string;
  months: ReturnType<typeof payrollMonths>;
}> {
  await requirePayrollView();
  const today = kuwaitToday();
  return { today, months: payrollMonths(today) };
}
