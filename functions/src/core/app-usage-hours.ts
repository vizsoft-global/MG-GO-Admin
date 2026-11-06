/**
 * App-usage hours, measured the way a shift is actually worked.
 *
 * The Application Attendance tab used to print `check_out − check_in` as one
 * number, so a rider who forgot to clock out read 19 h or 23 h and a night shift
 * landed entirely on the day it started. This module is the two corrections that
 * fix it, and nothing else:
 *
 *  1. **Split every span at Kuwait midnight** (`splitSpanByDay`). A 22:00 →
 *     06:00 shift is 2 h on the day it started and 6 h on the next one, so no
 *     single day can exceed 24 h and a night shift stops being invisible.
 *  2. **Clip each day's pieces to that day's shift windows** (`appUsageHoursByDay`).
 *     Time the app was open outside the rota is not work, and that is what made
 *     23 h possible.
 *  3. **Ceil a single day at one working day** (`MAX_DAY_HOURS`). A day the rota
 *     does not cover has no window to clip against, and the fleet has plenty of
 *     those — a rider whose shift row is missing or whose log was closed by the
 *     midnight auto-checkout reads 23 h off a clock that was simply never
 *     stopped. The tab measures usage **against a shift**, so it prints at most
 *     the longest working day any client runs rather than a number no shift can
 *     account for.
 *
 * Both geometric rules are union-based (`unionMs`), not summed, because a split
 * shift has two overlapping windows and a rider cannot work the same minute
 * twice.
 *
 * This is a **usage record**. Nothing here feeds `loggedHours`, `creditedHours`
 * or a payroll rule — a rider paid on `ACT` still reads the attendance clock, so
 * clipping this number cannot move anyone's pay.
 */
import { kuwaitDayEnd, kuwaitDayStart, kuwaitDayString } from "./kuwait";

export type InstantSpan = { startMs: number; endMs: number };

const DAY_MS = 24 * 60 * 60 * 1000;
/** A span longer than this is a clock that never stopped; split it, do not trust it. */
const MAX_SPAN_DAYS = 45;
/**
 * The most a single Kuwait day can be credited to the app.
 *
 * One working day is 12 h on Americana and 10 h on Keeta, so a cell above 12 is
 * not a long day — it is a clock that was never stopped. Days without a rota row
 * are held to this ceiling too: an uncapped fallback is what let 23 h through.
 */
export const MAX_DAY_HOURS = 12;

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** One span, cut at every Kuwait midnight it crosses, keyed by the day it lands on. */
export function splitSpanByDay(span: InstantSpan): Array<{ day: string } & InstantSpan> {
  const out: Array<{ day: string } & InstantSpan> = [];
  if (!(Number.isFinite(span.startMs) && Number.isFinite(span.endMs))) return out;
  if (span.endMs <= span.startMs) return out;

  let cursor = span.startMs;
  for (let guard = 0; guard < MAX_SPAN_DAYS && cursor < span.endMs; guard += 1) {
    const day = kuwaitDayString(cursor);
    const stop = Math.min(span.endMs, kuwaitDayEnd(day).getTime());
    if (stop > cursor) out.push({ day, startMs: cursor, endMs: stop });
    cursor = stop;
  }
  return out;
}

/** Total length of the union of intervals — an overlap is counted once. */
export function unionMs(spans: readonly InstantSpan[]): number {
  const sorted = spans.filter((s) => s.endMs > s.startMs).sort((a, b) => a.startMs - b.startMs);
  let total = 0;
  let openStart: number | null = null;
  let openEnd = 0;
  for (const span of sorted) {
    if (openStart === null) {
      openStart = span.startMs;
      openEnd = span.endMs;
      continue;
    }
    if (span.startMs <= openEnd) {
      if (span.endMs > openEnd) openEnd = span.endMs;
      continue;
    }
    total += openEnd - openStart;
    openStart = span.startMs;
    openEnd = span.endMs;
  }
  if (openStart !== null) total += openEnd - openStart;
  return total;
}

/** The overlap of two interval sets, still as intervals. */
export function intersectMs(a: readonly InstantSpan[], b: readonly InstantSpan[]): InstantSpan[] {
  const out: InstantSpan[] = [];
  for (const left of a) {
    for (const right of b) {
      const startMs = Math.max(left.startMs, right.startMs);
      const endMs = Math.min(left.endMs, right.endMs);
      if (endMs > startMs) out.push({ startMs, endMs });
    }
  }
  return out;
}

/**
 * `HH:mm` or `HH:mm:ss` → seconds after Kuwait midnight, or `null`.
 *
 * The rota stores a wall clock (`"17:00:00"`), never an instant, so this is the
 * only way back to a window for the rows the fleet actually holds.
 */
