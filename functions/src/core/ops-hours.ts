import { kuwaitDayStart } from "./kuwait";
import { positiveRatio } from "./ops-kpi";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const TIME_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;

export type TimeSpan = { startMs: number; endMs: number };

export function mergeSpans(spans: readonly TimeSpan[]): TimeSpan[] {
  const valid = spans
    .filter((span) => span.startMs < span.endMs)
    .slice()
    .sort((a, b) => a.startMs - b.startMs);
  const out: TimeSpan[] = [];
  for (const span of valid) {
    const last = out[out.length - 1];
    if (!last || span.startMs > last.endMs) {
      out.push({ startMs: span.startMs, endMs: span.endMs });
      continue;
    }
    last.endMs = Math.max(last.endMs, span.endMs);
  }
  return out;
}

export function overlapMs(a: TimeSpan, b: TimeSpan): number {
  const start = Math.max(a.startMs, b.startMs);
  const end = Math.min(a.endMs, b.endMs);
  return end > start ? end - start : 0;
}

export type ShiftSessionInput = {
  id: string;
  driverId: string;
  day: string;
  isOff: boolean;
  shiftType: string;
  session1Start: string | null;
  session1End: string | null;
  session1EndDayOffset: number;
  session2Start: string | null;
  session2End: string | null;
  session2StartDayOffset: number;
  session2EndDayOffset: number;
};

export type AttendanceLogInput = {
  driverId: string;
  day: string;
  checkIn: Date | null;
  checkOut: Date | null;
};

function clockMs(day: string, clock: string | null, dayOffset: number): number | null {
  if (!clock) return null;
  const match = TIME_RE.exec(clock.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] ?? 0);
  if (hours > 23 || minutes > 59 || seconds > 59) return null;
  return (
    kuwaitDayStart(day).getTime() +
    dayOffset * DAY_MS +
    ((hours * 60 + minutes) * 60 + seconds) * 1000
  );
}

function sessionSpan(
  day: string,
  start: string | null,
  end: string | null,
  startOffset: number,
  endOffset: number,
): TimeSpan | null {
  const startMs = clockMs(day, start, startOffset);
  const endMs = clockMs(day, end, endOffset);
  if (startMs == null || endMs == null || startMs >= endMs) return null;
  return { startMs, endMs };
}

export function shiftSessions(shift: ShiftSessionInput): TimeSpan[] {
  if (shift.isOff) return [];
  const out: TimeSpan[] = [];
  const first = sessionSpan(
    shift.day,
    shift.session1Start,
    shift.session1End,
    0,
    shift.session1EndDayOffset,
  );
  if (first) out.push(first);
  if (shift.shiftType === "split") {
    const second = sessionSpan(
      shift.day,
      shift.session2Start,
      shift.session2End,
      shift.session2StartDayOffset,
      shift.session2EndDayOffset,
    );
    if (second) out.push(second);
  }
  return out;
}

function dayKey(driverId: string, day: string): string {
  return `${driverId}\t${day}`;
}

export function onShiftHoursByDriver(input: {
  logs: readonly AttendanceLogInput[];
  shifts: readonly ShiftSessionInput[];
  now: Date;
}): { hoursByDriver: Map<string, number>; hoursByDriverDay: Map<string, number> } {
  const uniqueShifts = new Map<string, ShiftSessionInput>();
  for (const shift of input.shifts) {
    if (!uniqueShifts.has(shift.id)) uniqueShifts.set(shift.id, shift);
  }

  const sessionsByDay = new Map<string, TimeSpan[]>();
  for (const shift of uniqueShifts.values()) {
    const key = dayKey(shift.driverId, shift.day);
    const existing = sessionsByDay.get(key) ?? [];
    existing.push(...shiftSessions(shift));
    sessionsByDay.set(key, existing);
  }
  for (const [key, spans] of sessionsByDay) {
    sessionsByDay.set(key, mergeSpans(spans));
  }

  const nowMs = input.now.getTime();
  const loginsByDay = new Map<string, TimeSpan[]>();
  for (const log of input.logs) {
    const checkIn = log.checkIn?.getTime();
    if (checkIn == null) continue;
    const checkOut = log.checkOut?.getTime() ?? nowMs;
    if (checkIn >= checkOut) continue;
    const key = dayKey(log.driverId, log.day);
    const list = loginsByDay.get(key) ?? [];
    list.push({ startMs: checkIn, endMs: checkOut });
    loginsByDay.set(key, list);
  }

  const hoursByDriverDay = new Map<string, number>();
  const hoursByDriver = new Map<string, number>();
  const keys = new Set([...sessionsByDay.keys(), ...loginsByDay.keys()]);
  for (const key of keys) {
    const sessions = sessionsByDay.get(key) ?? [];
    const logins = mergeSpans(loginsByDay.get(key) ?? []);
    if (sessions.length === 0 || logins.length === 0) continue;
    let ms = 0;
    for (const login of logins) {
      for (const session of sessions) ms += overlapMs(login, session);
    }
    if (ms <= 0) continue;
    const hours = ms / HOUR_MS;
    hoursByDriverDay.set(key, hours);
    const sep = key.indexOf("\t");
    const driverId = key.slice(0, sep);
    hoursByDriver.set(driverId, (hoursByDriver.get(driverId) ?? 0) + hours);
  }
  return { hoursByDriver, hoursByDriverDay };
}

export function fullPopulationDpds(
  riders: readonly {
    restaurantId: string | null;
    zoneId: string | null;
    vehicleKey: string | null;
    orders: number;
    workingDays: number;
  }[],
): { storeDpd: Map<string, number | null>; zoneVehicleDpd: Map<string, number | null> } {
  const store = new Map<string, { orders: number; days: number }>();
  const zoneVehicle = new Map<string, { orders: number; days: number }>();
  for (const rider of riders) {
    const storeKey = rider.restaurantId ?? "—";
    const storeRow = store.get(storeKey) ?? { orders: 0, days: 0 };
    storeRow.orders += rider.orders;
    storeRow.days += rider.workingDays;
    store.set(storeKey, storeRow);
    const zvKey = `${rider.zoneId ?? "—"}|${rider.vehicleKey ?? "—"}`;
    const zvRow = zoneVehicle.get(zvKey) ?? { orders: 0, days: 0 };
    zvRow.orders += rider.orders;
    zvRow.days += rider.workingDays;
    zoneVehicle.set(zvKey, zvRow);
  }
  const storeDpd = new Map<string, number | null>();
  for (const [key, row] of store) storeDpd.set(key, positiveRatio(row.orders, row.days));
  const zoneVehicleDpd = new Map<string, number | null>();
  for (const [key, row] of zoneVehicle) {
    zoneVehicleDpd.set(key, positiveRatio(row.orders, row.days));
  }
  return { storeDpd, zoneVehicleDpd };
}
