"use server";

import { logAdminMutation, logAdminRead } from "@/lib/audit/log-admin-activity";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import type {
  AttendanceDailyRow,
  AttendanceExceptionRow,
  AttendanceListFilters,
  AttendanceReportingKpis,
  AttendanceThresholdSettings,
  ExceptionResolutionStatus,
} from "./attendance-reporting-types";

const KUWAIT_TZ = "Asia/Kuwait";
const DEFAULT_PAGE_SIZE = 50;

function kuwaitToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: KUWAIT_TZ }).format(new Date());
}

async function requireAttendanceView() {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, "attendance.view", session.isSuperAdmin)
  ) {
    throw new Error("not_authorized");
  }
  return session;
}

async function requireAttendanceManage() {
  const session = await requireAttendanceView();
  if (!hasPermissionInSet(session.permissions, "attendance.manage", session.isSuperAdmin)) {
    throw new Error("not_authorized");
  }
  return session;
}

function parseDailyRow(raw: Record<string, unknown>): AttendanceDailyRow {
  return {
    driver_id: String(raw.driver_id),
    log_date: String(raw.log_date),
    driver_code: String(raw.driver_code ?? ""),
    employee_id: raw.employee_id != null ? String(raw.employee_id) : null,
    driver_name: String(raw.driver_name ?? "—"),
    driver_phone: String(raw.driver_phone ?? "—"),
    partner_id: raw.partner_id != null ? String(raw.partner_id) : null,
    partner_name: raw.partner_name != null ? String(raw.partner_name) : null,
    zone_id: raw.zone_id != null ? String(raw.zone_id) : null,
    zone_name: raw.zone_name != null ? String(raw.zone_name) : null,
    is_on_duty: Boolean(raw.is_on_duty),
    shift_type: raw.shift_type != null ? String(raw.shift_type) : null,
    scheduled_start_at:
      raw.scheduled_start_at != null ? String(raw.scheduled_start_at) : null,
    scheduled_end_at:
      raw.scheduled_end_at != null ? String(raw.scheduled_end_at) : null,
    attendance_log_id:
      raw.attendance_log_id != null ? String(raw.attendance_log_id) : null,
    check_in_at: raw.check_in_at != null ? String(raw.check_in_at) : null,
    check_out_at: raw.check_out_at != null ? String(raw.check_out_at) : null,
    attendance_status: String(raw.attendance_status ?? "absent"),
    online_seconds: Number(raw.online_seconds ?? 0),
    duty_seconds: Number(raw.duty_seconds ?? 0),
    minutes_late: Number(raw.minutes_late ?? 0),
    minutes_early_out: Number(raw.minutes_early_out ?? 0),
    last_seen_at: raw.last_seen_at != null ? String(raw.last_seen_at) : null,
    gps_zone_status:
      raw.gps_zone_status != null ? String(raw.gps_zone_status) : null,
    gps_accuracy_meters:
      raw.gps_accuracy_meters != null ? Number(raw.gps_accuracy_meters) : null,
    gps_is_mocked: raw.gps_is_mocked != null ? Boolean(raw.gps_is_mocked) : null,
    live_status: String(raw.live_status ?? "scheduled"),
    compliance_score:
      raw.compliance_score != null ? Number(raw.compliance_score) : null,
  };
}

function parseExceptionRow(raw: Record<string, unknown>): AttendanceExceptionRow {
  return {
    exception_key: String(raw.exception_key),
    driver_id: String(raw.driver_id),
    exception_date: String(raw.exception_date),
    exception_type: String(raw.exception_type),
    severity: String(raw.severity ?? "medium"),
    detected_at: raw.detected_at != null ? String(raw.detected_at) : null,
    duration_seconds:
      raw.duration_seconds != null ? Number(raw.duration_seconds) : null,
    driver_name: String(raw.driver_name ?? "—"),
    driver_code: String(raw.driver_code ?? ""),
    employee_id: raw.employee_id != null ? String(raw.employee_id) : null,
    partner_name: raw.partner_name != null ? String(raw.partner_name) : null,
    zone_name: raw.zone_name != null ? String(raw.zone_name) : null,
    current_status: String(raw.current_status ?? ""),
    resolution_status:
      raw.resolution_status != null ? String(raw.resolution_status) : null,
    supervisor_action:
      raw.supervisor_action != null ? String(raw.supervisor_action) : null,
    supervisor_note:
      raw.supervisor_note != null ? String(raw.supervisor_note) : null,
    supervisor_id: raw.supervisor_id != null ? String(raw.supervisor_id) : null,
  };
}

