"use server";

import type { Firestore } from "firebase-admin/firestore";
import { logAdminMutation, logAdminRead } from "@/lib/audit/log-admin-activity";
import { callAdminFunction } from "@/lib/firebase/callable";
import { APP_SETTINGS_DOC_ID, COLLECTIONS } from "@/lib/firebase/db";
import { staffDb } from "@/lib/firebase/staff-db";
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

function isoOf(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  const ts = value as { toDate?: () => Date };
  if (typeof ts.toDate === "function") return ts.toDate().toISOString();
  return null;
}

/** Callables accept `p_*` and camelCase. Send both so either reader matches. */
function rpcArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...args };
  for (const [key, value] of Object.entries(args)) {
    if (!key.startsWith("p_")) continue;
    const camel = key.slice(2).replace(/_([a-z0-9])/g, (_match, ch: string) => ch.toUpperCase());
    if (out[camel] === undefined) out[camel] = value;
  }
  return out;
}

async function reportingDb(): Promise<Firestore> {
  const db = await staffDb();
  if (!db) throw new Error("not_configured");
  return db;
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
    check_out_reason:
      raw.check_out_reason != null ? String(raw.check_out_reason) : null,
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

  const { data, error } = await callAdminFunction("admin_list_attendance_daily", rpcArgs({
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
  }));

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
  const { data, error } = await callAdminFunction("admin_attendance_kpis", rpcArgs({
    p_date: date,
    p_partner_id: filters.partnerId || undefined,
    p_zone_id: filters.zoneId || undefined,
    p_restaurant_id: filters.restaurantId || undefined,
  }));
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
  const { data, error } = await callAdminFunction("admin_list_attendance_exceptions", rpcArgs({
    p_date: params.date ?? kuwaitToday(),
    p_search: params.search?.trim() || undefined,
    p_unresolved_only: params.unresolvedOnly ?? true,
    p_limit: pageSize,
    p_offset: page * pageSize,
  }));
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
  const { data, error } = await callAdminFunction("admin_upsert_exception_action", rpcArgs({
    p_exception_key: input.exceptionKey,
    p_driver_id: input.driverId,
    p_exception_type: input.exceptionType,
    p_exception_date: input.exceptionDate,
    p_resolution_status: input.resolutionStatus,
    p_action: input.action ?? undefined,
    p_note: input.note ?? undefined,
  }));
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

function numSetting(data: FirebaseFirestore.DocumentData | undefined, key: string, fallback: number): number {
  const value = data?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export async function fetchAttendanceThresholdSettings(): Promise<AttendanceThresholdSettings> {
  await requireAttendanceManage();
  const db = await reportingDb();
  const snap = await db.collection(COLLECTIONS.appSettings).doc(APP_SETTINGS_DOC_ID).get();
  const data = snap.data();
  return {
    attendance_late_grace_minutes: numSetting(data, "attendance_late_grace_minutes", 10),
    attendance_early_out_grace_minutes: numSetting(data, "attendance_early_out_grace_minutes", 5),
    attendance_offline_alert_minutes: numSetting(data, "attendance_offline_alert_minutes", 5),
    attendance_auto_checkout_minutes: numSetting(data, "attendance_auto_checkout_minutes", 45),
    attendance_gps_stale_minutes: numSetting(data, "attendance_gps_stale_minutes", 10),
    attendance_gps_min_accuracy_meters: numSetting(data, "attendance_gps_min_accuracy_meters", 100),
  };
}

export async function updateAttendanceThresholdSettings(
  input: AttendanceThresholdSettings,
): Promise<{ success: boolean; error?: string }> {
  await requireAttendanceManage();
  const db = await reportingDb();
  try {
    await db.collection(COLLECTIONS.appSettings).doc(APP_SETTINGS_DOC_ID).set(
      { ...input, updated_at: new Date().toISOString() },
      { merge: true },
    );
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "save_failed" };
  }
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
    "Check Out Reason",
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
      r.check_out_reason ?? "",
      Math.round(r.duty_seconds / 60),
      Math.round(r.online_seconds / 60),
      r.minutes_late,
      r.compliance_score ?? "",
    ].join(","),
  );
  return [header, ...lines].join("\n");
}

/**
 * Day-grain attendance summary for the Analytics tab.
 *
 * This used to select every driver-day row for the range from
 * `v_attendance_daily` and bucket them in the browser — 9,669 rows / ~1.6 MB
 * for a single month, for a panel that renders one line per day. The
 * aggregation now happens server-side (`admin_attendance_analytics_daily`) and
 * returns at most one row per day. The numeric semantics are unchanged:
 * checked_in counts non-null check-ins, late counts positive minutes_late,
 * absent counts live_status 'absent', and avg_compliance is the rounded mean of
 * the non-null compliance scores (0 when a day has none).
 */
