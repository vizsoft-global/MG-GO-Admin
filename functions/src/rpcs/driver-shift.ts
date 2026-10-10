import { onCall } from "firebase-functions/v2/https";
import { getFirestore, FieldValue, Timestamp } from "../core/fs";
import { COLLECTIONS } from "../core/collections";
import { kuwaitDayStart, kuwaitDayString } from "../core/kuwait";
import { requireRider, riderError } from "../core/rider";
import { isoTimestamp, logDriverOperation, pickDay, pickText, type Dict } from "./_shared";

const DAY_MS = 24 * 60 * 60 * 1000;
const TIME_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;

export type ShiftType = "single" | "split";

export type ShiftTime = { hours: number; minutes: number; seconds: number };

export type ShiftRow = {
  id: string;
  driver_id: string;
  shift_date: string;
  shift_type: ShiftType;
  session1_start: string;
  session1_end: string;
  session1_end_day_offset: number;
  session2_start: string | null;
  session2_end: string | null;
  session2_start_day_offset: number;
  session2_end_day_offset: number;
  submitted_at: unknown;
};

export type ValidatedShift = {
  shift_type: ShiftType;
  shift_date: string;
  session1_start: string;
  session1_end: string;
  session1_end_day_offset: number;
  session2_start: string | null;
  session2_end: string | null;
  session2_start_day_offset: number;
  session2_end_day_offset: number;
  shift_end: Date;
};

export type ShiftValidation =
  | { ok: true; value: ValidatedShift }
  | { ok: false; error: string };

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function parseShiftTime(value: unknown): ShiftTime | null {
  if (typeof value !== "string") return null;
  const match = TIME_RE.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = match[3] ? Number(match[3]) : 0;
  if (hours > 23 || minutes > 59 || seconds > 59) return null;
  return { hours, minutes, seconds };
}

export function formatShiftTime(time: ShiftTime): string {
  return `${pad2(time.hours)}:${pad2(time.minutes)}:${pad2(time.seconds)}`;
}

export function shiftTimeMinutes(time: ShiftTime): number {
  return time.hours * 60 + time.minutes + time.seconds / 60;
}

/** `_shift_end_day_offset` — overnight when the clock end is at or before start. */
export function shiftEndDayOffset(start: ShiftTime, end: ShiftTime): number {
  return shiftTimeMinutes(end) <= shiftTimeMinutes(start) ? 1 : 0;
}

/** `shift_session_instant`: Kuwait calendar day + clock + day offset. */
export function shiftSessionInstant(shiftDate: string, time: ShiftTime, dayOffset: number): Date {
  const midnight = kuwaitDayStart(shiftDate).getTime() + dayOffset * DAY_MS;
  return new Date(midnight + (time.hours * 3600 + time.minutes * 60 + time.seconds) * 1000);
}

export function shiftEndAt(row: {
  shift_date: string;
  shift_type: string;
  session1_end: string;
  session1_end_day_offset: number;
  session2_end: string | null;
  session2_end_day_offset: number | null;
}): Date | null {
  const s1End = parseShiftTime(row.session1_end);
  if (!s1End) return null;
  const session1End = shiftSessionInstant(row.shift_date, s1End, row.session1_end_day_offset ?? 0);
  if (row.shift_type === "split" && row.session2_end) {
    const s2End = parseShiftTime(row.session2_end);
    if (!s2End) return session1End;
    const session2End = shiftSessionInstant(
      row.shift_date,
      s2End,
      row.session2_end_day_offset ?? 0,
    );
    return session2End > session1End ? session2End : session1End;
  }
  return session1End;
}

