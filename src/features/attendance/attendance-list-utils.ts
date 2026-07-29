import { addDays, formatDurationSeconds, kuwaitToday } from "@/features/driver-tracking/kuwait-time";
import type { AttendanceDailyRow, AttendanceSortKey } from "./attendance-reporting-types";
import type { AttendanceListRow, AttendanceStatus } from "./types";

export { addDays, kuwaitToday, formatDurationSeconds };

export const ATTENDANCE_SORT_OPTIONS: { value: AttendanceSortKey; labelKey: string }[] = [
  { value: "problems_first", labelKey: "sortProblemsFirst" },
  { value: "name_asc", labelKey: "sortNameAsc" },
  { value: "name_desc", labelKey: "sortNameDesc" },
  { value: "status_asc", labelKey: "sortStatusAsc" },
  { value: "status_desc", labelKey: "sortStatusDesc" },
  { value: "check_in_asc", labelKey: "sortCheckInAsc" },
  { value: "check_in_desc", labelKey: "sortCheckInDesc" },
  { value: "check_out_asc", labelKey: "sortCheckOutAsc" },
  { value: "check_out_desc", labelKey: "sortCheckOutDesc" },
  { value: "duty_seconds_asc", labelKey: "sortWorkingHoursAsc" },
  { value: "duty_seconds_desc", labelKey: "sortWorkingHoursDesc" },
  { value: "on_duty_asc", labelKey: "sortOnDutyAsc" },
  { value: "on_duty_desc", labelKey: "sortOnDutyDesc" },
  { value: "last_seen_desc", labelKey: "sortLastSeenDesc" },
  { value: "last_seen_asc", labelKey: "sortLastSeenAsc" },
];

export type AttendanceSortColumn =
  | "driver"
  | "date"
  | "status"
  | "check_in"
  | "check_out"
  | "duty_seconds"
  | "on_duty"
  | "last_seen";

const SORT_COLUMN_PAIR: Record<
  AttendanceSortColumn,
  { asc: AttendanceSortKey; desc: AttendanceSortKey }
> = {
  driver: { asc: "name_asc", desc: "name_desc" },
  date: { asc: "date_asc", desc: "date_desc" },
  status: { asc: "status_asc", desc: "status_desc" },
  check_in: { asc: "check_in_asc", desc: "check_in_desc" },
  check_out: { asc: "check_out_asc", desc: "check_out_desc" },
  duty_seconds: { asc: "duty_seconds_asc", desc: "duty_seconds_desc" },
  on_duty: { asc: "on_duty_asc", desc: "on_duty_desc" },
  last_seen: { asc: "last_seen_asc", desc: "last_seen_desc" },
};

/** Normalize legacy `last_seen` to desc for UI comparisons. */
export function normalizeAttendanceSortKey(key: AttendanceSortKey): AttendanceSortKey {
  return key === "last_seen" ? "last_seen_desc" : key;
}

export function attendanceSortDirection(
  sortKey: AttendanceSortKey,
  column: AttendanceSortColumn,
): "asc" | "desc" | false {
  const key = normalizeAttendanceSortKey(sortKey);
  const pair = SORT_COLUMN_PAIR[column];
  if (key === pair.asc) return "asc";
  if (key === pair.desc) return "desc";
  return false;
}

/** inactive → asc → desc → asc */
export function nextAttendanceSortKey(
  current: AttendanceSortKey,
  column: AttendanceSortColumn,
): AttendanceSortKey {
  const key = normalizeAttendanceSortKey(current);
  const pair = SORT_COLUMN_PAIR[column];
  if (key === pair.asc) return pair.desc;
  if (key === pair.desc) return pair.asc;
  return pair.asc;
}

const STATUS_RANK: Record<string, number> = {
  late: 1,
  offline_during_shift: 2,
  gps_stale: 3,
  outside_zone: 4,
  absent: 5,
  on_duty: 6,
  present: 7,
  completed: 8,
  scheduled: 9,
  no_shift: 10,
};

function ts(value: string | null | undefined): number {
  if (!value) return Number.NaN;
  const n = Date.parse(value);
  return Number.isFinite(n) ? n : Number.NaN;
}

