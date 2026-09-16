import { storesVisibleForPartners } from "@/features/performance/performance-ops-formulas";

export const MONTH_ABBR = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

export const DAY_STATUSES = [
  "work",
  "off",
  "sick",
  "accident",
  "absent",
  "blank",
] as const;

export type DayStatus = (typeof DAY_STATUSES)[number];

export const PAYROLL_TILES = [
  "leave",
  "sick",
  "accident",
  "asset",
  "fuel",
  "loan",
  "document",
  "salary_justification",
] as const;

export type PayrollTileKey = (typeof PAYROLL_TILES)[number];

export const PAYROLL_UI_STATUSES = [
  "pending",
  "under_review",
  "approved",
  "rejected",
] as const;

export type PayrollUiStatus = (typeof PAYROLL_UI_STATUSES)[number];

export const PAYROLL_EFF_BUCKETS = [
  { id: "gte100", label: "≥100%", min: 100, max: Infinity, color: "#33c777" },
  { id: "90_100", label: "90–100%", min: 90, max: 100, color: "#7fc57e" },
  { id: "80_90", label: "80–90%", min: 80, max: 90, color: "#e8d18a" },
  { id: "70_80", label: "70–80%", min: 70, max: 80, color: "#f0a83c" },
  { id: "lt70", label: "<70%", min: 0, max: 70, color: "#ef5b5b" },
] as const;

export type PayrollEffBucketId = (typeof PAYROLL_EFF_BUCKETS)[number]["id"];

export type PayrollMonthMeta = {
  key: string;
  year: number;
  month: number;
  days: number;
  label: string;
  fixedDays: number;
};

export type PayrollCoverKind = "accident" | "sick" | "off";

export type PayrollKpis = {
  riders: number;
  active: number;
  avgEfficiency: number;
  atOrAbove100: number;
  unjustifiedRiders: number;
};

export type RequestKpis = {
  total: number;
  pending: number;
  underReview: number;
  approved: number;
  rejected: number;
  approvalRate: number;
};

export function daysInCalendarMonth(year: number, month1to12: number): number {
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}

export function fixedDaysFor(monthDays: number): number {
  return monthDays - 2;
}

export function parseMonthKey(key: string): { year: number; month: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return { year, month };
}

export function monthMeta(key: string): PayrollMonthMeta | null {
  const parsed = parseMonthKey(key);
  if (!parsed) return null;
  const days = daysInCalendarMonth(parsed.year, parsed.month);
  return {
    key,
    year: parsed.year,
    month: parsed.month,
    days,
    label: `${MONTH_ABBR[parsed.month - 1]} ${parsed.year}`,
    fixedDays: fixedDaysFor(days),
  };
}

