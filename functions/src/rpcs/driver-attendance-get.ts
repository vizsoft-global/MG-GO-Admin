/**
 * Rider month grid — port of `driver_get_attendance` (`20261109000100`).
 *
 * Reads `driver_attendance` (the day rollup duty writes), not `attendance_logs`.
 * present_days counts present + online_unvalidated up to Kuwait today.
 */
import { measureOnCall } from "../core/fs-metrics";
import { getFirestore, Timestamp } from "../core/fs";
import { COLLECTIONS } from "../core/collections";
import { kuwaitDayString } from "../core/kuwait";
import { requireRider, riderError } from "../core/rider";
import { attendancePct, elapsedDays, parseWorkPeriod } from "./driver-earnings";
import { parseShiftTime, shiftSessionInstant } from "./driver-shift";
import { numberOrNull, pick, type Dict } from "./_shared";

const DRIVER_ATTENDANCE = "driver_attendance";
const SCAN = 400;

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function asDay(value: unknown): string | null {
  const text = asString(value);
  return text ? text.slice(0, 10) : null;
}

function asDate(value: unknown): Date | null {
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

export function monthBounds(year: number, month: number): { start: string; end: string } {
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { start, end: `${start.slice(0, 7)}-${String(last).padStart(2, "0")}` };
}

/** Live session seconds SQL adds onto today's stored `online_seconds`. */
export function liveOnlineBonus(args: {
  day: string;
  today: string;
  lastOnlineAt: unknown;
  sessionOnline: boolean;
  nowMs: number;
}): number {
  if (!args.sessionOnline || args.day !== args.today) return 0;
  const last = asDate(args.lastOnlineAt);
  if (!last) return 0;
  return Math.max(0, Math.floor((args.nowMs - last.getTime()) / 1000));
}

export function completedAttendanceStatus(status: string | null): boolean {
  return status === "present" || status === "online_unvalidated";
}

function offsetOf(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : 0;
}

export function adherenceFromShift(args: {
  day: string;
  shift: Dict | null;
  actualIn: Date | null;
  actualOut: Date | null;
  onlineSeconds: number;
  graceMinutes: number;
}): Dict | null {
  const shift = args.shift;
  if (!shift) return null;
  const start = parseShiftTime(shift["session1_start"]);
  const end = parseShiftTime(shift["session1_end"]);
  if (!start || !end) return null;

  const scheduledStart = shiftSessionInstant(args.day, start, 0);
  let scheduledEnd = shiftSessionInstant(
    args.day,
    end,
    offsetOf(shift["session1_end_day_offset"]),
  );
  if (asString(shift["shift_type"]) === "split" && shift["session2_end"]) {
    const s2End = parseShiftTime(shift["session2_end"]);
    if (s2End) {
      scheduledEnd = shiftSessionInstant(
        args.day,
        s2End,
        offsetOf(shift["session2_end_day_offset"]),
      );
    }
  }

  const scheduledSeconds = Math.max(
    0,
    Math.floor((scheduledEnd.getTime() - scheduledStart.getTime()) / 1000),
  );

  let minutesLate = 0;
  if (args.actualIn) {
    minutesLate = Math.max(
      0,
      Math.floor((args.actualIn.getTime() - scheduledStart.getTime()) / 60_000) - args.graceMinutes,
    );
  }

  let minutesEarlyOut = 0;
  if (args.actualOut) {
    const clamped =
      args.actualOut.getTime() < scheduledStart.getTime() ? scheduledStart : args.actualOut;
    minutesEarlyOut = Math.min(
      Math.max(0, Math.floor((scheduledEnd.getTime() - clamped.getTime()) / 60_000)),
      Math.floor(scheduledSeconds / 60),
    );
  }

  return {
    scheduled_start_at: scheduledStart.toISOString(),
    scheduled_end_at: scheduledEnd.toISOString(),
    actual_in_at: args.actualIn ? args.actualIn.toISOString() : null,
    actual_out_at: args.actualOut ? args.actualOut.toISOString() : null,
    minutes_late: minutesLate,
    minutes_early_out: minutesEarlyOut,
    online_seconds: args.onlineSeconds,
    scheduled_seconds: scheduledSeconds,
  };
}

export const driverGetAttendance = measureOnCall("driverGetAttendance", async (request) => {
  const ctx = await requireRider(request);
  const data = (request.data ?? {}) as Dict;
  const period = parseWorkPeriod(pick(data, "p_year", "year"), pick(data, "p_month", "month"));
  if (!period) throw riderError("invalid-argument", "invalid_period");

  const today = kuwaitDayString(new Date());
  const { start, end } = monthBounds(period.year, period.month);
  const presentUntil = today < end ? today : end;
  const nowMs = Date.now();
  const db = getFirestore();

  /**
   * Every row this response can use belongs to the requested month, and all
   * four `*_date` fields are `YYYY-MM-DD` strings — a Timestamp-valued row was
   * already dropped by `asDay` below — so each query is bounded by the month
   * instead of scanning the rider's whole history. If the composite index is
   * not deployed the query throws and the un-ranged page runs instead.
   */
  const monthPage = async (collection: string, field: string) => {
    const base = () => db.collection(collection).where("driver_id", "==", ctx.uid);
    try {
      return await base()
        .where(field, ">=", start)
        .where(field, "<=", end)
        .limit(SCAN)
        .get();
    } catch {
      return base().limit(SCAN).get();
    }
  };

  const [attendanceSnap, shiftSnap, logSnap, openSessions] = await Promise.all([
    monthPage(DRIVER_ATTENDANCE, "attendance_date"),
    monthPage(COLLECTIONS.driverDailyShifts, "shift_date"),
    monthPage(COLLECTIONS.attendanceLogs, "log_date"),
    db
      .collection(COLLECTIONS.driverSessions)
      .where("driver_id", "==", ctx.uid)
      .where("is_online", "==", true)
      .limit(1)
      .get(),
  ]);

  // Only "is the rider online right now" is used from sessions, so the open
  // session is the whole question. The old path read the rider's session
  // history just to look at the newest row.
  const sessionOnline = !openSessions.empty;

  const shiftByDay = new Map<string, Dict>();
  for (const doc of shiftSnap.docs) {
    const raw = (doc.data() ?? {}) as Dict;
    const day = asDay(raw["shift_date"]);
    if (day) shiftByDay.set(day, raw);
  }

  const logByDay = new Map<string, Dict>();
  for (const doc of logSnap.docs) {
    const raw = (doc.data() ?? {}) as Dict;
    const day = asDay(raw["log_date"]);
    if (day) logByDay.set(day, raw);
  }

  const rows: Dict[] = [];
  let present = 0;
  for (const doc of attendanceSnap.docs) {
    const raw = (doc.data() ?? {}) as Dict;
    const day = asDay(raw["attendance_date"]);
    if (!day || day < start || day > end) continue;
    const stored = Math.trunc(numberOrNull(raw["online_seconds"]) ?? 0);
    const onlineSeconds =
      stored +
      liveOnlineBonus({
        day,
        today,
        lastOnlineAt: raw["last_online_at"],
        sessionOnline,
        nowMs,
      });
    const status = asString(raw["status"]) ?? "absent";
    if (day <= presentUntil && completedAttendanceStatus(status)) present += 1;
    const log = logByDay.get(day);
    rows.push({
      attendance_date: day,
      online_seconds: onlineSeconds,
      status,
      is_validated: raw["is_validated"] === true,
      validation_source: asString(raw["validation_source"]),
      shift_adherence: adherenceFromShift({
        day,
        shift: shiftByDay.get(day) ?? null,
        actualIn: log ? asDate(log["check_in_at"]) : asDate(raw["first_online_at"]),
        actualOut: log ? asDate(log["check_out_at"]) : null,
        onlineSeconds,
        graceMinutes: 0,
      }),
    });
  }
  rows.sort((a, b) => String(a["attendance_date"]).localeCompare(String(b["attendance_date"])));

  const elapsed = elapsedDays(today, period.year, period.month);
  return {
    ok: true,
    year: period.year,
    month: period.month,
    present_days: present,
    elapsed_days: elapsed,
    attendance_pct: attendancePct(present, elapsed),
    rows,
  };
});
