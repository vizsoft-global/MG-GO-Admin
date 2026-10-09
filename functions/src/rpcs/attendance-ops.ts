/**
 * Attendance operations: analytics, admin corrections, shift adherence, the
 * exception queue and the two duty sweeps the cron runs.
 *
 * Ports of `admin_attendance_analytics_daily`, `admin_correct_attendance`,
 * `admin_get_shift_adherence`, `admin_list_shift_adherence`,
 * `admin_list_attendance_exceptions`, `admin_run_attendance_auto_checkout` and
 * `admin_run_freeze_start_checkout`. Attendance rows are read through
 * `loadAttendanceRows` so the exception queue and the daily list derive
 * `live_status` from one rule.
 */
import { createHash } from "crypto";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { getFirestore, Timestamp, type DocumentSnapshot } from "../core/fs";
import { COLLECTIONS, FIELDS } from "../core/collections";
import { kuwaitDayStart, kuwaitDayString } from "../core/kuwait";
import { loadAppSettings } from "../core/settings";
import { requireStaff } from "../core/staff";
import {
  SCAN_CAP,
  chunk,
  logDriverOperation,
  numberOrNull,
  pickCount,
  pickDay,
  pickId,
  pickIdList,
  pickInstant,
  pickText,
  pickTriBool,
  type Dict,
} from "./_shared";
import { loadAttendanceRows, type AttendanceRow } from "./attendance-shared";

const ATT = FIELDS.attendanceLogs;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const EXCEPTION_ACTIONS = "attendance_exception_actions";
const ATTENDANCE_STATUSES = new Set(["present", "late", "absent", "on_leave"]);
const PARALLEL = 25;

type Data = Record<string, unknown>;

function asDate(value: unknown): Date | null {
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value);
  return null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length ? value : null;
}

