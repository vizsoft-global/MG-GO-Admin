import { HttpsError, onCall } from "firebase-functions/v2/https";
import { kuwaitDayString } from "../core/kuwait";
import { parseId } from "../core/query";
import { loadAppSettings } from "../core/settings";
import { requireStaff } from "../core/staff";
import { loadAttendanceRows, type AttendanceRow } from "./attendance-shared";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const PROBLEM_STATUSES = new Set([
  "late",
  "absent",
  "offline_during_shift",
  "gps_stale",
  "outside_zone",
]);

/**
 * Problems rank first, then the remainder in the order the view defined.
 * `offline_during_shift` ranks directly under `late` because the SQL did — these
 * are the riders an operator opens the page to find.
 */
const STATUS_RANK: Record<string, number> = {
  late: 1,
  offline_during_shift: 2,
  gps_stale: 3,
  outside_zone: 4,
  absent: 5,
  on_leave: 6,
  on_duty: 7,
  present: 8,
  completed: 9,
  scheduled: 10,
  no_shift: 11,
};

function requireDay(value: unknown, field: string): string {
  if (typeof value === "string" && DAY_RE.test(value)) return value;
  throw new HttpsError("invalid-argument", `invalid_${field}`);
}

function readRange(data: Record<string, unknown>) {
  const from = requireDay(data.from, "from");
  const to = requireDay(data.to, "to");
  if (from > to) throw new HttpsError("invalid-argument", "invalid_range");
  return { from, to };
}

function matchesStatus(row: AttendanceRow, status: string | null): boolean {
  if (!status || status === "all") return true;
  switch (status) {
    case "scheduled":
      return row.scheduled_start_at !== null;
    case "checked_in":
      return row.check_in_at !== null || row.is_on_duty;
    case "late":
      return row.minutes_late > 0;
    case "absent":
      return row.live_status === "absent";
    case "online":
      return row.is_on_duty && row.live_status === "on_duty";
    case "problems":
      return PROBLEM_STATUSES.has(row.live_status);
    default:
      return row.live_status === status;
  }
}

function matchesSearch(row: AttendanceRow, needle: string): boolean {
  if (!needle) return true;
  const haystack = [row.driver_name, row.driver_code ?? "", row.employee_id ?? ""];
  return haystack.some((value) => value.toLowerCase().includes(needle));
}

function compareText(a: string | null, b: string | null): number {
  return (a ?? "").localeCompare(b ?? "");
}

function compareInstant(a: string | null, b: string | null, direction: 1 | -1): number {
  const left = a ? Date.parse(a) : null;
  const right = b ? Date.parse(b) : null;
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return (left - right) * direction;
}

function sortRows(rows: AttendanceRow[], sort: string): AttendanceRow[] {
  const direction: 1 | -1 = sort.endsWith("_desc") && sort !== "date_desc" ? -1 : 1;
  const out = [...rows];
  out.sort((a, b) => {
    switch (sort) {
      case "problems_first": {
        const rankA = STATUS_RANK[a.live_status] ?? 10;
        const rankB = STATUS_RANK[b.live_status] ?? 10;
        if (rankA !== rankB) return rankA - rankB;
        return compareInstant(a.log_date, b.log_date, -1) || compareText(a.driver_name, b.driver_name);
      }
      case "status_asc":
      case "status_desc": {
        const rankA = STATUS_RANK[a.live_status] ?? 12;
        const rankB = STATUS_RANK[b.live_status] ?? 12;
        const scaled = (rankA - rankB) * direction;
        if (scaled !== 0) return scaled;
        return compareInstant(a.check_in_at, b.check_in_at, -1) || compareText(a.driver_name, b.driver_name);
      }
      case "date_asc":
        return compareInstant(a.log_date, b.log_date, 1);
      case "date_desc":
        return compareInstant(a.log_date, b.log_date, -1);
      case "name_asc":
        return compareText(a.driver_name, b.driver_name);
      case "name_desc":
        return -compareText(a.driver_name, b.driver_name);
      case "last_seen":
      case "last_seen_desc":
        return compareInstant(a.last_seen_at, b.last_seen_at, -1);
      case "last_seen_asc":
        return compareInstant(a.last_seen_at, b.last_seen_at, 1);
      case "check_in_asc":
        return compareInstant(a.check_in_at, b.check_in_at, 1);
      case "check_in_desc":
        return compareInstant(a.check_in_at, b.check_in_at, -1);
      case "check_out_asc":
        return compareInstant(a.check_out_at, b.check_out_at, 1);
      case "check_out_desc":
        return compareInstant(a.check_out_at, b.check_out_at, -1);
      case "duty_seconds_asc":
        return a.duty_seconds - b.duty_seconds;
      case "duty_seconds_desc":
        return b.duty_seconds - a.duty_seconds;
      case "on_duty_asc":
        return Number(a.is_on_duty) - Number(b.is_on_duty);
      case "on_duty_desc":
        return Number(b.is_on_duty) - Number(a.is_on_duty);
      default:
        return compareText(a.driver_name, b.driver_name);
    }
  });
  return out;
}

