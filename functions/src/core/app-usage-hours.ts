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
 *     23 h possible. A day with **no** shift row is left uncapped on purpose:
 *     there is no rota to measure against, and inventing a ceiling would hide
 *     real hours.
 *
 * Both rules are union-based (`unionMs`), not summed, because a split shift has
 * two overlapping windows and a rider cannot work the same minute twice.
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
 * both are split first. A day the rota does not cover (no window at all, or an
 * OFF row the caller skipped) keeps its whole piece — capped only by midnight.
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
      out.set(`${driverId}|${day}`, Math.round(hours * 100) / 100);
    }
  }
  return out;
}

/** `YYYY-MM-DD` one Kuwait day earlier — the shift rows a month boundary needs. */
export function previousKuwaitDay(day: string): string {
  return kuwaitDayString(kuwaitDayStart(day).getTime() - DAY_MS);
}
