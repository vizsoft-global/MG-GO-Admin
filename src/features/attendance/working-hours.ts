/** Wall-clock working seconds from check-in → check-out (midnight-safe). */
export function workingSeconds(
  checkInAt: string | null | undefined,
  checkOutAt: string | null | undefined,
): number | null {
  if (!checkInAt || !checkOutAt) return null;
  const inMs = Date.parse(checkInAt);
  const outMs = Date.parse(checkOutAt);
  if (!Number.isFinite(inMs) || !Number.isFinite(outMs)) return null;
  if (outMs < inMs) return null;
  return Math.floor((outMs - inMs) / 1000);
}

/** Prefer reporting duty_seconds; fall back to check-in/out diff for closed logs. */
export function resolveWorkingSeconds(input: {
  dutySeconds?: number | null;
  checkInAt: string | null | undefined;
  checkOutAt: string | null | undefined;
}): number | null {
  if (input.checkOutAt == null) return null;
  if (
    typeof input.dutySeconds === "number" &&
    Number.isFinite(input.dutySeconds) &&
    input.dutySeconds >= 0
  ) {
    return Math.floor(input.dutySeconds);
  }
  return workingSeconds(input.checkInAt, input.checkOutAt);
}

export function formatWorkingHoursList(
  seconds: number | null,
  formatDuration: (s: number) => string,
): string {
  if (seconds == null) return "—";
  return formatDuration(seconds);
}

/** One app session: the duty span the rider controls by clocking in and out. */
export type SessionInterval = { start: string; end?: string | null };

/**
 * App-open hours for one Kuwait day, as the **union** of the day's sessions.
 *
 * Two sessions (09:00–13:00 and 14:00–18:00) are 8.0 hours, not 16, and an open
 * session counts up to `now` rather than to midnight. The interval is clipped to
 * the day at both ends, so an overnight shift contributes only the part that falls
 * inside the day it is being reported for.
 */
export function sessionDaySummary(
  intervals: readonly SessionInterval[],
  dayStartMs: number,
  dayEndMs: number,
  nowMs: number,
): { shiftInAt: string | null; shiftOutAt: string | null; workedSeconds: number } {
  const spans: { start: number; end: number; open: boolean }[] = [];
  for (const interval of intervals) {
    const startMs = Date.parse(interval.start);
    if (!Number.isFinite(startMs)) continue;
    const open = !interval.end;
    const endMs = interval.end ? Date.parse(interval.end) : nowMs;
    if (!Number.isFinite(endMs) || endMs < startMs) continue;
    const from = Math.max(startMs, dayStartMs);
    const to = Math.min(endMs, dayEndMs);
    if (to > from) spans.push({ start: from, end: to, open });
  }
  if (spans.length === 0) return { shiftInAt: null, shiftOutAt: null, workedSeconds: 0 };
  spans.sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number; open: boolean }[] = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end) {
      last.end = Math.max(last.end, span.end);
      // The later session decides whether the day is still open.
      last.open = span.start >= last.start ? span.open : last.open;
    } else merged.push({ ...span });
  }
  const workedSeconds = Math.floor(
    merged.reduce((sum, span) => sum + (span.end - span.start), 0) / 1000,
  );
  const last = merged[merged.length - 1];
  return {
    shiftInAt: new Date(merged[0].start).toISOString(),
    // A session that has not been clocked out has no shift-out to print.
    shiftOutAt: last.open || last.end >= dayEndMs ? null : new Date(last.end).toISOString(),
    workedSeconds,
  };
}
