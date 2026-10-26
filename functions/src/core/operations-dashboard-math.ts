export type LeavePlanStatus = "pending" | "approved" | "taken" | "rejected";

export type RenewalDescription =
  | "end_of_contract"
  | "issue_maker"
  | "not_willing_to_continue"
  | "travelled_not_returned";

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export function isLeavePlanStatus(value: unknown): value is LeavePlanStatus {
  switch (value) {
    case "pending":
    case "approved":
    case "taken":
    case "rejected":
      return true;
    default:
      return false;
  }
}

export function monthCountsLeave(
  status: LeavePlanStatus,
  yearMonth: string,
  todayYm: string,
  coversToday: boolean,
): boolean {
  switch (status) {
    case "rejected":
      return false;
    case "approved":
      return true;
    case "taken":
      return yearMonth <= todayYm;
    case "pending":
      if (yearMonth > todayYm) return false;
      if (yearMonth < todayYm) return coversToday;
      return true;
    default: {
      const neverStatus: never = status;
      return neverStatus;
    }
  }
}

export function turnoverRate(departures: number, avgActive: number): number {
  if (avgActive === 0) return 0;
  return (departures / avgActive) * 100;
}

export type TurnoverMonth = {
  yearMonth: string;
  label: string;
  avgActive: number;
  departures: number;
  rate: number;
};

/** One calendar year of turnover, using the same average as the yearly headline. */
export function turnoverComparison(
  departures: ReadonlyArray<{ date: string }>,
  liveNonCancelled: number,
  todayYmd: string,
): {
  months: TurnoverMonth[];
  annualPct: number;
  monthlyAvgPct: number;
  departuresCount: number;
  peakMonth: string;
} {
  const year = todayYmd.slice(0, 4);
  const months: TurnoverMonth[] = [];
  let peakMonth = "";
  let peakCount = 0;
  for (let month = 1; month <= 12; month += 1) {
    const yearMonth = `${year}-${String(month).padStart(2, "0")}`;
    const count = departures.filter((row) => row.date.slice(0, 7) === yearMonth).length;
    const rate = turnoverRate(count, liveNonCancelled + count / 2);
    const label = MONTH_SHORT[month - 1] ?? "";
    months.push({
      yearMonth,
      label,
      avgActive: liveNonCancelled + count / 2,
      departures: count,
      rate,
    });
    if (count > peakCount) {
      peakCount = count;
      peakMonth = label;
    }
  }
  const yearCount = departures.filter((row) => row.date.slice(0, 4) === year).length;
  const annualPct = turnoverRate(yearCount, liveNonCancelled + yearCount / 2);
  const monthlyAvgPct = months.reduce((sum, row) => sum + row.rate, 0) / 12;
  return { months, annualPct, monthlyAvgPct, departuresCount: yearCount, peakMonth };
}

export function jobEndWindow(todayYmd: string): Array<{ key: string; label: string }> {
  const year = Number(todayYmd.slice(0, 4));
  const month = Number(todayYmd.slice(5, 7));
  const out: Array<{ key: string; label: string }> = [];
  for (let i = 0; i < 6; i += 1) {
    const index = year * 12 + (month - 1) + i;
    const y = Math.floor(index / 12);
    const m = (index % 12) + 1;
    const key = `${y}-${String(m).padStart(2, "0")}`;
    const short = MONTH_SHORT[m - 1] ?? "";
    const label = i === 0 ? `${short} (rest)` : y !== year ? `${short} ${y}` : short;
    out.push({ key, label });
  }
  return out;
}

export function daysLeft(todayYmd: string, jobEndYmd: string): number {
  const [ys, ms, ds] = todayYmd.split("-").map(Number);
  const [ye, me, de] = jobEndYmd.split("-").map(Number);
  return Math.round((Date.UTC(ye, me - 1, de) - Date.UTC(ys, ms - 1, ds)) / 86400000);
}

function knownRenewal(value: string): RenewalDescription | null {
  switch (value) {
    case "end_of_contract":
    case "issue_maker":
    case "not_willing_to_continue":
    case "travelled_not_returned":
      return value;
    default:
      return null;
  }
}

export function renewalDecision(
  jobEndDescription: string | null | undefined,
  jobEndDate: string | null | undefined,
): RenewalDescription | "no_renewal" | null {
  const description = (jobEndDescription ?? "").trim();
  const known = knownRenewal(description);
  if (known !== null) {
    switch (known) {
      case "end_of_contract":
      case "issue_maker":
      case "not_willing_to_continue":
      case "travelled_not_returned":
        return known;
      default: {
        const neverDescription: never = known;
        return neverDescription;
      }
    }
  }
  if ((jobEndDate ?? "").trim() !== "" && description === "") return "no_renewal";
  return null;
}

const REQUEST_LEAVE_STATUSES = [
  "submitted",
  "pending",
  "in_review",
  "needs_clarification",
  "rescheduled",
  "overdue",
  "approved",
  "rejected",
  "solved",
  "responded",
  "closed",
  "cancelled",
] as const;

type RequestLeaveStatus = (typeof REQUEST_LEAVE_STATUSES)[number];