function iso(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

function addDays(day: string, offset: number): string {
  const base = new Date(`${day}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + offset);
  return base.toISOString().slice(0, 10);
}

/** `shift_date + offset days + HH:MM[:SS]` in Asia/Kuwait, as an instant. */
function shiftInstant(day: string, time: unknown, offset: unknown): Date | null {
  if (typeof time !== "string") return asDate(time);
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(time.trim());
  if (!match) return null;
  const days = typeof offset === "number" && Number.isFinite(offset) ? Math.trunc(offset) : 0;
  const ms =
    Number(match[1]) * 3_600_000 + Number(match[2]) * 60_000 + Number(match[3] ?? 0) * 1000;
  return new Date(kuwaitDayStart(addDays(day, days)).getTime() + ms);
}

function session1End(shift: Dict, day: string): Date | null {
  return shiftInstant(day, shift.session1_end, shift.session1_end_day_offset);
}

function session2End(shift: Dict, day: string): Date | null {
  return shift.session2_end == null
    ? null
    : shiftInstant(day, shift.session2_end, shift.session2_end_day_offset);
}

/** `_driver_shift_end_at`: the later of the two session ends. */
function shiftEndAt(shift: Dict, day: string): Date | null {
  const first = session1End(shift, day);
  const second = session2End(shift, day);
  if (!first) return second;
  if (!second) return first;
  return second > first ? second : first;
}

function rethrowWindow(error: unknown): never {
  if (error instanceof Error && error.message === "attendance_window_too_large") {
    throw new HttpsError("out-of-range", "attendance_window_too_large");
  }
  throw error;
}

async function inParallel<T, R>(items: readonly T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (const group of chunk(items, PARALLEL)) {
    out.push(...(await Promise.all(group.map(fn))));
  }
  return out;
}

async function closedSessionsOf(driverId: string): Promise<Dict[]> {
  const snap = await getFirestore()
    .collection(COLLECTIONS.driverSessions)
    .where(ATT.driverId, "==", driverId)
    .where("is_online", "==", false)
    .limit(SCAN_CAP)
    .get();
  return snap.docs.map((doc) => (doc.data() ?? {}) as Dict);
}

// ---------------------------------------------------------------------------
// admin_attendance_analytics_daily
// ---------------------------------------------------------------------------

export const adminAttendanceAnalyticsDaily = onCall(async (request) => {
  await requireStaff(request, "attendance.view");
  const data = (request.data ?? {}) as Data;
  const from = pickDay(data, "from", "p_from");
  const to = pickDay(data, "to", "p_to");
  if (!from || !DAY_RE.test(from)) throw new HttpsError("invalid-argument", "invalid_from");
  if (!to || !DAY_RE.test(to)) throw new HttpsError("invalid-argument", "invalid_to");
  if (from > to) return { daily: [] };

  const settings = await loadAppSettings();
  const rows = await loadAttendanceRows(
    { from, to, partnerId: null, zoneId: null, restaurantId: null },
    settings,
  ).catch(rethrowWindow);

  const byDay = new Map<
    string,
    { checkedIn: number; late: number; absent: number; complianceSum: number; complianceCount: number }
  >();
  for (const row of rows) {
    const bucket = byDay.get(row.log_date) ?? {
      checkedIn: 0,
      late: 0,
      absent: 0,
      complianceSum: 0,
      complianceCount: 0,
    };
    if (row.check_in_at) bucket.checkedIn += 1;
    if (row.minutes_late > 0) bucket.late += 1;
    if (row.live_status === "absent") bucket.absent += 1;
    if (row.compliance_score !== null) {
      bucket.complianceSum += row.compliance_score;
      bucket.complianceCount += 1;
    }
    byDay.set(row.log_date, bucket);
  }

  const daily = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, bucket]) => ({
      date,
      checked_in: bucket.checkedIn,
      late: bucket.late,
      absent: bucket.absent,
      avg_compliance: bucket.complianceCount
        ? Math.round(bucket.complianceSum / bucket.complianceCount)
        : 0,
    }));
  return { daily };
});

// ---------------------------------------------------------------------------
// admin_correct_attendance
// ---------------------------------------------------------------------------

function serializeLog(id: string, raw: Dict): Dict {
  const out: Dict = { id };
  for (const [key, value] of Object.entries(raw)) {
    out[key] = value instanceof Timestamp ? value.toDate().toISOString() : value;
  }
  return out;
}

export const adminCorrectAttendance = onCall(async (request) => {
  const staff = await requireStaff(request, "attendance.manage");
  const data = (request.data ?? {}) as Data;
  const db = getFirestore();
  const logs = db.collection(COLLECTIONS.attendanceLogs);

  const note = pickText(data, "note", "p_note");
  if (!note) throw new HttpsError("invalid-argument", "note_required");

  const logId = pickId(data, "logId", "p_log_id");
  const driverId = pickId(data, "driverId", "p_driver_id");
  const logDate = pickDay(data, "logDate", "p_log_date");
  const checkIn = pickInstant(data, "checkInAt", "p_check_in_at");
  const checkOut = pickInstant(data, "checkOutAt", "p_check_out_at");
  const status = pickText(data, "status", "p_status");
  if (status !== null && !ATTENDANCE_STATUSES.has(status)) {
    throw new HttpsError("invalid-argument", "invalid_status");
  }
  const reason = checkOut ? "admin" : null;
  const now = Timestamp.now();
  const today = kuwaitDayString(new Date());

  if (logId) {
    const ref = logs.doc(logId);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError("not-found", "log_not_found");
    const old = (snap.data() ?? {}) as Dict;
    const oldDate = asString(old[ATT.logDate]);
    if (oldDate && oldDate > today) throw new HttpsError("failed-precondition", "future_date");
    const effectiveIn = checkIn ?? asDate(old[ATT.checkInAt]);
    if (checkOut && effectiveIn && checkOut < effectiveIn) {
      throw new HttpsError("invalid-argument", "invalid_times");
    }
    const patch: Dict = {
      [ATT.checkInAt]: effectiveIn ? Timestamp.fromDate(effectiveIn) : null,
      [ATT.checkOutAt]: checkOut ? Timestamp.fromDate(checkOut) : null,
      [ATT.checkOutReason]: checkOut
        ? reason ?? asString(old[ATT.checkOutReason]) ?? "admin"
        : null,
      [ATT.status]: status ?? old[ATT.status] ?? "present",
      admin_note: note,
      updated_at: now,
    };
    await ref.update(patch);
    return serializeLog(ref.id, { ...old, ...patch });
  }

  if (!driverId || !logDate) throw new HttpsError("invalid-argument", "missing_fields");
  if (!DAY_RE.test(logDate)) throw new HttpsError("invalid-argument", "invalid_log_date");
  if (logDate > today) throw new HttpsError("failed-precondition", "future_date");
  if (checkIn && checkOut && checkOut < checkIn) {
    throw new HttpsError("invalid-argument", "invalid_times");
  }

  const driverSnap = await db.collection(COLLECTIONS.drivers).doc(driverId).get();
  if (!driverSnap.exists) throw new HttpsError("not-found", "driver_not_found");

  const existing = await logs
    .where(ATT.driverId, "==", driverId)
    .where(ATT.logDate, "==", logDate)
    .limit(1)
    .get();

  if (!existing.empty) {
    const doc = existing.docs[0];
    const old = (doc.data() ?? {}) as Dict;
    const effectiveIn = checkIn ?? asDate(old[ATT.checkInAt]);
    if (checkOut && effectiveIn && checkOut < effectiveIn) {
      throw new HttpsError("invalid-argument", "invalid_times");
    }
    const patch: Dict = {
      [ATT.checkInAt]: effectiveIn ? Timestamp.fromDate(effectiveIn) : null,
      [ATT.checkOutAt]: checkOut ? Timestamp.fromDate(checkOut) : null,
      [ATT.checkOutReason]: checkOut
        ? reason ?? asString(old[ATT.checkOutReason]) ?? "admin"
        : null,
      [ATT.status]: status ?? old[ATT.status] ?? "present",
      admin_note: note,
      updated_at: now,
    };
    await doc.ref.update(patch);
    return serializeLog(doc.id, { ...old, ...patch });
  }

  const driver = (driverSnap.data() ?? {}) as Dict;
  const ref = logs.doc();
  const row: Dict = {
    [ATT.driverId]: driverId,
    [ATT.logDate]: logDate,
    [ATT.checkInAt]: checkIn ? Timestamp.fromDate(checkIn) : null,
    [ATT.checkOutAt]: checkOut ? Timestamp.fromDate(checkOut) : null,
    [ATT.checkOutReason]: reason,
    [ATT.status]: status ?? "present",
    [ATT.driverName]: driver[FIELDS.drivers.name] ?? null,
    [ATT.driverCode]: driver[FIELDS.drivers.driverCode] ?? null,
    [ATT.employeeId]: driver[FIELDS.drivers.employeeId] ?? null,
    [ATT.zoneId]: driver[FIELDS.drivers.zoneId] ?? null,
    [ATT.zoneName]: driver[FIELDS.drivers.zoneName] ?? null,
    [ATT.partnerId]: driver[FIELDS.drivers.partnerId] ?? null,
    [ATT.isOnDuty]: false,
    [ATT.onlineSeconds]: 0,
    admin_note: note,
    created_by: staff.uid,
    created_at: now,
    updated_at: now,
  };
  await ref.set(row);
  return serializeLog(ref.id, row);
});

// ---------------------------------------------------------------------------
// _driver_shift_adherence / admin_get_shift_adherence / admin_list_shift_adherence
// ---------------------------------------------------------------------------

type ShiftAdherence = {
  scheduled_start_at: string | null;
  scheduled_end_at: string | null;
  actual_in_at: string | null;
  actual_out_at: string | null;
  minutes_late: number;
  minutes_early_out: number;
  online_seconds: number;
  scheduled_seconds: number;
};

function computeAdherence(
  day: string,
  shift: Dict | null,
  log: Dict | null,
  sessions: readonly Dict[],
  graceMinutes: number,
): ShiftAdherence | null {
  if (!shift) return null;

  const scheduledStart = shiftInstant(day, shift.session1_start, 0);
  const scheduledEnd =
    shift.shift_type === "split" && shift.session2_end != null
      ? session2End(shift, day)
      : session1End(shift, day);

  let sessionSeconds = 0;
  let firstOnline: Date | null = null;
  for (const session of sessions) {
    const wentOnline = asDate(session.went_online_at);
    if (!wentOnline || kuwaitDayString(wentOnline) !== day) continue;
    if (!firstOnline || wentOnline < firstOnline) firstOnline = wentOnline;
    const wentOffline = asDate(session.went_offline_at);
    if (session.is_online === false && wentOffline) {
      sessionSeconds += Math.max(0, (wentOffline.getTime() - wentOnline.getTime()) / 1000);
    }
  }

  const actualIn = asDate(log?.[ATT.checkInAt]) ?? firstOnline;
  const actualOut = asDate(log?.[ATT.checkOutAt]);
  const logOnline = numberOrNull(log?.[ATT.onlineSeconds]) ?? 0;
  const onlineSeconds = Math.round(Math.max(logOnline, sessionSeconds));

  const scheduledSeconds =
    scheduledStart && scheduledEnd
      ? Math.max(0, Math.round((scheduledEnd.getTime() - scheduledStart.getTime()) / 1000))
      : 0;

  const minutesLate =
    actualIn && scheduledStart
      ? Math.max(0, Math.round((actualIn.getTime() - scheduledStart.getTime()) / 60_000) - graceMinutes)
      : 0;

  let minutesEarlyOut = 0;
  if (actualOut && scheduledEnd) {
    const effectiveOut =
      scheduledStart && actualOut < scheduledStart ? scheduledStart : actualOut;
    minutesEarlyOut = Math.min(
      Math.max(0, Math.round((scheduledEnd.getTime() - effectiveOut.getTime()) / 60_000)),
      Math.trunc(scheduledSeconds / 60),
    );
  }

  return {
    scheduled_start_at: iso(scheduledStart),
    scheduled_end_at: iso(scheduledEnd),
    actual_in_at: iso(actualIn),
    actual_out_at: iso(actualOut),
    minutes_late: minutesLate,
    minutes_early_out: minutesEarlyOut,
    online_seconds: onlineSeconds,
    scheduled_seconds: scheduledSeconds,
  };
}

export const adminGetShiftAdherence = onCall(async (request) => {
  await requireStaff(request, "attendance.view");
  const data = (request.data ?? {}) as Data;
  const driverId = pickId(data, "driverId", "p_driver_id");
  const day = pickDay(data, "date", "p_date");
  if (!driverId || !day) return null;

  const db = getFirestore();
  const [settings, shiftSnap, logSnap, sessions] = await Promise.all([
    loadAppSettings(),
    db
      .collection(COLLECTIONS.driverDailyShifts)
      .where(ATT.driverId, "==", driverId)
      .where("shift_date", "==", day)
      .limit(1)
      .get(),
    db
      .collection(COLLECTIONS.attendanceLogs)
      .where(ATT.driverId, "==", driverId)
      .where(ATT.logDate, "==", day)
      .limit(1)
      .get(),
    closedSessionsOf(driverId),
  ]);

  return computeAdherence(
    day,
    shiftSnap.empty ? null : ((shiftSnap.docs[0].data() ?? {}) as Dict),
    logSnap.empty ? null : ((logSnap.docs[0].data() ?? {}) as Dict),
    sessions,
    settings.attendance_late_grace_minutes,
  );
});

export const adminListShiftAdherence = onCall(async (request) => {
  await requireStaff(request, "attendance.view");
  const data = (request.data ?? {}) as Data;
  const from = pickDay(data, "from", "p_from");
  const to = pickDay(data, "to", "p_to");
  if (!from || !to || from > to) return [];
  const driverFilter = pickIdList(data, "driverIds", "p_driver_ids");
  const allowed = driverFilter && driverFilter.length ? new Set(driverFilter) : null;

  const db = getFirestore();
  const [settings, logSnap, shiftSnap] = await Promise.all([
    loadAppSettings(),
    db
      .collection(COLLECTIONS.attendanceLogs)
      .where(ATT.logDate, ">=", from)
      .where(ATT.logDate, "<=", to)
      .limit(SCAN_CAP + 1)
      .get(),
    db
      .collection(COLLECTIONS.driverDailyShifts)
      .where("shift_date", ">=", from)
      .where("shift_date", "<=", to)
      .limit(SCAN_CAP + 1)
      .get(),
  ]);
  if (logSnap.size > SCAN_CAP || shiftSnap.size > SCAN_CAP) {
    throw new HttpsError("out-of-range", "window_too_large");
  }

  const logByPair = new Map<string, Dict>();
  const shiftByPair = new Map<string, Dict>();
  const pairs = new Map<string, { driverId: string; day: string }>();

  const collect = (
    docs: readonly DocumentSnapshot[],
    dayField: string,
    target: Map<string, Dict>,
  ) => {
    for (const doc of docs) {
      const raw = (doc.data() ?? {}) as Dict;
      const driverId = asString(raw[ATT.driverId]);
      const day = asString(raw[dayField]);
      if (!driverId || !day) continue;
      if (allowed && !allowed.has(driverId)) continue;
      const key = `${driverId}|${day}`;
      if (!target.has(key)) target.set(key, raw);
      pairs.set(key, { driverId, day });
    }
  };
  collect(logSnap.docs, ATT.logDate, logByPair);
  collect(shiftSnap.docs, "shift_date", shiftByPair);

  const driverIds = [...new Set([...pairs.values()].map((pair) => pair.driverId))];
  const sessionLists = await inParallel(driverIds, closedSessionsOf);
  const sessionsByDriver = new Map(driverIds.map((id, index) => [id, sessionLists[index]]));

  return [...pairs.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, pair]) => ({
      driver_id: pair.driverId,
      attendance_date: pair.day,
      shift_adherence: computeAdherence(
        pair.day,
        shiftByPair.get(key) ?? null,
        logByPair.get(key) ?? null,
        sessionsByDriver.get(pair.driverId) ?? [],
        settings.attendance_late_grace_minutes,
      ),
    }));
});

// ---------------------------------------------------------------------------
// admin_list_attendance_exceptions
// ---------------------------------------------------------------------------

type ExceptionType =
  | "LateCheckIn"
  | "NoCheckIn"
  | "EarlyLogout"
  | "OfflineDuringShift"
  | "OutsideZone"
  | "MissingLocationUpdates"
  | "NoAssignedShift";

type Severity = "high" | "medium" | "low";

type ExceptionDraft = {
  row: AttendanceRow;
  type: ExceptionType;
  severity: Severity;
  detectedAt: string | null;
  durationSeconds: number | null;
};

function severityRank(severity: Severity): number {
  switch (severity) {
    case "high":
      return 1;
    case "medium":
      return 2;
    case "low":
      return 3;
    default: {
      const unreachable: never = severity;
      return unreachable;
    }
  }
}

function exceptionKey(driverId: string, day: string, type: ExceptionType): string {
  return createHash("md5").update(`${driverId}:${day}:${type}`).digest("hex");
}

function exceptionsOf(row: AttendanceRow, today: string, nowMs: number): ExceptionDraft[] {
  const out: ExceptionDraft[] = [];
  const push = (
    type: ExceptionType,
    severity: Severity,
    detectedAt: string | null,
    durationSeconds: number | null,
  ) => out.push({ row, type, severity, detectedAt, durationSeconds });

  if (row.minutes_late > 0) {
    push("LateCheckIn", "high", row.check_in_at, row.minutes_late * 60);
  }
  if (
    row.scheduled_start_at &&
    !row.check_in_at &&
    !row.is_on_duty &&
    row.log_date === today &&
    nowMs > Date.parse(row.scheduled_start_at)
  ) {
    push(
      "NoCheckIn",
      "high",
      row.scheduled_start_at,
      Math.max(0, Math.round((nowMs - Date.parse(row.scheduled_start_at)) / 1000)),
    );
  }
  if (row.minutes_early_out > 0) {
    push("EarlyLogout", "medium", row.check_out_at, row.minutes_early_out * 60);
  }
  if (row.live_status === "offline_during_shift") {
    push("OfflineDuringShift", "high", row.last_seen_at, null);
  }
  if (row.live_status === "outside_zone") {
    push("OutsideZone", "medium", row.last_seen_at, null);
  }
  if (row.live_status === "gps_stale") {
    push("MissingLocationUpdates", "high", row.last_seen_at, null);
  }
  if (!row.scheduled_start_at && row.check_in_at && row.log_date === today) {
    push("NoAssignedShift", "low", row.check_in_at, null);
  }
  return out;
}

export const adminListAttendanceExceptions = onCall(async (request) => {
  await requireStaff(request, "attendance.view");
  const data = (request.data ?? {}) as Data;
  const now = new Date();
  const today = kuwaitDayString(now);
  const day = pickDay(data, "date", "p_date") ?? today;
  if (!DAY_RE.test(day)) throw new HttpsError("invalid-argument", "invalid_date");
  const needle = (pickText(data, "search", "p_search") ?? "").toLowerCase();
  const unresolvedOnly = pickTriBool(data, "unresolvedOnly", "p_unresolved_only") ?? true;
  const limit = Math.max(pickCount(data, 50, "limit", "p_limit"), 1);
  const offset = Math.max(pickCount(data, 0, "offset", "p_offset"), 0);

  const settings = await loadAppSettings();
  const rows = await loadAttendanceRows(
    { from: day, to: day, partnerId: null, zoneId: null, restaurantId: null },
    settings,
  ).catch(rethrowWindow);

  const drafts = rows.flatMap((row) => exceptionsOf(row, today, now.getTime()));
  const keys = drafts.map((draft) => exceptionKey(draft.row.driver_id, draft.row.log_date, draft.type));

  const db = getFirestore();
  const actions = new Map<string, Dict>();
  for (const group of chunk([...new Set(keys)], 300)) {
    const snaps = await db.getAll(...group.map((key) => db.collection(EXCEPTION_ACTIONS).doc(key)));
    for (const snap of snaps) {
      if (snap.exists) actions.set(snap.id, (snap.data() ?? {}) as Dict);
    }
  }

  const composed = drafts.map((draft, index) => {
    const key = keys[index];
    const action = actions.get(key);
    return {
      exception_key: key,
      driver_id: draft.row.driver_id,
      exception_date: draft.row.log_date,
      exception_type: draft.type,
      severity: draft.severity,
      detected_at: draft.detectedAt,
      duration_seconds: draft.durationSeconds,
      driver_name: draft.row.driver_name,
      driver_code: draft.row.driver_code,
      employee_id: draft.row.employee_id,
      partner_name: draft.row.partner_name,
      zone_name: draft.row.zone_name,
      current_status: draft.row.live_status,
      resolution_status: asString(action?.resolution_status) ?? "open",
      supervisor_action: asString(action?.action),
      supervisor_note: asString(action?.note),
      supervisor_id: asString(action?.supervisor_id),
    };
  });

  const filtered = composed.filter((item) => {
    if (unresolvedOnly && item.resolution_status === "resolved") return false;
    if (!needle) return true;
    return (
      item.driver_name.toLowerCase().includes(needle) ||
      (item.driver_code ?? "").toLowerCase().includes(needle)
    );
  });

  filtered.sort((a, b) => {
    const bySeverity = severityRank(a.severity) - severityRank(b.severity);
    if (bySeverity !== 0) return bySeverity;
    if (a.detected_at === b.detected_at) return 0;
    if (a.detected_at === null) return 1;
    if (b.detected_at === null) return -1;
    return Date.parse(b.detected_at) - Date.parse(a.detected_at);
  });

  return {
    totalCount: filtered.length,
    rows: filtered.slice(offset, offset + limit),
  };
});

// ---------------------------------------------------------------------------
// Duty sweeps
// ---------------------------------------------------------------------------

async function onDutyDrivers(): Promise<Array<{ id: string; data: Dict }>> {
  const snap = await getFirestore()
    .collection(COLLECTIONS.drivers)
    .where("is_on_duty", "==", true)
    .limit(SCAN_CAP + 1)
    .get();
  if (snap.size > SCAN_CAP) throw new HttpsError("out-of-range", "driver_scan_too_large");
  return snap.docs
    .map((doc) => ({ id: doc.id, data: (doc.data() ?? {}) as Dict }))
    .filter((driver) => driver.data[FIELDS.drivers.archivedAt] == null);
}

async function latestOpenLog(driverId: string): Promise<DocumentSnapshot | null> {
  const snap = await getFirestore()
    .collection(COLLECTIONS.attendanceLogs)
    .where(ATT.driverId, "==", driverId)
    .where(ATT.checkOutAt, "==", null)
    .limit(50)
    .get();
  let best: DocumentSnapshot | null = null;
  let bestAt = -Infinity;
  for (const doc of snap.docs) {
    const checkIn = asDate(doc.get(ATT.checkInAt));
    if (!checkIn) continue;
    if (checkIn.getTime() > bestAt) {
      best = doc;
      bestAt = checkIn.getTime();
    }
  }
  return best;
}

async function onlineSessionsOf(driverId: string): Promise<DocumentSnapshot[]> {
  const snap = await getFirestore()
    .collection(COLLECTIONS.driverSessions)
    .where(ATT.driverId, "==", driverId)
    .where("is_online", "==", true)
    .get();
  return snap.docs;
}

function latestBy(docs: readonly DocumentSnapshot[], field: string): DocumentSnapshot | null {
  let best: DocumentSnapshot | null = null;
  let bestAt = -Infinity;
  for (const doc of docs) {
    const at = asDate(doc.get(field))?.getTime() ?? -Infinity;
    if (!best || at > bestAt) {
      best = doc;
      bestAt = at;
    }
  }
  return best;
}

/**
 * `_attendance_apply_checkout` / `_driver_end_duty_keep_gps`: duty off, the
 * open session closed, the open log stamped. The GPS row is left alone so the
 * map keeps the Offline pin.
 */
async function applyCheckout(
  driverId: string,
  reason: string,
  openLog: DocumentSnapshot | null,
  distanceMeters: number | null,
): Promise<void> {
  const db = getFirestore();
  const now = Timestamp.now();
  const sessions = await onlineSessionsOf(driverId);
  const batch = db.batch();

  batch.update(db.collection(COLLECTIONS.drivers).doc(driverId), {
    is_on_duty: false,
    updated_at: now,
  });

  const session = latestBy(sessions, "went_online_at");
  if (session) {
    const wentOnline = asDate(session.get("went_online_at"));
    const elapsed = wentOnline
      ? Math.max(0, Math.round((now.toMillis() - wentOnline.getTime()) / 1000))
      : 0;
    batch.update(session.ref, {
      is_online: false,
      went_offline_at: session.get("went_offline_at") ?? now,
      updated_at: now,
    });
    if (openLog && elapsed > 0) {
      const previous = numberOrNull(openLog.get(ATT.onlineSeconds)) ?? 0;
      batch.update(openLog.ref, { [ATT.onlineSeconds]: previous + elapsed });
    }
  }

  if (openLog) {
    const patch: Dict = {
      [ATT.checkOutAt]: now,
      [ATT.checkOutReason]: reason,
      [ATT.isOnDuty]: false,
      updated_at: now,
    };
    const existingDistance = numberOrNull(openLog.get("distance_meters"));
    if (distanceMeters !== null || existingDistance !== null) {
      patch.distance_meters = distanceMeters ?? existingDistance;
    }
    batch.update(openLog.ref, patch);
  }

  await batch.commit();
}

async function autoCheckoutMinutes(): Promise<number> {
  const snap = await getFirestore().collection(COLLECTIONS.appSettings).doc("1").get();
  const value = numberOrNull(snap.get("attendance_auto_checkout_minutes"));
  return Math.max(Math.trunc(value ?? 45), 1);
}

type AutoReason = "auto_shift_end" | "auto_offline" | "auto_out_of_zone";

export const adminRunAttendanceAutoCheckout = onCall(async (request) => {
  await requireStaff(request);
  const db = getFirestore();
  const minutes = await autoCheckoutMinutes();
  const now = new Date();
  const today = kuwaitDayString(now);
  const cutoff = new Date(now.getTime() - minutes * 60_000);

  const drivers = await onDutyDrivers();
  const outcomes = await inParallel(drivers, async (driver) => {
    const [openLog, online, closed, locationSnap] = await Promise.all([
      latestOpenLog(driver.id),
      onlineSessionsOf(driver.id),
      closedSessionsOf(driver.id),
      db.collection(COLLECTIONS.driverLocations).doc(driver.id).get(),
    ]);

    let offlineAt: Date | null = null;
    if (online.length === 0) {
      for (const session of closed) {
        const at = asDate(session.went_offline_at);
        if (at && (!offlineAt || at > offlineAt)) offlineAt = at;
      }
    }
    const location = (locationSnap.data() ?? {}) as Dict;
    const outOfZoneSince = asDate(location.out_of_zone_since);
    const openLogDate = openLog ? asString(openLog.get(ATT.logDate)) : null;

    let shiftEnd: Date | null = null;
    if (openLogDate) {
      const shiftSnap = await db
        .collection(COLLECTIONS.driverDailyShifts)
        .where(ATT.driverId, "==", driver.id)
        .where("shift_date", "==", openLogDate)
        .limit(1)
        .get();
      if (!shiftSnap.empty) {
        shiftEnd = shiftEndAt((shiftSnap.docs[0].data() ?? {}) as Dict, openLogDate);
      }
    }

    let reason: AutoReason | null = null;
    if (!openLog) reason = "auto_shift_end";
    else if (shiftEnd && now >= shiftEnd) reason = "auto_shift_end";
    else if (openLogDate && openLogDate < today) reason = "auto_shift_end";
    else if (offlineAt && offlineAt <= cutoff) reason = "auto_offline";
    else if (outOfZoneSince && outOfZoneSince <= cutoff) reason = "auto_out_of_zone";
    if (!reason) return 0;

    await applyCheckout(
      driver.id,
      reason,
      openLog,
      numberOrNull(location[FIELDS.driverLocations.distanceTodayMeters]),
    );
    await logDriverOperation({
      driverId: driver.id,
      module: "duty",
      action: "duty.auto_checkout",
      actor: "cron",
      recordType: openLog ? "attendance_log" : null,
      recordId: openLog?.id ?? null,
      detail: {
        reason,
        threshold_minutes: minutes,
        offline_since: iso(offlineAt),
        out_of_zone_since: iso(outOfZoneSince),
        shift_end_at: iso(shiftEnd),
        open_log_date: openLogDate,
      },
    });
    return 1;
  });

  return outcomes.reduce<number>((sum, value) => sum + value, 0);
});

export const adminRunFreezeStartCheckout = onCall(async (request) => {
  await requireStaff(request);
  const today = kuwaitDayString(new Date());

  const frozen = (await onDutyDrivers()).filter((driver) => {
    const from = asString(driver.data.frozen_from);
    const until = asString(driver.data.frozen_until);
    return Boolean(from && until && from <= today && today <= until);
  });

  const outcomes = await inParallel(frozen, async (driver) => {
    const openLog = await latestOpenLog(driver.id);
    await applyCheckout(driver.id, "admin", openLog, null);
    await logDriverOperation({
      driverId: driver.id,
      module: "duty",
      action: "duty.frozen_checkout",
      actor: "cron",
      recordType: openLog ? "attendance_log" : null,
      recordId: openLog?.id ?? null,
      detail: { reason: "freeze_window_started" },
    });
    return 1;
  });

  return outcomes.reduce<number>((sum, value) => sum + value, 0);
});