export async function fetchAttendanceDailyList(
  filters: AttendanceListFilters = {},
): Promise<{ rows: AttendanceDailyRow[]; totalCount: number }> {
  await requireAttendanceView();
  const today = kuwaitToday();
  const from = filters.fromDate ?? today;
  const to = filters.toDate ?? today;
  const page = filters.page ?? 0;
  const pageSize = filters.pageSize ?? DEFAULT_PAGE_SIZE;

  void logAdminRead("attendance", "fetchAttendanceDailyList", { from, to, filters });

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_list_attendance_daily", {
    p_from: from,
    p_to: to,
    p_search: filters.search?.trim() || undefined,
    p_partner_id: filters.partnerId || undefined,
    p_zone_id: filters.zoneId || undefined,
    p_restaurant_id: filters.restaurantId || undefined,
    p_status: filters.status && filters.status !== "all" ? filters.status : undefined,
    p_live_only: filters.liveOnly ?? false,
    p_sort: filters.sort ?? "problems_first",
    p_limit: pageSize,
    p_offset: page * pageSize,
  });

  if (error) throw error;

  const payload = (data ?? {}) as { totalCount?: number; rows?: unknown[] };
  const rows = (payload.rows ?? []).map((r) =>
    parseDailyRow(r as Record<string, unknown>),
  );
  return { rows, totalCount: Number(payload.totalCount ?? 0) };
}

export async function fetchAttendanceReportingKpis(
  date: string,
  filters: Pick<
    AttendanceListFilters,
    "partnerId" | "zoneId" | "restaurantId"
  > = {},
): Promise<AttendanceReportingKpis> {
  await requireAttendanceView();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_attendance_kpis", {
    p_date: date,
    p_partner_id: filters.partnerId || undefined,
    p_zone_id: filters.zoneId || undefined,
    p_restaurant_id: filters.restaurantId || undefined,
  });
  if (error) throw error;
  const p = (data ?? {}) as Record<string, unknown>;
  return {
    scheduled: Number(p.scheduled ?? 0),
    checked_in: Number(p.checked_in ?? 0),
    late: Number(p.late ?? 0),
    absent: Number(p.absent ?? 0),
    online: Number(p.online ?? 0),
    problems: Number(p.problems ?? 0),
    compliance_score: Number(p.compliance_score ?? 0),
  };
}

export async function fetchAttendanceExceptionsList(params: {
  date?: string;
  search?: string;
  unresolvedOnly?: boolean;
  page?: number;
  pageSize?: number;
}): Promise<{ rows: AttendanceExceptionRow[]; totalCount: number }> {
  await requireAttendanceView();
  const page = params.page ?? 0;
  const pageSize = params.pageSize ?? DEFAULT_PAGE_SIZE;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_list_attendance_exceptions", {
    p_date: params.date ?? kuwaitToday(),
    p_search: params.search?.trim() || undefined,
    p_unresolved_only: params.unresolvedOnly ?? true,
    p_limit: pageSize,
    p_offset: page * pageSize,
  });
  if (error) throw error;
  const payload = (data ?? {}) as { totalCount?: number; rows?: unknown[] };
  return {
    rows: (payload.rows ?? []).map((r) =>
      parseExceptionRow(r as Record<string, unknown>),
    ),
    totalCount: Number(payload.totalCount ?? 0),
  };
}

export async function upsertAttendanceExceptionAction(input: {
  exceptionKey: string;
  driverId: string;
  exceptionType: string;
  exceptionDate: string;
  resolutionStatus: ExceptionResolutionStatus;
  action?: string;
  note?: string;
}): Promise<{ success: boolean; error?: string }> {
  await requireAttendanceManage();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_upsert_exception_action", {
    p_exception_key: input.exceptionKey,
    p_driver_id: input.driverId,
    p_exception_type: input.exceptionType,
    p_exception_date: input.exceptionDate,
    p_resolution_status: input.resolutionStatus,
    p_action: input.action ?? undefined,
    p_note: input.note ?? undefined,
  });
  if (error) return { success: false, error: error.message };
  void logAdminMutation({
    action: "update",
    entityType: "attendance_exception",
    entityId: input.exceptionKey,
    routeName: "upsertAttendanceExceptionAction",
    after: data as Record<string, unknown>,
  });
  return { success: true };
}

export async function fetchAttendanceThresholdSettings(): Promise<AttendanceThresholdSettings> {
  await requireAttendanceManage();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("app_settings")
    .select(
      "attendance_late_grace_minutes, attendance_early_out_grace_minutes, attendance_offline_alert_minutes, attendance_gps_stale_minutes, attendance_gps_min_accuracy_meters",
    )
    .eq("id", 1)
    .maybeSingle();
  if (error) throw error;
  return {
    attendance_late_grace_minutes: data?.attendance_late_grace_minutes ?? 10,
    attendance_early_out_grace_minutes:
      data?.attendance_early_out_grace_minutes ?? 5,
    attendance_offline_alert_minutes: data?.attendance_offline_alert_minutes ?? 5,
    attendance_gps_stale_minutes: data?.attendance_gps_stale_minutes ?? 10,
    attendance_gps_min_accuracy_meters:
      data?.attendance_gps_min_accuracy_meters ?? 100,
  };
}

