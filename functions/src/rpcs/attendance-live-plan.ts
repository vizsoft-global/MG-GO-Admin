export const ATTENDANCE_PROJECTION = [
  "driver_id",
  "log_date",
  "status",
  "check_in_at",
  "check_out_at",
  "check_out_reason",
  "scheduled_start_at",
  "scheduled_end_at",
  "zone_id",
  "zone_name",
  "partner_id",
  "partner_name",
  "partner_match_keys",
  "restaurant_ids",
  "driver_name",
  "driver_code",
  "driver_phone",
  "employee_id",
  "attendance_log_id",
  "shift_type",
  "online_seconds",
  "is_on_duty",
] as const;

export function minutesLateOf(
  checkIn: Date | null,
  scheduledStart: Date | null,
  graceMinutes: number,
): number {
  if (!checkIn || !scheduledStart) return 0;
  return Math.max(0, Math.floor((checkIn.getTime() - scheduledStart.getTime()) / 60_000) - graceMinutes);
}

export function dutyIsOn(
  storedOnDuty: boolean,
  checkIn: Date | null,
  checkOut: Date | null,
  logDate: string,
  today: string,
): boolean {
  return storedOnDuty && Boolean(checkIn) && !checkOut && logDate === today;
}

/**
 * Live status is fixed before GPS for leave, no shift, absent and late.
 * Every later branch can still become outside_zone, so those rows need a location.
 */
export function attendanceNeedsLocation(input: {
  storedStatus: string | null;
  hasScheduledStart: boolean;
  hasCheckIn: boolean;
  minutesLate: number;
}): boolean {
  if (input.storedStatus === "on_leave") return false;
  if (!input.hasScheduledStart) return false;
  if (!input.hasCheckIn) return false;
  if (input.minutesLate > 0) return false;
  return true;
}

export function attendanceNeedsSessions(anyOnDuty: boolean): boolean {
  return anyOnDuty;
}

/**
 * A date-ordered page is one query. problems_first, scheduled, checked_in and
 * late still read the window, in keyset pages, because those ranks are computed
 * after the row exists. The materialize cap is a month-and-year ceiling, not
 * the old 5000-row refusal.
 */
export const ATTENDANCE_MATERIALIZE_CAP = 40_000;

export const ATTENDANCE_KEYSET_PAGE = 800;

/**
 * Query paging matches the in-memory page only when nothing after the date
 * query can drop a row. problems_first and live statuses still scan the window.
 */
export function attendanceQueryCanPage(input: {
  sort: string;
  status: string | null;
  search: string;
  liveOnly: boolean;
}): boolean {
  if (input.liveOnly) return false;
  if (input.search.trim() !== "") return false;
  if (input.status && input.status !== "all") return false;
  return input.sort === "date_asc" || input.sort === "date_desc";
}