export type RequestLeaveFields = {
  id: string;
  requestType: string;
  status: string;
  driverId: string;
  employeeId: string;
  name: string;
  project: string;
  start: string;
  end: string;
  today: string;
  leaveTypeRaw: string;
};

export type RequestLeaveRow = {
  id: string;
  driverId: string;
  employeeId: string;
  name: string;
  project: string;
  leaveType: string;
  start: string;
  end: string;
  days: number;
  status: LeavePlanStatus;
  yearMonth: string;
  source: "request";
};

function asRequestLeaveStatus(value: string): RequestLeaveStatus | null {
  const status = value.trim().toLowerCase();
  if ((REQUEST_LEAVE_STATUSES as readonly string[]).includes(status)) return status as RequestLeaveStatus;
  return null;
}

function planStatusFromRequest(status: RequestLeaveStatus, end: string, today: string): LeavePlanStatus {
  switch (status) {
    case "rejected":
    case "cancelled":
      return "rejected";
    case "approved":
    case "solved":
    case "closed":
    case "responded":
      return end < today ? "taken" : "approved";
    case "submitted":
    case "pending":
    case "in_review":
    case "needs_clarification":
    case "rescheduled":
    case "overdue":
      return "pending";
    default: {
      const neverStatus: never = status;
      return neverStatus;
    }
  }
}

function catalogLeaveType(requestType: string, raw: string): string | null {
  if (requestType === "sick_leave") return "sick";
  if (requestType !== "leave") return null;
  const key = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (key === "unpaid_leave") return "unpaid";
  if (key === "") return "leave";
  return key;
}

function isYmd(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** EmployeeDesk `leave` / `sick_leave` becomes the same row the dashboards already classify. */
export function mapRequestLeave(input: RequestLeaveFields): RequestLeaveRow | null {
  const leaveType = catalogLeaveType(input.requestType, input.leaveTypeRaw);
  const status = asRequestLeaveStatus(input.status);
  if (!leaveType || !status || !input.driverId || !input.id) return null;
  if (!isYmd(input.start) || !isYmd(input.end) || input.end < input.start) return null;
  const planStatus = planStatusFromRequest(status, input.end, input.today);
  return {
    id: `req:${input.id}`,
    driverId: input.driverId,
    employeeId: input.employeeId,
    name: input.name,
    project: input.project,
    leaveType,
    start: input.start,
    end: input.end,
    days: daysLeft(input.start, input.end) + 1,
    status: planStatus,
    yearMonth: input.start.slice(0, 7),
    source: "request",
  };
}

export type ContractEndRider = {
  archived: boolean;
  jobEnd: string | null;
  undecided: boolean;
};

export function hiringWindowEnd(today: string): string {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const end = new Date(Date.UTC(year, month - 1 + 3, 0));
  const mm = String(end.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(end.getUTCDate()).padStart(2, "0");
  return `${end.getUTCFullYear()}-${mm}-${dd}`;
}

export function leavesInHiringWindow(
  jobEnd: string | null,
  today: string,
  horizon: string,
  noRenewal: boolean,
): boolean {
  if (!noRenewal || !jobEnd || !isYmd(jobEnd)) return false;
  return jobEnd >= today && jobEnd <= horizon;
}

export function contractEndTurnover(
  riders: readonly ContractEndRider[],
  today: string,
): {
  rate: number;
  ended: number;
  assumed: number;
  total: number;
  months: { yearMonth: string; count: number; rate: number }[];
} {
  const year = today.slice(0, 4);
  let live = 0;
  let endedLive = 0;
  let endedArchived = 0;
  let assumed = 0;
  const counts = Array.from({ length: 12 }, () => 0);
  for (const rider of riders) {
    if (!rider.archived) live += 1;
    const jobEnd = rider.jobEnd && isYmd(rider.jobEnd) ? rider.jobEnd : "";
    if (!jobEnd) continue;
    if (jobEnd.slice(0, 4) === year) {
      const index = Number(jobEnd.slice(5, 7)) - 1;
      if (index >= 0 && index < 12) counts[index] = (counts[index] ?? 0) + 1;
    }
    if (jobEnd <= today) {
      if (rider.archived) endedArchived += 1;
      else endedLive += 1;
    } else if (!rider.archived && rider.undecided) {
      assumed += 1;
    }
  }
  const ended = endedLive + endedArchived;
  const total = live + endedArchived;
  return {
    rate: turnoverRate(ended + assumed, total),
    ended,
    assumed,
    total,
    months: counts.map((count, index) => ({
      yearMonth: `${year}-${String(index + 1).padStart(2, "0")}`,
      count,
      rate: turnoverRate(count, total),
    })),
  };
}

export function leaveIdentity(row: { driverId: string; start: string; end: string; leaveType: string }): string {
  return `${row.driverId}|${row.start}|${row.end}|${row.leaveType}`;
}

/** A request and a plan for the same rider, dates, and type count once. The request wins. */
export function mergeLeaveRows<T extends { driverId: string; start: string; end: string; leaveType: string }>(
  plans: readonly T[],
  requests: readonly T[],
): T[] {
  const claimed = new Set(requests.map(leaveIdentity));
  return [...requests, ...plans.filter((plan) => !claimed.has(leaveIdentity(plan)))];
}