function cmpNullableNumber(a: number, b: number, dir: "asc" | "desc"): number {
  const aOk = Number.isFinite(a);
  const bOk = Number.isFinite(b);
  if (!aOk && !bOk) return 0;
  if (!aOk) return 1;
  if (!bOk) return -1;
  return dir === "asc" ? a - b : b - a;
}

function cmpNullableString(a: string | null | undefined, b: string | null | undefined, dir: "asc" | "desc"): number {
  const aOk = Boolean(a);
  const bOk = Boolean(b);
  if (!aOk && !bOk) return 0;
  if (!aOk) return 1;
  if (!bOk) return -1;
  const c = String(a).localeCompare(String(b));
  return dir === "asc" ? c : -c;
}

function workingSecondsForSort(row: AttendanceDailyRow): number {
  if (row.check_out_at == null) return Number.NaN;
  if (typeof row.duty_seconds === "number" && row.duty_seconds > 0) {
    return row.duty_seconds;
  }
  const inMs = ts(row.check_in_at);
  const outMs = ts(row.check_out_at);
  if (!Number.isFinite(inMs) || !Number.isFinite(outMs) || outMs < inMs) {
    return Number.NaN;
  }
  return Math.floor((outMs - inMs) / 1000);
}

/** Client-side sort so header clicks always reorder the visible page. */
export function sortAttendanceDailyRows(
  rows: AttendanceDailyRow[],
  sortKey: AttendanceSortKey,
): AttendanceDailyRow[] {
  const key = normalizeAttendanceSortKey(sortKey);
  const copy = [...rows];

  copy.sort((a, b) => {
    let primary = 0;

    switch (key) {
      case "problems_first": {
        const ra = STATUS_RANK[a.live_status] ?? 10;
        const rb = STATUS_RANK[b.live_status] ?? 10;
        const problemA = ra <= 5 ? ra : 10;
        const problemB = rb <= 5 ? rb : 10;
        primary = problemA - problemB;
        if (primary === 0) {
          primary = cmpNullableNumber(ts(a.log_date), ts(b.log_date), "desc");
        }
        break;
      }
      case "name_asc":
        primary = cmpNullableString(a.driver_name, b.driver_name, "asc");
        break;
      case "name_desc":
        primary = cmpNullableString(a.driver_name, b.driver_name, "desc");
        break;
      case "date_asc":
        primary = cmpNullableString(a.log_date, b.log_date, "asc");
        break;
      case "date_desc":
        primary = cmpNullableString(a.log_date, b.log_date, "desc");
        break;
      case "status_asc":
        primary =
          (STATUS_RANK[a.live_status] ?? 11) - (STATUS_RANK[b.live_status] ?? 11);
        break;
      case "status_desc":
        primary =
          (STATUS_RANK[b.live_status] ?? 11) - (STATUS_RANK[a.live_status] ?? 11);
        break;
      case "check_in_asc":
        primary = cmpNullableNumber(ts(a.check_in_at), ts(b.check_in_at), "asc");
        break;
      case "check_in_desc":
        primary = cmpNullableNumber(ts(a.check_in_at), ts(b.check_in_at), "desc");
        break;
      case "check_out_asc":
        primary = cmpNullableNumber(ts(a.check_out_at), ts(b.check_out_at), "asc");
        break;
      case "check_out_desc":
        primary = cmpNullableNumber(ts(a.check_out_at), ts(b.check_out_at), "desc");
        break;
      case "duty_seconds_asc":
        primary = cmpNullableNumber(
          workingSecondsForSort(a),
          workingSecondsForSort(b),
          "asc",
        );
        break;
      case "duty_seconds_desc":
        primary = cmpNullableNumber(
          workingSecondsForSort(a),
          workingSecondsForSort(b),
          "desc",
        );
        break;
      case "on_duty_asc":
        primary = Number(a.is_on_duty) - Number(b.is_on_duty);
        break;
      case "on_duty_desc":
        primary = Number(b.is_on_duty) - Number(a.is_on_duty);
        break;
      case "last_seen_asc":
        primary = cmpNullableNumber(ts(a.last_seen_at), ts(b.last_seen_at), "asc");
        break;
      case "last_seen_desc":
        primary = cmpNullableNumber(ts(a.last_seen_at), ts(b.last_seen_at), "desc");
        break;
      default:
        primary = 0;
    }

    if (primary !== 0) return primary;

    // Tie-breakers: check-in (newest), then name — so same STATUS still reorders.
    const byCheckIn = cmpNullableNumber(ts(a.check_in_at), ts(b.check_in_at), "desc");
    if (byCheckIn !== 0) return byCheckIn;
    return cmpNullableString(a.driver_name, b.driver_name, "asc");
  });

  return copy;
}

