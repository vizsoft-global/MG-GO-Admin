import { addDays, formatDurationSeconds, kuwaitToday } from "@/features/driver-tracking/kuwait-time";
import type { AttendanceDailyRow, AttendanceSortKey } from "./attendance-reporting-types";
import type { AttendanceListRow, AttendanceStatus } from "./types";

export { addDays, kuwaitToday, formatDurationSeconds };

export const ATTENDANCE_SORT_OPTIONS: { value: AttendanceSortKey; labelKey: string }[] = [
  { value: "problems_first", labelKey: "sortProblemsFirst" },
  { value: "name_asc", labelKey: "sortNameAsc" },
  { value: "name_desc", labelKey: "sortNameDesc" },
  { value: "last_seen", labelKey: "sortLastSeen" },
  { value: "date_desc", labelKey: "sortDateDesc" },
  { value: "date_asc", labelKey: "sortDateAsc" },
];

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