export function validateDailyShift(args: {
  shiftType: string | null;
  session1Start: unknown;
  session1End: unknown;
  session2Start: unknown;
  session2End: unknown;
  shiftDate: string | null;
  today: string;
}): ShiftValidation {
  const shiftType = args.shiftType;
  if (shiftType !== "single" && shiftType !== "split") {
    return { ok: false, error: "invalid_shift_type" };
  }
  if (args.shiftDate && args.shiftDate > args.today) {
    return { ok: false, error: "future_date" };
  }
  const s1Start = parseShiftTime(args.session1Start);
  const s1End = parseShiftTime(args.session1End);
  if (!s1Start || !s1End) {
    return { ok: false, error: "session1_required" };
  }

  const s1EndOffset = shiftEndDayOffset(s1Start, s1End);
  const shiftDate = args.shiftDate ?? args.today;
  const s1StartAt = shiftSessionInstant(shiftDate, s1Start, 0);
  const s1EndAt = shiftSessionInstant(shiftDate, s1End, s1EndOffset);
  if (s1EndAt.getTime() <= s1StartAt.getTime()) {
    return { ok: false, error: "invalid_session1_duration" };
  }
  if (s1EndAt.getTime() - s1StartAt.getTime() > DAY_MS) {
    return { ok: false, error: "session_too_long" };
  }

  if (shiftType === "split") {
    const s2Start = parseShiftTime(args.session2Start);
    const s2End = parseShiftTime(args.session2End);
    if (!s2Start || !s2End) {
      return { ok: false, error: "session2_required" };
    }
    if (s1EndOffset === 0 && shiftTimeMinutes(s2Start) < shiftTimeMinutes(s1End)) {
      return { ok: false, error: "sessions_overlap" };
    }

    let s2StartOffset: number | null = null;
    let s2StartAt = s1EndAt;
    for (let offset = 0; offset <= 2; offset += 1) {
      const candidate = shiftSessionInstant(shiftDate, s2Start, offset);
      if (candidate.getTime() >= s1EndAt.getTime()) {
        s2StartOffset = offset;
        s2StartAt = candidate;
        break;
      }
    }
    if (s2StartOffset === null) {
      return { ok: false, error: "sessions_overlap" };
    }

    const s2EndOffset =
      shiftTimeMinutes(s2End) <= shiftTimeMinutes(s2Start) ? s2StartOffset + 1 : s2StartOffset;
    const s2EndAt = shiftSessionInstant(shiftDate, s2End, s2EndOffset);
    if (s2EndAt.getTime() <= s2StartAt.getTime()) {
      return { ok: false, error: "invalid_session2_duration" };
    }
    if (s2EndAt.getTime() - s2StartAt.getTime() > DAY_MS) {
      return { ok: false, error: "session_too_long" };
    }

    return {
      ok: true,
      value: {
        shift_type: shiftType,
        shift_date: shiftDate,
        session1_start: formatShiftTime(s1Start),
        session1_end: formatShiftTime(s1End),
        session1_end_day_offset: s1EndOffset,
        session2_start: formatShiftTime(s2Start),
        session2_end: formatShiftTime(s2End),
        session2_start_day_offset: s2StartOffset,
        session2_end_day_offset: s2EndOffset,
        shift_end: s2EndAt > s1EndAt ? s2EndAt : s1EndAt,
      },
    };
  }

  if (parseShiftTime(args.session2Start) || parseShiftTime(args.session2End)) {
    return { ok: false, error: "session2_not_allowed" };
  }

  return {
    ok: true,
    value: {
      shift_type: shiftType,
      shift_date: shiftDate,
      session1_start: formatShiftTime(s1Start),
      session1_end: formatShiftTime(s1End),
      session1_end_day_offset: s1EndOffset,
      session2_start: null,
      session2_end: null,
      session2_start_day_offset: 0,
      session2_end_day_offset: 0,
      shift_end: s1EndAt,
    },
  };
}

function shiftTypeOf(value: unknown): ShiftType {
  return value === "split" ? "split" : "single";
}