export async function fetchAttendanceAnalyticsSummary(
  fromDate: string,
  toDate: string,
): Promise<{
  daily: { date: string; checked_in: number; late: number; absent: number; avg_compliance: number }[];
}> {
  await requireAttendanceView();
  const { data, error } = await callAdminFunction("admin_attendance_analytics_daily", rpcArgs({
    p_from: fromDate,
    p_to: toDate,
  }));
  if (error) throw error;

  const payload = (data ?? {}) as { daily?: unknown[] };
  const daily = (payload.daily ?? []).map((raw) => {
    const row = raw as Record<string, unknown>;
    return {
      date: String(row.date),
      checked_in: Number(row.checked_in ?? 0),
      late: Number(row.late ?? 0),
      absent: Number(row.absent ?? 0),
      avg_compliance: Number(row.avg_compliance ?? 0),
    };
  });

  return { daily };
}

async function attendanceDailyRowsForDriver(
  driverId: string,
  fromDate: string,
  toDate: string,
): Promise<Record<string, unknown>[]> {
  const pageSize = 1000;
  const matched: Record<string, unknown>[] = [];
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;
  while (offset < total && offset < 50_000) {
    const { data, error } = await callAdminFunction<{ totalCount?: number; rows?: unknown[] }>(
      "admin_list_attendance_daily",
      rpcArgs({
        p_from: fromDate,
        p_to: toDate,
        p_limit: pageSize,
        p_offset: offset,
        p_sort: "date_desc",
      }),
    );
    if (error) throw new Error(error.message);
    const rows = data?.rows ?? [];
    total = Number(data?.totalCount ?? 0);
    for (const raw of rows) {
      const row = raw as Record<string, unknown>;
      if (String(row.driver_id) === driverId) matched.push(row);
    }
    if (rows.length === 0) break;
    offset += rows.length;
  }
  return matched;
}

export async function fetchDriverAttendanceDetail(
  driverId: string,
  date: string,
): Promise<AttendanceDailyRow | null> {
  await requireAttendanceView();
  const rows = await attendanceDailyRowsForDriver(driverId, date, date);
  const row = rows[0];
  if (!row) return null;
  return parseDailyRow(row);
}

export async function fetchDriverAttendanceRange(
  driverId: string,
  fromDate: string,
  toDate: string,
): Promise<AttendanceDailyRow[]> {
  await requireAttendanceView();
  const rows = await attendanceDailyRowsForDriver(driverId, fromDate, toDate);
  return rows
    .map((row) => parseDailyRow(row))
    .sort((a, b) => b.log_date.localeCompare(a.log_date));
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
  const db = await reportingDb();
  const events: { at: string; kind: string; label: string }[] = [];

  const logSnap = await db
    .collection(COLLECTIONS.attendanceLogs)
    .where("driver_id", "==", driverId)
    .get();
  const log = logSnap.docs
    .map((doc) => doc.data())
    .find((row) => String(row.log_date ?? "") === date);

  const checkIn = isoOf(log?.check_in_at);
  const checkOut = isoOf(log?.check_out_at);
  if (checkIn) events.push({ at: checkIn, kind: "check_in", label: "Check in" });
  if (checkOut) events.push({ at: checkOut, kind: "check_out", label: "Check out" });

  const dayStart = Date.parse(`${date}T00:00:00+03:00`);
  const dayEnd = Date.parse(`${date}T23:59:59+03:00`);

  const sessionSnap = await db
    .collection(COLLECTIONS.driverSessions)
    .where("driver_id", "==", driverId)
    .get();

  const sessions = sessionSnap.docs
    .map((doc) => doc.data())
    .filter((row) => {
      const at = isoOf(row.went_online_at);
      if (!at) return false;
      const ms = Date.parse(at);
      return Number.isFinite(ms) && ms >= dayStart && ms <= dayEnd;
    })
    .sort((a, b) => (isoOf(a.went_online_at) ?? "").localeCompare(isoOf(b.went_online_at) ?? ""));

  for (const s of sessions) {
    const onlineAt = isoOf(s.went_online_at);
    const offlineAt = isoOf(s.went_offline_at);
    if (onlineAt) {
      events.push({
        at: onlineAt,
        kind: "online",
        label: "Went online",
      });
    }
    if (offlineAt) {
      events.push({
        at: offlineAt,
        kind: "offline",
        label: "Went offline",
      });
    }
  }

  return events.sort((a, b) => a.at.localeCompare(b.at));
}
