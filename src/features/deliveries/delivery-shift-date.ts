/**
 * Mirrors `public.delivery_shift_date` and the Orders Report shift attribution
 * rule. Kuwait is UTC+3 year-round (no DST).
 *
 * Rule order: in-window [start, end) → previous start ≤ at → nearest start
 * → Kuwait calendar date. Ties: earliest window_start, then shift_date,
 * then session_no. Only windows whose shift_date is in [kd-1, kd] are
 * considered.
 */

export type ShiftWindow = {
  shiftDate: string;
  startMs: number;
  endMs: number;
  sessionNo: number;
};

const KUWAIT_OFFSET_MS = 3 * 60 * 60 * 1000;

export function kuwaitDateKey(atMs: number): string {
  const wall = new Date(atMs + KUWAIT_OFFSET_MS);
  return ymd(wall.getUTCFullYear(), wall.getUTCMonth() + 1, wall.getUTCDate());
}

export function kuwaitInstant(date: string, time: string, dayOffset = 0): number {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute, second] = time.split(":").map(Number);
  const utcDay = Date.UTC(year, month - 1, day + dayOffset);
  return utcDay + ((hour ?? 0) - 3) * 3_600_000 + (minute ?? 0) * 60_000 + (second ?? 0) * 1000;
}

export function candidateShiftDates(kuwaitDate: string): [string, string] {
  return [addDays(kuwaitDate, -1), kuwaitDate];
}

export function attributeShiftDate(
  atMs: number,
  kuwaitDate: string,
  windows: readonly ShiftWindow[],
): string {
  const [from, to] = candidateShiftDates(kuwaitDate);
  const scoped = windows.filter((w) => w.shiftDate >= from && w.shiftDate <= to);
  if (atMs == null || Number.isNaN(atMs)) return kuwaitDate;

  const inWindow = scoped
    .filter((w) => atMs >= w.startMs && atMs < w.endMs)
    .sort(compareWindowAsc);
  if (inWindow[0]) return inWindow[0].shiftDate;

  const previous = scoped.filter((w) => w.startMs <= atMs).sort(compareWindowDesc);
  if (previous[0]) return previous[0].shiftDate;

  if (scoped.length === 0) return kuwaitDate;

  const nearest = [...scoped].sort((a, b) => {
    const da = Math.abs(atMs - a.startMs);
    const db = Math.abs(atMs - b.startMs);
    return da - db || compareWindowAsc(a, b);
  });
  return nearest[0]?.shiftDate ?? kuwaitDate;
}

function compareWindowAsc(a: ShiftWindow, b: ShiftWindow): number {
  return a.startMs - b.startMs || a.shiftDate.localeCompare(b.shiftDate) || a.sessionNo - b.sessionNo;
}

function compareWindowDesc(a: ShiftWindow, b: ShiftWindow): number {
  return b.startMs - a.startMs || b.shiftDate.localeCompare(a.shiftDate) || b.sessionNo - a.sessionNo;
}

function ymd(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return ymd(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
}