function numberField(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function shiftFromDoc(id: string, raw: Dict): ShiftRow | null {
  const driverId = asString(raw["driver_id"]);
  const shiftDate = asString(raw["shift_date"]);
  const session1Start = asString(raw["session1_start"]);
  const session1End = asString(raw["session1_end"]);
  if (!driverId || !shiftDate || !session1Start || !session1End) return null;
  return {
    id,
    driver_id: driverId,
    shift_date: shiftDate.slice(0, 10),
    shift_type: shiftTypeOf(raw["shift_type"]),
    session1_start: session1Start,
    session1_end: session1End,
    session1_end_day_offset: numberField(raw["session1_end_day_offset"]),
    session2_start: asString(raw["session2_start"]),
    session2_end: asString(raw["session2_end"]),
    session2_start_day_offset: numberField(raw["session2_start_day_offset"]),
    session2_end_day_offset: numberField(raw["session2_end_day_offset"]),
    submitted_at: raw["submitted_at"] ?? null,
  };
}

/** `_shift_row_to_json`. */
export function shiftRowToJson(row: ShiftRow, now: Date): Dict {
  const s1Start = parseShiftTime(row.session1_start);
  const s1End = parseShiftTime(row.session1_end);
  if (!s1Start || !s1End) return { id: row.id, driver_id: row.driver_id, shift_date: row.shift_date };

  const session1StartAt = shiftSessionInstant(row.shift_date, s1Start, 0);
  const session1EndAt = shiftSessionInstant(row.shift_date, s1End, row.session1_end_day_offset);
  let session2StartAt: Date | null = null;
  let session2EndAt: Date | null = null;
  let shiftEnd = session1EndAt;
  let within = now.getTime() >= session1StartAt.getTime() && now.getTime() < session1EndAt.getTime();

  if (row.shift_type === "split" && row.session2_start && row.session2_end) {
    const s2Start = parseShiftTime(row.session2_start);
    const s2End = parseShiftTime(row.session2_end);
    if (s2Start && s2End) {
      session2StartAt = shiftSessionInstant(row.shift_date, s2Start, row.session2_start_day_offset);
      session2EndAt = shiftSessionInstant(row.shift_date, s2End, row.session2_end_day_offset);
      if (session2EndAt > shiftEnd) shiftEnd = session2EndAt;
      within =
        (now.getTime() >= session1StartAt.getTime() && now.getTime() < session1EndAt.getTime()) ||
        (now.getTime() >= session2StartAt.getTime() && now.getTime() < session2EndAt.getTime());
    }
  }

  return {
    id: row.id,
    driver_id: row.driver_id,
    shift_date: row.shift_date,
    shift_type: row.shift_type,
    session1_start: row.session1_start,
    session1_end: row.session1_end,
    session1_end_day_offset: row.session1_end_day_offset,
    session2_start: row.session2_start,
    session2_end: row.session2_end,
    session2_start_day_offset: row.session2_start_day_offset,
    session2_end_day_offset: row.session2_end_day_offset,
    session1_start_at: session1StartAt.toISOString(),
    session1_end_at: session1EndAt.toISOString(),
    session2_start_at: session2StartAt ? session2StartAt.toISOString() : null,
    session2_end_at: session2EndAt ? session2EndAt.toISOString() : null,
    session1_crosses_midnight: row.session1_end_day_offset > 0,
    session2_crosses_midnight:
      (row.session2_end_day_offset ?? 0) > (row.session2_start_day_offset ?? 0) ||
      (row.shift_type === "split" &&
        !!row.session2_start &&
        !!row.session2_end &&
        shiftTimeMinutes(parseShiftTime(row.session2_end) ?? { hours: 0, minutes: 0, seconds: 0 }) <=
          shiftTimeMinutes(parseShiftTime(row.session2_start) ?? { hours: 0, minutes: 0, seconds: 0 })),
    shift_end_at: shiftEnd.toISOString(),
    is_within_window: within,
    is_locked: now.getTime() < shiftEnd.getTime(),
    submitted_at: isoTimestamp(row.submitted_at),
  };
}

function addKuwaitDays(day: string, days: number): string {
  return kuwaitDayString(kuwaitDayStart(day).getTime() + days * DAY_MS);
}

async function loadShiftOnDate(driverId: string, shiftDate: string): Promise<ShiftRow | null> {
  const snap = await getFirestore()
    .collection(COLLECTIONS.driverDailyShifts)
    .where("driver_id", "==", driverId)
    .where("shift_date", "==", shiftDate)
    .limit(1)
    .get();
  if (snap.empty) return null;
  return shiftFromDoc(snap.docs[0].id, (snap.docs[0].data() ?? {}) as Dict);
}

/**
 * `_driver_find_active_shift`: Kuwait today, else yesterday if still unexpired.
 */
export async function findActiveShift(driverId: string, now: Date): Promise<ShiftRow | null> {
  const today = kuwaitDayString(now);
  const yesterday = addKuwaitDays(today, -1);
  for (const day of [today, yesterday]) {
    const row = await loadShiftOnDate(driverId, day);
    if (!row) continue;
    const end = shiftEndAt(row);
    if (end && now.getTime() < end.getTime()) return row;
  }
  return null;
}

function throwShiftError(error: string): never {
  throw riderError("failed-precondition", error);
}

export const driverGetTodayShift = onCall(async (request) => {
  const { uid } = await requireRider(request);
  const now = new Date();
  const row = await findActiveShift(uid, now);
  return { shift: row ? shiftRowToJson(row, now) : null };
});

export const driverSubmitDailyShift = onCall(async (request) => {
  const { uid } = await requireRider(request);
  const data = (request.data ?? {}) as Dict;
  const now = new Date();
  const today = kuwaitDayString(now);

  const validated = validateDailyShift({
    shiftType: pickText(data, "shift_type", "p_shift_type"),
    session1Start: data["session1_start"] ?? data["p_session1_start"],
    session1End: data["session1_end"] ?? data["p_session1_end"],
    session2Start: data["session2_start"] ?? data["p_session2_start"],
    session2End: data["session2_end"] ?? data["p_session2_end"],
    shiftDate: pickDay(data, "shift_date", "p_shift_date"),
    today,
  });
  if (!validated.ok) throwShiftError(validated.error);

  const existing = await loadShiftOnDate(uid, validated.value.shift_date);
  if (existing) {
    const lockedUntil = shiftEndAt(existing);
    if (lockedUntil && now.getTime() < lockedUntil.getTime()) {
      throw riderError("failed-precondition", "shift_locked", {
        shift_date: existing.shift_date,
        locked_until: lockedUntil.toISOString(),
      });
    }
  }

  const db = getFirestore();
  const stamp = Timestamp.fromDate(now);
  const payload: Dict = {
    driver_id: uid,
    shift_date: validated.value.shift_date,
    shift_type: validated.value.shift_type,
    session1_start: validated.value.session1_start,
    session1_end: validated.value.session1_end,
    session1_end_day_offset: validated.value.session1_end_day_offset,
    session2_start: validated.value.session2_start,
    session2_end: validated.value.session2_end,
    session2_start_day_offset: validated.value.session2_start_day_offset,
    session2_end_day_offset: validated.value.session2_end_day_offset,
    submitted_at: stamp,
    updated_at: FieldValue.serverTimestamp(),
  };

  const ref = existing
    ? db.collection(COLLECTIONS.driverDailyShifts).doc(existing.id)
    : db.collection(COLLECTIONS.driverDailyShifts).doc();
  await ref.set(payload, { merge: true });

  const saved: ShiftRow = {
    id: ref.id,
    driver_id: uid,
    shift_date: validated.value.shift_date,
    shift_type: validated.value.shift_type,
    session1_start: validated.value.session1_start,
    session1_end: validated.value.session1_end,
    session1_end_day_offset: validated.value.session1_end_day_offset,
    session2_start: validated.value.session2_start,
    session2_end: validated.value.session2_end,
    session2_start_day_offset: validated.value.session2_start_day_offset,
    session2_end_day_offset: validated.value.session2_end_day_offset,
    submitted_at: stamp,
  };

  await logDriverOperation({
    driverId: uid,
    module: "duty",
    action: "shift.submit",
    actor: "rpc",
    success: true,
    recordType: "daily_shift",
    recordId: ref.id,
    detail: {
      shift_date: saved.shift_date,
      shift_type: saved.shift_type,
      resubmitted: existing !== null,
    },
  });

  return { shift: shiftRowToJson(saved, now) };
});