export const LIVE_STATUS_LABEL_KEYS: Record<string, string> = {
  on_duty: "liveOnDuty",
  present: "livePresent",
  late: "liveLate",
  absent: "liveAbsent",
  offline_during_shift: "liveOffline",
  gps_stale: "liveGpsStale",
  outside_zone: "liveOutsideZone",
  completed: "liveCompleted",
  scheduled: "liveScheduled",
  no_shift: "liveNoShift",
};

export const EXCEPTION_TYPE_LABEL_KEYS: Record<string, string> = {
  LateCheckIn: "exceptionLateCheckIn",
  NoCheckIn: "exceptionNoCheckIn",
  EarlyLogout: "exceptionEarlyLogout",
  OfflineDuringShift: "exceptionOfflineDuringShift",
  GpsDisabled: "exceptionGpsDisabled",
  OutsideZone: "exceptionOutsideZone",
  NoAssignedShift: "exceptionNoAssignedShift",
  IncompleteShift: "exceptionIncompleteShift",
  MissingLocationUpdates: "exceptionMissingLocationUpdates",
};

export function formatDateTimeKuwait(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("en", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Kuwait",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function formatTimeKuwait(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("en", {
      timeStyle: "short",
      timeZone: "Asia/Kuwait",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function mapLiveStatusToAttendanceStatus(row: AttendanceDailyRow): AttendanceStatus {
  if (row.live_status === "late") return "late";
  if (row.live_status === "absent" || row.live_status === "no_shift") return "absent";
  if (row.check_in_at) return "present";
  return "absent";
}

export function dailyRowToListRow(row: AttendanceDailyRow): AttendanceListRow {
  return {
    id: row.attendance_log_id,
    driver_id: row.driver_id,
    driver_name: row.driver_name,
    driver_code: row.driver_code,
    driver_phone: row.driver_phone,
    log_date: row.log_date,
    check_in_at: row.check_in_at,
    check_out_at: row.check_out_at,
    distance_meters: null,
    status: mapLiveStatusToAttendanceStatus(row),
    zone_compliance:
      row.gps_zone_status === "out_of_zone"
        ? "outside"
        : row.gps_zone_status === "in_zone"
          ? "inside"
          : null,
    admin_note: null,
    is_on_duty: row.is_on_duty,
    is_active_now: row.is_on_duty && row.live_status !== "offline_during_shift",
    is_exception: ["late", "absent", "offline_during_shift", "gps_stale", "outside_zone"].includes(
      row.live_status,
    ),
    app_attendance_status: row.attendance_status,
    online_seconds_today: row.online_seconds,
    shift_adherence: null,
    scheduled_shift_label: row.scheduled_start_at
      ? `${formatTimeKuwait(row.scheduled_start_at)} – ${formatTimeKuwait(row.scheduled_end_at)}`
      : null,
  };
}

export function kpiStatusFilter(status: string): string {
  switch (status) {
    case "checked_in":
      return "checked_in";
    case "late":
      return "late";
    case "absent":
      return "absent";
    case "online":
      return "online";
    case "problems":
      return "problems";
    case "scheduled":
      return "scheduled";
    default:
      return "all";
  }
}

export type HistoryGroupKey = "none" | "partner" | "date";

export function groupDailyRows(
  rows: AttendanceDailyRow[],
  groupBy: HistoryGroupKey,
): { key: string; label: string; rows: AttendanceDailyRow[] }[] {
  if (groupBy === "none") {
    return [{ key: "all", label: "", rows }];
  }
  const map = new Map<string, AttendanceDailyRow[]>();
  for (const row of rows) {
    const key =
      groupBy === "partner"
        ? row.partner_name ?? "—"
        : row.log_date;
    const list = map.get(key) ?? [];
    list.push(row);
    map.set(key, list);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, groupedRows]) => ({ key, label: key, rows: groupedRows }));
}
