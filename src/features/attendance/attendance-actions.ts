"use server";

import type { Firestore } from "firebase-admin/firestore";
import { logAdminMutation, logAdminRead } from "@/lib/audit/log-admin-activity";
import { callAdminFunction } from "@/lib/firebase/callable";
import { COLLECTIONS } from "@/lib/firebase/db";
import { staffDb } from "@/lib/firebase/staff-db";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import type {
  AttendanceActionError,
  AttendanceCorrectionInput,
  AttendanceKpis,
  AttendanceListRow,
  AttendanceStatus,
  AttendanceTabFilter,
} from "./types";
import type { ShiftAdherence } from "@/features/driver-tracking/shift-adherence";
import { parseShiftAdherence } from "@/features/driver-tracking/shift-adherence";

const KUWAIT_TZ = "Asia/Kuwait";
const DRIVER_ATTENDANCE = "driver_attendance";

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

function relProfileName(
  profiles:
    | { full_name: string | null; phone: string | null }
    | { full_name: string | null; phone: string | null }[]
    | null
    | undefined,
): { name: string; phone: string } {
  if (!profiles) return { name: "—", phone: "—" };
  const row = Array.isArray(profiles) ? profiles[0] : profiles;
  return {
    name: row?.full_name?.trim() || "—",
    phone: row?.phone?.trim() || "—",
  };
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
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, "attendance.manage", session.isSuperAdmin)
  ) {
    return null;
  }
  return session;
}

type DriverRow = {
  id: string;
  driver_code: string;
  is_on_duty: boolean;
  status: string;
  archived_at: string | null;
  profiles:
    | { full_name: string | null; phone: string | null }
    | { full_name: string | null; phone: string | null }[]
    | null;
};

type AttendanceLogRow = {
  id: string;
  driver_id: string;
  log_date: string;
  check_in_at: string | null;
  check_out_at: string | null;
  distance_meters: number | null;
  status: AttendanceStatus;
  zone_compliance: "inside" | "outside" | null;
  admin_note: string | null;
};

function resolveAttendanceStatus(
  log: AttendanceLogRow | null,
  isOnDuty: boolean,
): AttendanceStatus {
  if (log?.status === "on_leave") return "on_leave";
  if (log?.status === "late") return "late";
  if (isOnDuty) return "present";
  return log?.status ?? "absent";
}

function buildListRow(
  driver: DriverRow,
  log: AttendanceLogRow | null,
  logDate: string,
  appAttendance?: { status: string; online_seconds: number } | null,
  shiftAdherence: ShiftAdherence | null = null,
): AttendanceListRow {
  const { name, phone } = relProfileName(driver.profiles);
  const checkIn = log?.check_in_at ?? null;
  const checkOut = log?.check_out_at ?? null;
  const status = resolveAttendanceStatus(log, driver.is_on_duty);
  const isActiveNow = Boolean(driver.is_on_duty && !checkOut);
  const isException =
    Boolean(checkIn && !checkOut && !driver.is_on_duty) ||
    log?.zone_compliance === "outside";

  return {
    id: log?.id ?? null,
    driver_id: driver.id,
    driver_name: name,
    driver_code: driver.driver_code,
    driver_phone: phone,
    log_date: logDate,
    check_in_at: checkIn,
    check_out_at: checkOut,
    distance_meters: log?.distance_meters ?? null,
    status,
    zone_compliance: log?.zone_compliance ?? null,
    admin_note: log?.admin_note ?? null,
    is_on_duty: driver.is_on_duty,
    is_active_now: isActiveNow,
    is_exception: isException,
    app_attendance_status: appAttendance?.status ?? null,
    online_seconds_today: appAttendance?.online_seconds ?? null,
    shift_adherence: shiftAdherence,
    scheduled_shift_label: shiftAdherence
      ? formatScheduledShiftLabel(shiftAdherence)
      : null,
  };
}

function formatScheduledShiftLabel(adherence: ShiftAdherence): string {
  const fmt = (iso: string) =>
    new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: KUWAIT_TZ,
    }).format(new Date(iso));
  return `${fmt(adherence.scheduled_start_at)}–${fmt(adherence.scheduled_end_at)}`;
}

function computeKpis(rows: AttendanceListRow[]): AttendanceKpis {
  return {
    present: rows.filter((r) => r.status === "present").length,
    late: rows.filter((r) => r.status === "late").length,
    absent: rows.filter((r) => r.status === "absent").length,
    on_leave: rows.filter((r) => r.status === "on_leave").length,
    active_now: rows.filter((r) => r.is_active_now).length,
    outside_zone: rows.filter((r) => r.zone_compliance === "outside").length,
  };
}

