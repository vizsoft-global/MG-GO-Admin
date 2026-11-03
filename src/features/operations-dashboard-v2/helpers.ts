import type { LeaveMonthBar, PlainRow } from "@/features/operations-dashboard/shape";

export type LeaveMonthStatus = "taken" | "current" | "upcoming";

export type LeaveYearMonth = {
  key: string;
  label: string;
  value: number;
  status: LeaveMonthStatus;
};

export type LeaveYearSeries = {
  months: LeaveYearMonth[];
  total: number;
  busiest: { label: string; count: number };
  average: number;
  approvedNovDec: number;
};

export type UpcomingLeaveRow = {
  id: string;
  employeeId: string;
  name: string;
  project: string;
  leaveType: string;
  start: string;
  end: string;
  days: number;
  status: string;
  yearMonth: string;
};

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export const PROJECT_KEYS = ["keeta", "americana", "unassigned"] as const;
export type ProjectKey = (typeof PROJECT_KEYS)[number];

export function projectKeyOf(value: unknown): string {
  const key = typeof value === "string" ? value.trim().toLowerCase() : "";
  return key || "unassigned";
}

export function monthLabel(key: string): string {
  const month = Number(key.slice(5, 7));
  return MONTH_LABELS[month - 1] ?? key;
}

export function monthLongLabel(key: string): string {
  const [year, month] = key.split("-").map(Number);
  if (!year || !month) return key;
  return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(
    new Date(Date.UTC(year, month - 1, 1)),
  );
}

function cell(row: PlainRow, keys: readonly string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function toNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dayDiff(start: string, end: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return 0;
  const startTime = Date.UTC(Number(start.slice(0, 4)), Number(start.slice(5, 7)) - 1, Number(start.slice(8, 10)));
  const endTime = Date.UTC(Number(end.slice(0, 4)), Number(end.slice(5, 7)) - 1, Number(end.slice(8, 10)));
  return Math.max(1, Math.round((endTime - startTime) / 86_400_000) + 1);
}

export function readUpcomingLeave(row: PlainRow): UpcomingLeaveRow | null {
  const start = cell(row, ["Start", "start", "start_date", "startDate"]);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return null;
  const end = cell(row, ["End", "end", "end_date", "endDate"]);
  const days = toNumber(cell(row, ["Days", "days", "days_count"])) || (end ? dayDiff(start, end) : 0);
  return {
    id: `${cell(row, ["Employee ID", "employee_id", "employeeId"])}-${start}`,
    employeeId: cell(row, ["Employee ID", "employee_id", "employeeId"]),
    name: cell(row, ["Name", "name", "driver_name", "full_name"]),
    project: projectKeyOf(cell(row, ["Project", "project", "project_key"])),
    leaveType: cell(row, ["Leave Type", "leaveType", "leave_type"]).toLowerCase() || "annual",
    start,
    end,
    days,
    status: cell(row, ["Status", "status"]).toLowerCase(),
    yearMonth: start.slice(0, 7),
  };
}

/** Jan–Dec counts for one calendar year, from the year export the dashboard already returns. */
export function leaveYearSeries(rows: readonly PlainRow[], year: string): LeaveYearSeries {
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth() + 1;
  const counts = Array.from({ length: 12 }, () => 0);
  let approvedNovDec = 0;
  let total = 0;
  for (const row of rows) {
    const leave = readUpcomingLeave(row);
    if (!leave || leave.yearMonth.slice(0, 4) !== year) continue;
    const month = Number(leave.yearMonth.slice(5, 7));
    if (month < 1 || month > 12) continue;
    if (leave.status === "rejected" || leave.status === "cancelled") continue;
    counts[month - 1] += 1;
    total += 1;
    if (month >= 11 && leave.status === "approved") approvedNovDec += 1;
  }
  const monthsElapsed = Number(year) === currentYear ? Math.max(1, currentMonth) : 12;
  let busiestIndex = 0;
  counts.forEach((count, index) => {
    if (count > counts[busiestIndex]) busiestIndex = index;
  });
  return {
    months: counts.map((value, index) => {
      const month = index + 1;
      const status: LeaveMonthStatus =
        Number(year) < currentYear || (Number(year) === currentYear && month < currentMonth)
          ? "taken"
          : Number(year) === currentYear && month === currentMonth
            ? "current"
            : "upcoming";
      return { key: `${year}-${String(month).padStart(2, "0")}`, label: MONTH_LABELS[index] ?? "", value, status };
    }),
    total,
    busiest: { label: MONTH_LABELS[busiestIndex] ?? "", count: counts[busiestIndex] ?? 0 },
    average: Math.round(total / monthsElapsed),
    approvedNovDec,
  };
}

export function upcomingLeaveRows(rows: readonly PlainRow[], today: string, days = 60): UpcomingLeaveRow[] {
  const start = today;
  const endDate = new Date(`${today}T00:00:00Z`);
  endDate.setUTCDate(endDate.getUTCDate() + days);
  const end = endDate.toISOString().slice(0, 10);
  return rows
    .map(readUpcomingLeave)
    .filter((row): row is UpcomingLeaveRow => row != null)
    .filter((row) => row.start >= start && row.start <= end)
    .filter((row) => row.status !== "rejected" && row.status !== "cancelled")
    .sort((left, right) => left.start.localeCompare(right.start) || left.name.localeCompare(right.name));
}

export function nextMonthKeys(today: string, count: number): string[] {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7)) - 1;
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(year, month + index, 1));
    return date.toISOString().slice(0, 7);
  });
}

export function jobEndMonthRows(months: readonly LeaveMonthBar[]): LeaveMonthBar[] {
  return months.slice(0, 6);
}

export type JobEndMatrixRow = {
  project: string;
  counts: Record<string, number>;
  total: number;
};

export function jobEndMatrix(rows: readonly PlainRow[], months: readonly string[]): JobEndMatrixRow[] {
  const byProject = new Map<string, Record<string, number>>();
  for (const row of rows) {
    const project = projectKeyOf(cell(row, ["Project", "project", "project_key"]));
    const end = cell(row, ["Job End Date", "job_end_date", "jobEndDate"]).slice(0, 10);
    const month = end.slice(0, 7);
    if (!months.includes(month)) continue;
    const counts = byProject.get(project) ?? {};
    counts[month] = (counts[month] ?? 0) + 1;
    byProject.set(project, counts);
  }
  return [...byProject.entries()]
    .map(([project, counts]) => ({
      project,
      counts,
      total: Object.values(counts).reduce((sum, value) => sum + value, 0),
    }))
    .sort((left, right) => projectOrder(left.project) - projectOrder(right.project));
}

export function projectOrder(key: string): number {
  switch (key) {
    case "keeta":
      return 0;
    case "americana":
      return 1;
    case "unassigned":
      return 3;
    default:
      return 2;
  }
}

export function statusTone(status: string): "green" | "ochre" | "grey" | "red" | "blue" {
  switch (status) {
    case "approved":
      return "green";
    case "pending":
      return "ochre";
    case "taken":
      return "blue";
    case "rejected":
      return "red";
    default:
      return "grey";
  }
}

export function leaveTypeLabelKey(type: string): string {
  switch (type) {
    case "sick":
      return "typeSick";
    case "emergency":
      return "typeEmergency";
    case "unpaid":
      return "typeUnpaid";
    default:
      return "typeAnnual";
  }
}