export async function updateAttendanceThresholdSettings(
  input: AttendanceThresholdSettings,
): Promise<{ success: boolean; error?: string }> {
  await requireAttendanceManage();
  const supabase = await createClient();
  const { error } = await supabase
    .from("app_settings")
    .update({
      ...input,
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1);
  if (error) return { success: false, error: error.message };
  void logAdminMutation({
    action: "update",
    entityType: "app_settings",
    entityId: "1",
    routeName: "updateAttendanceThresholdSettings",
    after: input as unknown as Record<string, unknown>,
  });
  return { success: true };
}

export async function exportAttendanceDailyCsv(
  filters: AttendanceListFilters = {},
): Promise<string> {
  const { rows } = await fetchAttendanceDailyList({
    ...filters,
    page: 0,
    pageSize: 10000,
  });
  const header = [
    "Date",
    "Driver",
    "Code",
    "Employee ID",
    "Partner",
    "Status",
    "Check In",
    "Check Out",
    "Duty (min)",
    "Online (min)",
    "Late (min)",
    "Compliance %",
  ].join(",");
  const lines = rows.map((r) =>
    [
      r.log_date,
      `"${r.driver_name.replace(/"/g, '""')}"`,
      r.driver_code,
      r.employee_id ?? "",
      `"${(r.partner_name ?? "").replace(/"/g, '""')}"`,
      r.live_status,
      r.check_in_at ?? "",
      r.check_out_at ?? "",
      Math.round(r.duty_seconds / 60),
      Math.round(r.online_seconds / 60),
      r.minutes_late,
      r.compliance_score ?? "",
    ].join(","),
  );
  return [header, ...lines].join("\n");
}

export async function fetchAttendanceAnalyticsSummary(
  fromDate: string,
  toDate: string,
): Promise<{
  daily: { date: string; checked_in: number; late: number; absent: number; avg_compliance: number }[];
}> {
  await requireAttendanceView();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("v_attendance_daily")
    .select("log_date, check_in_at, minutes_late, live_status, compliance_score")
    .gte("log_date", fromDate)
    .lte("log_date", toDate);
  if (error) throw error;

  const byDate = new Map<
    string,
    { checked_in: number; late: number; absent: number; compliance: number[] }
  >();
  for (const row of (data ?? []) as Array<{
    log_date: string | null;
    check_in_at: string | null;
    minutes_late: number | null;
    live_status: string | null;
    compliance_score: number | null;
  }>) {
    const d = String(row.log_date);
    const bucket = byDate.get(d) ?? {
      checked_in: 0,
      late: 0,
      absent: 0,
      compliance: [],
    };
    if (row.check_in_at) bucket.checked_in += 1;
    if (Number(row.minutes_late ?? 0) > 0) bucket.late += 1;
    if (row.live_status === "absent") bucket.absent += 1;
    if (row.compliance_score != null) bucket.compliance.push(Number(row.compliance_score));
    byDate.set(d, bucket);
  }

  const daily = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({
      date,
      checked_in: v.checked_in,
      late: v.late,
      absent: v.absent,
      avg_compliance:
        v.compliance.length > 0
          ? Math.round(v.compliance.reduce((a, b) => a + b, 0) / v.compliance.length)
          : 0,
    }));

  return { daily };
}

export async function fetchDriverAttendanceDetail(
  driverId: string,
  date: string,
): Promise<AttendanceDailyRow | null> {
  await requireAttendanceView();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("v_attendance_daily")
    .select("*")
    .eq("driver_id", driverId)
    .eq("log_date", date)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return parseDailyRow(data as Record<string, unknown>);
}

export async function fetchDriverAttendanceRange(
  driverId: string,
  fromDate: string,
  toDate: string,
): Promise<AttendanceDailyRow[]> {
  await requireAttendanceView();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("v_attendance_daily")
    .select("*")
    .eq("driver_id", driverId)
    .gte("log_date", fromDate)
    .lte("log_date", toDate)
    .order("log_date", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => parseDailyRow(r as Record<string, unknown>));
}

export async function fetchDriverAttendanceTimeline(
  driverId: string,
  date: string,
): Promise<
  {
    at: string;
    kind: string;
    label: string;
  }[]
> {
  await requireAttendanceView();
  const supabase = await createClient();
  const events: { at: string; kind: string; label: string }[] = [];

  const { data: log } = await supabase
    .from("attendance_logs")
    .select("check_in_at, check_out_at")
    .eq("driver_id", driverId)
    .eq("log_date", date)
    .maybeSingle();

  if (log?.check_in_at) {
    events.push({ at: log.check_in_at, kind: "check_in", label: "Check in" });
  }
  if (log?.check_out_at) {
    events.push({ at: log.check_out_at, kind: "check_out", label: "Check out" });
  }

  const dayStart = `${date}T00:00:00+03:00`;
  const dayEnd = `${date}T23:59:59+03:00`;

  const { data: sessions } = await supabase
    .from("driver_sessions")
    .select("went_online_at, went_offline_at, is_online")
    .eq("driver_id", driverId)
    .gte("went_online_at", dayStart)
    .lte("went_online_at", dayEnd)
    .order("went_online_at", { ascending: true });

  for (const s of sessions ?? []) {
    if (s.went_online_at) {
      events.push({
        at: s.went_online_at,
        kind: "online",
        label: "Went online",
      });
    }
    if (s.went_offline_at) {
      events.push({
        at: s.went_offline_at,
        kind: "offline",
        label: "Went offline",
      });
    }
  }

  return events.sort((a, b) => a.at.localeCompare(b.at));
}