async function attendanceDb(): Promise<Firestore> {
  const db = await staffDb();
  if (!db) throw new Error("not_configured");
  return db;
}

function logFromDoc(id: string, data: FirebaseFirestore.DocumentData): AttendanceLogRow {
  const zone = data.zone_compliance;
  return {
    id,
    driver_id: String(data.driver_id ?? ""),
    log_date: String(data.log_date ?? ""),
    check_in_at: isoOf(data.check_in_at),
    check_out_at: isoOf(data.check_out_at),
    distance_meters: data.distance_meters == null ? null : Number(data.distance_meters),
    status: String(data.status ?? "absent") as AttendanceStatus,
    zone_compliance: zone === "inside" || zone === "outside" ? zone : null,
    admin_note: data.admin_note == null ? null : String(data.admin_note),
  };
}

async function fetchActiveDrivers(): Promise<DriverRow[]> {
  const db = await attendanceDb();
  const snap = await db.collection(COLLECTIONS.drivers).where("status", "==", "active").get();

  const drivers = snap.docs
    .filter((doc) => doc.data().archived_at == null)
    .map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        driver_code: String(data.driver_code ?? ""),
        is_on_duty: Boolean(data.is_on_duty),
        status: String(data.status ?? ""),
        archived_at: isoOf(data.archived_at),
      };
    })
    .sort((a, b) => a.driver_code.localeCompare(b.driver_code));

  if (drivers.length === 0) return [];

  const profileById = new Map<string, { full_name: string | null; phone: string | null }>();
  for (let i = 0; i < drivers.length; i += 100) {
    const chunk = drivers.slice(i, i + 100);
    const profiles = await db.getAll(
      ...chunk.map((driver) => db.collection(COLLECTIONS.profiles).doc(driver.id)),
    );
    for (const profile of profiles) {
      const data = profile.data();
      if (!data) continue;
      profileById.set(profile.id, {
        full_name: data.full_name == null ? null : String(data.full_name),
        phone: data.phone == null ? null : String(data.phone),
      });
    }
  }

  return drivers.map((driver) => ({
    ...driver,
    profiles: profileById.get(driver.id) ?? null,
  }));
}

async function fetchLogsForDateRange(
  fromDate: string,
  toDate: string,
): Promise<AttendanceLogRow[]> {
  const db = await attendanceDb();
  const snap = await db
    .collection(COLLECTIONS.attendanceLogs)
    .where("log_date", ">=", fromDate)
    .where("log_date", "<=", toDate)
    .get();

  return snap.docs
    .map((doc) => logFromDoc(doc.id, doc.data()))
    .sort((a, b) => b.log_date.localeCompare(a.log_date));
}

async function fetchLogsForDate(logDate: string): Promise<AttendanceLogRow[]> {
  return fetchLogsForDateRange(logDate, logDate);
}

export async function fetchAttendanceLive(): Promise<{
  rows: AttendanceListRow[];
  kpis: AttendanceKpis;
}> {
  await requireAttendanceView();
  void logAdminRead("attendance", "fetchAttendanceLive");
  const today = kuwaitToday();
  const db = await attendanceDb();
  const [drivers, logs] = await Promise.all([
    fetchActiveDrivers(),
    fetchLogsForDate(today),
  ]);

  const appSnap = await db
    .collection(DRIVER_ATTENDANCE)
    .where("attendance_date", "==", today)
    .get();

  const driverIds = drivers.map((d) => d.id);
  const { data: adherenceRows, error: adherenceError } = await callAdminFunction<
    Array<{ driver_id: string; shift_adherence: unknown }>
  >("admin_list_shift_adherence", {
    p_from: today,
    p_to: today,
    p_driver_ids: driverIds.length > 0 ? driverIds : undefined,
  });
  if (adherenceError) throw new Error(adherenceError.message);

  const adherenceByDriver = new Map<string, ShiftAdherence>();
  for (const row of adherenceRows ?? []) {
    const parsed = parseShiftAdherence(row.shift_adherence);
    if (parsed) adherenceByDriver.set(row.driver_id, parsed);
  }

  const appByDriver = new Map(
    appSnap.docs.map((doc) => {
      const data = doc.data();
      const driverId = String(data.driver_id ?? "");
      return [
        driverId,
        { status: String(data.status ?? ""), online_seconds: Number(data.online_seconds ?? 0) },
      ] as const;
    }),
  );

  const logByDriver = new Map(logs.map((l) => [l.driver_id, l]));
  const rows = drivers.map((d) =>
    buildListRow(
      d,
      logByDriver.get(d.id) ?? null,
      today,
      appByDriver.get(d.id),
      adherenceByDriver.get(d.id) ?? null,
    ),
  );

  return { rows, kpis: computeKpis(rows) };
}