export function clockSecondsOf(clock: unknown): number | null {
  if (typeof clock !== "string") return null;
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(clock.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = match[3] ? Number(match[3]) : 0;
  if (hours > 24 || minutes > 59 || seconds > 59) return null;
  if (hours === 24 && (minutes > 0 || seconds > 0)) return null;
  return hours * 3600 + minutes * 60 + seconds;
}

function dayOffsetOf(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

/**
 * One scheduled session as absolute instants.
 *
 * A rider-submitted shift row carries the wall clock plus an **end**-of-day
 * offset and no instant fields at all:
 *
 *     { shift_date: "2026-11-01", session1_start: "17:00:00",
 *       session1_end: "05:00:00", session1_end_day_offset: 1 }
 *
 * The roster import writes the same shape. Only a few writers also stamp
 * `session1_start_at` / `session1_end_at`, so a caller that reads the instants
 * alone finds **no** window on the rows the fleet has — which is exactly how
 * every day fell back to uncapped and 23 h reached the tab.
 */
export function shiftSessionWindow(input: {
  shiftDate: string;
  start: unknown;
  end: unknown;
  startDayOffset?: unknown;
  endDayOffset?: unknown;
  startAt?: Date | null;
  endAt?: Date | null;
}): InstantSpan | null {
  if (input.startAt && input.endAt && input.endAt.getTime() > input.startAt.getTime()) {
    return { startMs: input.startAt.getTime(), endMs: input.endAt.getTime() };
  }
  const startSeconds = clockSecondsOf(input.start);
  const endSeconds = clockSecondsOf(input.end);
  if (startSeconds === null || endSeconds === null) return null;

  const base = kuwaitDayStart(input.shiftDate).getTime();
  const startMs = base + dayOffsetOf(input.startDayOffset) * DAY_MS + startSeconds * 1000;
  let endMs = base + dayOffsetOf(input.endDayOffset) * DAY_MS + endSeconds * 1000;
  // An overnight session whose row omits the offset still ends on the next day:
  // 17:00 → 05:00 is eight hours forward, not sixteen hours back.
  if (endMs <= startMs) endMs += DAY_MS;
  if (endMs <= startMs) return null;
  return { startMs, endMs };
}

/** Shift windows per driver, keyed `driverId`, then Kuwait day. Two for a split shift. */
export type ShiftWindowsByDriver = Map<string, Map<string, InstantSpan[]>>;

export function addShiftWindow(
  into: ShiftWindowsByDriver,
  driverId: string,
  window: InstantSpan,
): void {
  // A window is stamped with the day the shift starts, but it can cross midnight,
  // so it is indexed by every day it actually touches.
  for (const piece of splitSpanByDay(window)) {
    const days = into.get(driverId) ?? new Map<string, InstantSpan[]>();
    into.set(driverId, days);
    push(days, piece.day, { startMs: piece.startMs, endMs: piece.endMs });
  }
}

/**
 * App-usage hours per `driverId|day`.
 *
 * A span piece is intersected with the windows of **its own day**, which is why
 * both are split first. A day the rota does not cover keeps its whole piece —
 * but never more than `MAX_DAY_HOURS`, because a day nothing measured is not
 * evidence of a 23-hour shift.
 */
export function appUsageHoursByDay(input: {
  spansByDriver: Map<string, InstantSpan[]>;
  windows: ShiftWindowsByDriver;
}): Map<string, number> {
  const out = new Map<string, number>();
  for (const [driverId, spans] of input.spansByDriver) {
    const windowsByDay = input.windows.get(driverId);
    const piecesByDay = new Map<string, InstantSpan[]>();
    for (const span of spans) {
      for (const piece of splitSpanByDay(span)) {
        push(piecesByDay, piece.day, { startMs: piece.startMs, endMs: piece.endMs });
      }
    }
    for (const [day, pieces] of piecesByDay) {
      const dayWindows = windowsByDay?.get(day) ?? [];
      const measured = dayWindows.length > 0 ? intersectMs(pieces, dayWindows) : pieces;
      const hours = unionMs(measured) / 3_600_000;
      out.set(`${driverId}|${day}`, Math.round(Math.min(hours, MAX_DAY_HOURS) * 100) / 100);
    }
  }
  return out;
}

/** `YYYY-MM-DD` one Kuwait day earlier — the shift rows a month boundary needs. */
export function previousKuwaitDay(day: string): string {
  return kuwaitDayString(kuwaitDayStart(day).getTime() - DAY_MS);
}