export function shiftMonthKey(key: string, delta: number): string {
  const parsed = parseMonthKey(key);
  if (!parsed) return key;
  const d = new Date(Date.UTC(parsed.year, parsed.month - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export const PAYROLL_RANGE_PRESETS = ["thisMonth", "lastMonth", "custom"] as const;
export type PayrollRangePreset = (typeof PAYROLL_RANGE_PRESETS)[number];

/** Allowed archive: Kuwait current month + previous 2. */
export function payrollMonths(todayYmd: string): PayrollMonthMeta[] {
  const currentKey = todayYmd.slice(0, 7);
  return [0, -1, -2].map((delta) => {
    const meta = monthMeta(shiftMonthKey(currentKey, delta));
    if (!meta) throw new Error("invalid_month");
    return meta;
  });
}

export function assertPayrollMonth(key: string, todayYmd: string): PayrollMonthMeta {
  const allowed = payrollMonths(todayYmd);
  const found = allowed.find((m) => m.key === key);
  if (!found) throw new Error("month_out_of_range");
  return found;
}

export function payrollMonthForPreset(
  preset: PayrollRangePreset,
  todayYmd: string,
  customKey: string | null,
): PayrollMonthMeta {
  const currentKey = todayYmd.slice(0, 7);
  switch (preset) {
    case "thisMonth": {
      const meta = monthMeta(currentKey);
      if (!meta) throw new Error("invalid_month");
      return meta;
    }
    case "lastMonth": {
      const meta = monthMeta(shiftMonthKey(currentKey, -1));
      if (!meta) throw new Error("invalid_month");
      return meta;
    }
    case "custom":
      if (!customKey) throw new Error("custom_month_required");
      return assertPayrollMonth(customKey, todayYmd);
    default: {
      const _never: never = preset;
      return _never;
    }
  }
}

export function presetForPayrollMonth(key: string, todayYmd: string): PayrollRangePreset {
  const currentKey = todayYmd.slice(0, 7);
  if (key === currentKey) return "thisMonth";
  if (key === shiftMonthKey(currentKey, -1)) return "lastMonth";
  return "custom";
}

export function dayLabel(monthKey: string, dayNum: number): string {
  const parsed = parseMonthKey(monthKey);
  if (!parsed) return String(dayNum);
  return `${dayNum}-${MONTH_ABBR[parsed.month - 1]}`;
}

export function isoDateInMonth(monthKey: string, dayNum: number): string {
  return `${monthKey}-${String(dayNum).padStart(2, "0")}`;
}

export function kuwaitMonthBounds(monthKey: string): { startIso: string; endExclusiveIso: string } {
  const parsed = parseMonthKey(monthKey);
  if (!parsed) throw new Error("invalid_month");
  const start = `${monthKey}-01`;
  const next = shiftMonthKey(monthKey, 1);
  return { startIso: start, endExclusiveIso: `${next}-01` };
}

export function efficiencyPct(workDays: number, fixedDays: number): number {
  if (!Number.isFinite(workDays) || !Number.isFinite(fixedDays) || fixedDays <= 0) return 0;
  return (workDays / fixedDays) * 100;
}

export function bucketOf(efficiency: number): PayrollEffBucketId {
  const e = Number.isFinite(efficiency) ? efficiency : 0;
  for (const b of PAYROLL_EFF_BUCKETS) {
    if (e >= b.min && e < b.max) return b.id;
  }
  return "lt70";
}

export function isJustifyingStatus(status: string): boolean {
  return status === "approved" || status === "awaiting_driver_ack";
}

export function mapLiveStatusToUi(status: string): PayrollUiStatus {
  switch (status) {
    case "submitted":
      return "pending";
    case "rejected":
      return "rejected";
    case "approved":
    case "awaiting_driver_ack":
    case "solved":
    case "responded":
    case "closed":
      return "approved";
    case "in_review":
    case "needs_clarification":
    case "rescheduled":
    case "pending":
      return "under_review";
    default:
      return "under_review";
  }
}

export function isAwaitingUiStatus(status: PayrollUiStatus): boolean {
  return status === "pending" || status === "under_review";
}

function norm(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}

export function isAccidentRequest(input: {
  requestType: string;
  leaveType?: string | null;
  leaveSubtype?: string | null;
}): boolean {
  if (input.requestType === "leave" && norm(input.leaveType) === "accident") return true;
  if (input.requestType === "sick_leave" && norm(input.leaveSubtype) === "accident") {
    return true;
  }
  return false;
}

export function payrollTileFor(input: {
  requestType: string;
  leaveType?: string | null;
  leaveSubtype?: string | null;
}): PayrollTileKey | null {
  if (isAccidentRequest(input)) return "accident";
  switch (input.requestType) {
    case "leave":
      return "leave";
    case "sick_leave":
      return "sick";
    case "asset":
      return "asset";
    case "fuel":
    case "fuel_refund":
      return "fuel";
    case "loan":
      return "loan";
    case "document":
      return "document";
    case "salary_justification":
      return "salary_justification";
    default:
      return null;
  }
}

export function coverKindFor(input: {
  requestType: string;
  leaveType?: string | null;
  leaveSubtype?: string | null;
}): PayrollCoverKind | null {
  const tile = payrollTileFor(input);
  if (tile === "accident") return "accident";
  if (tile === "sick") return "sick";
  if (tile === "leave") return "off";
  return null;
}

export function requestCoversDate(input: {
  startDate: string | null;
  endDate: string | null;
  createdDate: string | null;
  date: string;
}): boolean {
  const start = input.startDate || input.endDate || input.createdDate;
  const end = input.endDate || input.startDate || input.createdDate;
  if (!start || !end) return false;
  return input.date >= start && input.date <= end;
}

/** Matches admin_payroll_month_snapshot: COALESCE(start, created) / COALESCE(end, start, created). */
export function requestOverlapsMonth(
  input: {
    startDate: string | null;
    endDate: string | null;
    createdDate: string | null;
  },
  monthKey: string,
): boolean {
  const { startIso, endExclusiveIso } = kuwaitMonthBounds(monthKey);
  const start = input.startDate || input.createdDate;
  const end = input.endDate || input.startDate || input.createdDate;
  if (!start || !end) return false;
  return start < endExclusiveIso && end >= startIso;
}

export function classifyDay(input: {
  date: string;
  today: string;
  hasCheckIn: boolean;
  accident: boolean;
  sick: boolean;
  off: boolean;
}): DayStatus {
  if (input.date > input.today) return "blank";
  if (input.hasCheckIn) return "work";
  if (input.accident) return "accident";
  if (input.sick) return "sick";
  if (input.off) return "off";
  if (input.date <= input.today) return "absent";
  return "blank";
}

export function isUnjustifiedDay(
  status: DayStatus,
  approved: { accident: boolean; sick: boolean; off: boolean },
): boolean {
  switch (status) {
    case "work":
    case "absent":
    case "blank":
      return false;
    case "off":
      return !approved.off;
    case "sick":
      return !approved.sick;
    case "accident":
      return !approved.accident;
    default: {
      const _never: never = status;
      return _never;
    }
  }
}

export function restaurantLabel(input: {
  projectKey: string | null;
  storeName: string | null;
}): string {
  if (input.projectKey === "keeta") return "(Pool)";
  const name = input.storeName?.trim();
  return name || "(Pool)";
}

export function riderMatchesSlicers(
  rider: {
    zoneId: string | null;
    projectKey: string | null;
    vehicleKey: string | null;
    nationality: string | null;
    sourceType: string | null;
    sourceCompany: string | null;
    restaurantId: string | null;
  },
  slicers: {
    zoneIds: string[];
    projectKeys: string[];
    vehicleKeys: string[];
    nationalities: string[];
    sourceTypes: string[];
    sourceCompanies: string[];
    restaurantIds: string[];
  },
): boolean {
  if (slicers.zoneIds.length && (!rider.zoneId || !slicers.zoneIds.includes(rider.zoneId))) {
    return false;
  }
  if (
    slicers.projectKeys.length &&
    (!rider.projectKey || !slicers.projectKeys.includes(rider.projectKey))
  ) {
    return false;
  }
  if (
    slicers.vehicleKeys.length &&
    (!rider.vehicleKey || !slicers.vehicleKeys.includes(rider.vehicleKey))
  ) {
    return false;
  }
  if (
    slicers.nationalities.length &&
    (!rider.nationality || !slicers.nationalities.includes(rider.nationality))
  ) {
    return false;
  }
  if (
    slicers.sourceTypes.length &&
    (!rider.sourceType || !slicers.sourceTypes.includes(rider.sourceType))
  ) {
    return false;
  }
  if (
    slicers.sourceCompanies.length &&
    (!rider.sourceCompany || !slicers.sourceCompanies.includes(rider.sourceCompany))
  ) {
    return false;
  }
  if (slicers.restaurantIds.length) {
    if (!storesVisibleForPartners(slicers.projectKeys)) return false;
    if (!rider.restaurantId || !slicers.restaurantIds.includes(rider.restaurantId)) {
      return false;
    }
  }
  return true;
}

export type DayCoverFlags = {
  accident: boolean;
  sick: boolean;
  off: boolean;
  approvedAccident: boolean;
  approvedSick: boolean;
  approvedOff: boolean;
};

export function emptyCover(): DayCoverFlags {
  return {
    accident: false,
    sick: false,
    off: false,
    approvedAccident: false,
    approvedSick: false,
    approvedOff: false,
  };
}

export function applyCover(flags: DayCoverFlags, kind: PayrollCoverKind, approved: boolean) {
  if (kind === "accident") {
    flags.accident = true;
    if (approved) flags.approvedAccident = true;
    return;
  }
  if (kind === "sick") {
    flags.sick = true;
    if (approved) flags.approvedSick = true;
    return;
  }
  flags.off = true;
  if (approved) flags.approvedOff = true;
}

export function classifyRiderMonth(input: {
  month: PayrollMonthMeta;
  today: string;
  checkInDates: ReadonlySet<string>;
  coversByDate: ReadonlyMap<string, DayCoverFlags>;
}): {
  days: DayStatus[];
  workDays: number;
  offDays: number;
  sickDays: number;
  accidentDays: number;
  absentDays: number;
  unjustified: number;
  totalHours: number;
  fixedDays: number;
  efficiency: number;
} {
  const days: DayStatus[] = [];
  let workDays = 0;
  let offDays = 0;
  let sickDays = 0;
  let accidentDays = 0;
  let absentDays = 0;
  let unjustified = 0;

  for (let d = 1; d <= input.month.days; d += 1) {
    const date = isoDateInMonth(input.month.key, d);
    const cover = input.coversByDate.get(date) ?? emptyCover();
    const status = classifyDay({
      date,
      today: input.today,
      hasCheckIn: input.checkInDates.has(date),
      accident: cover.accident,
      sick: cover.sick,
      off: cover.off,
    });
    days.push(status);
    if (isUnjustifiedDay(status, {
      accident: cover.approvedAccident,
      sick: cover.approvedSick,
      off: cover.approvedOff,
    })) {
      unjustified += 1;
    }
    switch (status) {
      case "work":
        workDays += 1;
        break;
      case "off":
        offDays += 1;
        break;
      case "sick":
        sickDays += 1;
        break;
      case "accident":
        accidentDays += 1;
        break;
      case "absent":
        absentDays += 1;
        break;
      case "blank":
        break;
      default: {
        const _never: never = status;
        void _never;
      }
    }
  }

  return {
    days,
    workDays,
    offDays,
    sickDays,
    accidentDays,
    absentDays,
    unjustified,
    totalHours: workDays * 12,
    fixedDays: input.month.fixedDays,
    efficiency: efficiencyPct(workDays, input.month.fixedDays),
  };
}

export function computePayrollKpis(
  rows: ReadonlyArray<{ status: "Active" | "Inactive"; efficiency: number; unjustified: number }>,
): PayrollKpis {
  const riders = rows.length;
  const active = rows.filter((r) => r.status === "Active").length;
  const avgEfficiency =
    riders === 0 ? 0 : rows.reduce((sum, r) => sum + r.efficiency, 0) / riders;
  const atOrAbove100 = rows.filter((r) => r.efficiency >= 100).length;
  const unjustifiedRiders = rows.filter((r) => r.unjustified > 0).length;
  return { riders, active, avgEfficiency, atOrAbove100, unjustifiedRiders };
}

export function computeRequestKpis(
  rows: ReadonlyArray<{ uiStatus: PayrollUiStatus }>,
): RequestKpis {
  const total = rows.length;
  const pending = rows.filter((r) => r.uiStatus === "pending").length;
  const underReview = rows.filter((r) => r.uiStatus === "under_review").length;
  const approved = rows.filter((r) => r.uiStatus === "approved").length;
  const rejected = rows.filter((r) => r.uiStatus === "rejected").length;
  return {
    total,
    pending,
    underReview,
    approved,
    rejected,
    approvalRate: total === 0 ? 0 : (approved / total) * 100,
  };
}

export function workflowStats(
  requests: ReadonlyArray<{ uiStatus: PayrollUiStatus }>,
  riderCount: number,
): { awaitingAction: number; requestsPerRider: number } {
  const awaitingAction = requests.filter((r) => isAwaitingUiStatus(r.uiStatus)).length;
  const requestsPerRider = requests.length / Math.max(1, riderCount);
  return {
    awaitingAction,
    requestsPerRider: riderCount === 0 ? 0 : Number(requestsPerRider.toFixed(1)),
  };
}

export function reviewingDeptLabel(input: {
  stepName: string | null;
  roleKey: string | null;
}): string {
  const name = input.stepName?.trim();
  if (name) return name;
  switch (input.roleKey) {
    case "reporting_manager":
    case "manager":
      return "Reporting Manager";
    case "hr":
      return "HR";
    case "payroll":
      return "Payroll";
    case "fleet":
      return "Fleet";
    case "operations":
      return "Operations";
    case "finance":
      return "Finance";
    default:
      return input.roleKey?.trim() || "—";
  }
}

export function dayStatusLabel(status: DayStatus): string {
  switch (status) {
    case "work":
      return "12";
    case "off":
      return "OFF";
    case "sick":
      return "Sick";
    case "accident":
      return "Accident";
    case "absent":
      return "Absent";
    case "blank":
      return "";
    default: {
      const _never: never = status;
      return _never;
    }
  }
}

export function formatPayrollPct(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return "0.0%";
  return `${value.toFixed(digits)}%`;
}