/** `admin_list_attendance_daily` — same filters, same sort keys, same page shape. */
export const adminListAttendanceDaily = onCall(async (request) => {
  await requireStaff(request, "attendance.view");

  const data = (request.data ?? {}) as Record<string, unknown>;
  const { from, to } = readRange(data);
  const settings = await loadAppSettings();

  const rows = await loadAttendanceRows(
    {
      from,
      to,
      partnerId: parseId(data.partnerId),
      zoneId: parseId(data.zoneId),
      restaurantId: parseId(data.restaurantId),
    },
    settings,
  );

  const today = kuwaitDayString(new Date());
  const liveOnly = data.liveOnly === true;
  const status = parseId(data.status);
  const search = (parseId(data.search) ?? "").toLowerCase();

  const filtered = rows.filter(
    (row) =>
      (!liveOnly || row.log_date === today) &&
      matchesStatus(row, status) &&
      matchesSearch(row, search),
  );

  const sorted = sortRows(filtered, parseId(data.sort) ?? "problems_first");

  const limit = Math.max(Number(data.limit ?? 50) || 50, 1);
  const offset = Math.max(Number(data.offset ?? 0) || 0, 0);

  return {
    totalCount: sorted.length,
    rows: sorted.slice(offset, offset + limit),
  };
});

/** `admin_attendance_kpis` — one day, seven counters, same predicates. */
export const adminAttendanceKpis = onCall(async (request) => {
  await requireStaff(request, "attendance.view");

  const data = (request.data ?? {}) as Record<string, unknown>;
  const day = requireDay(data.date, "date");
  const settings = await loadAppSettings();

  const rows = await loadAttendanceRows(
    {
      from: day,
      to: day,
      partnerId: parseId(data.partnerId),
      zoneId: parseId(data.zoneId),
      restaurantId: parseId(data.restaurantId),
    },
    settings,
  );

  const compliance = rows
    .map((row) => row.compliance_score)
    .filter((value): value is number => value !== null);

  return {
    scheduled: rows.filter((row) => row.scheduled_start_at !== null).length,
    checked_in: rows.filter((row) => row.check_in_at !== null || row.is_on_duty).length,
    late: rows.filter((row) => row.minutes_late > 0).length,
    absent: rows.filter((row) => row.live_status === "absent").length,
    // "Online" is GPS-live, not merely clocked in: the SQL narrowed this to
    // `live_status = 'on_duty'` when `offline_during_shift` became reachable, and
    // keeping the old `IN (...) ` form would count a dark phone as online.
    online: rows.filter((row) => row.is_on_duty && row.live_status === "on_duty").length,
    problems: rows.filter((row) => PROBLEM_STATUSES.has(row.live_status)).length,
    compliance_score: compliance.length
      ? Math.round(compliance.reduce((sum, value) => sum + value, 0) / compliance.length)
      : 0,
  };
});