export async function fetchAttendanceLogs(
  fromDate: string,
  toDate: string,
): Promise<AttendanceListRow[]> {
  await requireAttendanceView();
  void logAdminRead("attendance", "fetchAttendanceLogs");
  const [drivers, logs] = await Promise.all([
    fetchActiveDrivers(),
    fetchLogsForDateRange(fromDate, toDate),
  ]);

  const driverById = new Map(drivers.map((d) => [d.id, d]));

  return logs
    .map((log) => {
      const driver = driverById.get(log.driver_id);
      if (!driver) return null;
      return buildListRow(driver, log, log.log_date);
    })
    .filter((r): r is AttendanceListRow => r !== null);
}

export async function fetchAttendanceExceptions(): Promise<AttendanceListRow[]> {
  const { rows } = await fetchAttendanceLive();
  return rows.filter((r) => r.is_exception);
}

export async function fetchAttendanceForTab(
  tab: AttendanceTabFilter,
  fromDate?: string,
  toDate?: string,
): Promise<{ rows: AttendanceListRow[]; kpis?: AttendanceKpis }> {
  if (tab === "live") {
    return fetchAttendanceLive();
  }
  if (tab === "exceptions") {
    const rows = await fetchAttendanceExceptions();
    return { rows, kpis: computeKpis(rows) };
  }
  const today = kuwaitToday();
  const from = fromDate ?? addDays(today, -6);
  const to = toDate ?? today;
  const rows = await fetchAttendanceLogs(from, to);
  return { rows };
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function correctAttendanceLog(
  input: AttendanceCorrectionInput,
): Promise<{ error?: AttendanceActionError; success?: boolean; id?: string }> {
  const session = await requireAttendanceManage();
  if (!session) return { error: "not_authorized" };

  const note = input.note.trim();
  if (!note) return { error: "note_required" };

  const db = await attendanceDb();

  let before: Record<string, unknown> | null = null;
  if (input.log_id) {
    const existing = await db.collection(COLLECTIONS.attendanceLogs).doc(input.log_id).get();
    if (existing.exists) {
      const row = logFromDoc(existing.id, existing.data() ?? {});
      before = { ...row };
    }
  }

  const { data, error } = await callAdminFunction<Record<string, unknown>>(
    "admin_correct_attendance",
    {
      p_log_id: input.log_id ?? undefined,
      p_driver_id: input.driver_id,
      p_log_date: input.log_date,
      p_check_in_at: input.check_in_at ?? undefined,
      p_check_out_at: input.check_out_at ?? undefined,
      p_status: input.status,
      p_note: note,
    },
  );

  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("note_required")) return { error: "note_required" };
    if (msg.includes("missing_fields")) return { error: "missing_fields" };
    if (msg.includes("invalid_times")) return { error: "invalid_times" };
    if (msg.includes("future_date")) return { error: "future_date" };
    if (msg.includes("log_not_found")) return { error: "log_not_found" };
    if (msg.includes("driver_not_found")) return { error: "driver_not_found" };
    if (msg.includes("not_authorized")) return { error: "not_authorized" };
    return { error: "save_failed" };
  }

  const after = data;
  const entityId = String(after?.id ?? input.log_id ?? input.driver_id);

  await logAdminMutation({
    action: input.log_id ? "update" : "create",
    entityType: "attendance_log",
    entityId,
    routeName: "attendance",
    before,
    after,
    context: { driver_id: input.driver_id, log_date: input.log_date },
  });

  return { success: true, id: entityId };
}

export async function exportAttendanceCsv(rows: AttendanceListRow[]): Promise<string> {
  await requireAttendanceView();
  void logAdminRead("attendance", "exportAttendanceCsv");
  const header = [
    "driver_code",
    "driver_name",
    "log_date",
    "check_in",
    "check_out",
    "status",
    "distance_meters",
    "on_duty",
    "zone_compliance",
    "admin_note",
  ];
  const escape = (v: string | number | boolean | null) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [
    header.join(","),
    ...rows.map((r) =>
      [
        r.driver_code,
        r.driver_name,
        r.log_date,
        r.check_in_at ?? "",
        r.check_out_at ?? "",
        r.status,
        r.distance_meters ?? "",
        r.is_on_duty,
        r.zone_compliance ?? "",
        r.admin_note ?? "",
      ]
        .map(escape)
        .join(","),
    ),
  ];
  return "\uFEFF" + lines.join("\n");
}
