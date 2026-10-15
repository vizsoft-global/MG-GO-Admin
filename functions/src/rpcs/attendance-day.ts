import { kuwaitDayString } from "../core/kuwait";
import type { Dict } from "./_shared";

export type AttendanceDayRow = { id: string; data: Dict };

function asDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (value && typeof value === "object" && "toDate" in value) {
    try {
      const date = (value as { toDate: () => Date }).toDate();
      return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
    } catch {
      return null;
    }
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

/** Kuwait `YYYY-MM-DD` for a stored attendance_date (string, ISO, or Timestamp). */
export function attendanceDateKey(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
    const parsed = asDate(trimmed);
    return parsed ? kuwaitDayString(parsed) : null;
  }
  const parsed = asDate(value);
  return parsed ? kuwaitDayString(parsed) : null;
}

export function pickAttendanceDayRow(
  rows: readonly AttendanceDayRow[],
  day: string,
): AttendanceDayRow | null {
  let picked: AttendanceDayRow | null = null;
  let best = -1;
  for (const row of rows) {
    if (attendanceDateKey(row.data["attendance_date"]) !== day) continue;
    const seconds = Math.max(0, Math.trunc(Number(row.data["online_seconds"]) || 0));
    if (!picked || seconds >= best) {
      picked = row;
      best = seconds;
    }
  }
  return picked;
}

export function mergeTodayOnlineSeconds(stored: number, closed: number): number {
  const left = Number.isFinite(stored) ? Math.max(0, Math.trunc(stored)) : 0;
  const right = Number.isFinite(closed) ? Math.max(0, Math.trunc(closed)) : 0;
  return Math.max(left, right);
}
