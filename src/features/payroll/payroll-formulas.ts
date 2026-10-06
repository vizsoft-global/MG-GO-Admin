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

/**
 * MGGO Payroll SOP v4.0 day types. `work` is the full 12 h day and keeps its
 * original name so a month nobody has configured yet produces the same numbers
 * it did before the rule engine existed.
 */
export const DAY_STATUSES = [
  "work",
  "reduced3",
  "half",
  "actual",
  "off",
  "sick",
  "accident",
  "vehicle",
  "absent",
  "abs_lh",
  "abs_lo",
  "custom",
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

export type PayrollRange = { from: string; to: string };

export type PayrollPeriod = PayrollMonthMeta & PayrollRange & { dates: string[] };

export type PayrollCoverKind = "accident" | "sick" | "off";

export const PAYROLL_STATUS_FILTERS = [
  "work",
  "reduced3",
  "half",
  "actual",
  "off",
  "sick",
  "accident",
  "vehicle",
  "absent",
  "abs_lh",
  "abs_lo",
  "custom",
] as const;
export type PayrollStatusFilter = (typeof PAYROLL_STATUS_FILTERS)[number];

/** Chip dot colours, one per SOP day type. Selected state is the emerald
 *  ToggleChip stack, so these are only the legend's identity swatch. */
export const PAYROLL_STATUS_CHIP: Record<PayrollStatusFilter, { hex: string }> = {
  work: { hex: "#9aa4ad" },
  reduced3: { hex: "#fbbf24" },
  half: { hex: "#22d3ee" },
  actual: { hex: "#86efac" },
  off: { hex: "#34d399" },
  sick: { hex: "#f59e0b" },
  accident: { hex: "#a3e635" },
  vehicle: { hex: "#a5b4fc" },
  absent: { hex: "#ef4444" },
  abs_lh: { hex: "#f472b6" },
  abs_lo: { hex: "#fda4af" },
  custom: { hex: "#c084fc" },
};

export function riderHasDayStatus(
  days: readonly DayStatus[],
  status: PayrollStatusFilter,
): boolean {
  return days.includes(status);
}

export function countRidersByStatus(
  rows: ReadonlyArray<{ days: readonly DayStatus[] }>,
): Record<PayrollStatusFilter, number> {
  const counts = Object.fromEntries(
    PAYROLL_STATUS_FILTERS.map((status) => [status, 0]),
  ) as Record<PayrollStatusFilter, number>;
  for (const row of rows) {
    for (const status of PAYROLL_STATUS_FILTERS) {
      if (riderHasDayStatus(row.days, status)) counts[status] += 1;
    }
  }
  return counts;
}

/** Rider-days: every matching day-cell, not unique riders. */
export function countDaysByStatus(
  rows: ReadonlyArray<{ days: readonly DayStatus[] }>,
): Record<PayrollStatusFilter, number> {
  const counts = Object.fromEntries(
    PAYROLL_STATUS_FILTERS.map((status) => [status, 0]),
  ) as Record<PayrollStatusFilter, number>;
  for (const row of rows) {
    for (const status of row.days) {
      if (status in counts) counts[status as PayrollStatusFilter] += 1;
    }
  }
  return counts;
}

export function countedRiderDays(rows: ReadonlyArray<{ days: readonly DayStatus[] }>): number {
  return rows.reduce((sum, row) => sum + row.days.filter((status) => status !== "blank").length, 0);
}

export function filterRidersByStatus<T extends { days: readonly DayStatus[] }>(
  rows: readonly T[],
  status: PayrollStatusFilter | null,
): T[] {
  if (!status) return [...rows];
  return rows.filter((row) => riderHasDayStatus(row.days, status));
}

export function shareOfPayroll(matching: number, total: number): number {
  if (!Number.isFinite(matching) || !Number.isFinite(total) || total <= 0) return 0;
  return (matching / total) * 100;
}

/**
 * The previous-month zone category, as SOP §5.1 bands it. Kept as a filter list
 * separate from `ZoneCategory` so this module stays free of the engine import
 * (the engine already depends on `DayStatus` from here).
 */
export const PAYROLL_ZONE_CATEGORY_FILTERS = [
  "good",
  "average",
  "low",
  "not_set",
] as const;
export type PayrollZoneCategoryFilter = (typeof PAYROLL_ZONE_CATEGORY_FILTERS)[number];

/** Identity swatch per zone band. Selected state is the emerald ToggleChip. */
export const PAYROLL_ZONE_CATEGORY_CHIP: Record<PayrollZoneCategoryFilter, string> = {
  good: "#33c777",
  average: "#f0a83c",
  low: "#ef5b5b",
  not_set: "#94a3b8",
};

export function countRidersByZoneCategory(
  rows: ReadonlyArray<{ zoneCategory: string }>,
): Record<PayrollZoneCategoryFilter, number> {
  const counts = Object.fromEntries(
    PAYROLL_ZONE_CATEGORY_FILTERS.map((category) => [category, 0]),
  ) as Record<PayrollZoneCategoryFilter, number>;
  for (const row of rows) {
    const category = row.zoneCategory as PayrollZoneCategoryFilter;
    if (category in counts) counts[category] += 1;
  }
  return counts;
}

export function filterRidersByZoneCategory<T extends { zoneCategory: string }>(
  rows: readonly T[],
  category: PayrollZoneCategoryFilter | null,
): T[] {
  if (!category) return [...rows];
  return rows.filter((row) => row.zoneCategory === category);
}

export type PayrollKpis = {
  riders: number;
  active: number;
  avgEfficiency: number;
  atOrAbove100: number;
  unjustifiedRiders: number;
  /** Day-cells credited at the 3 h rate across the filtered riders. */
  reduced3Days: number;
  /** Day-cells carrying a hand adjustment across the filtered riders. */
  manualAdjustments: number;
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

/** Hours a full duty day is worth. Mirrors v_day_hours in admin_payroll_month_snapshot. */
export const PAYROLL_DAY_HOURS = 12;

/**
 * Off days assumed when a driver has no driver_off_structure row for the month.
 * 2 is the rule the page used before the Off Structure editor existed, so an
 * un-uploaded month keeps the Required Hours it already had.
 */
export const PAYROLL_DEFAULT_OFF_DAYS = 2;

export function fixedDaysFor(monthDays: number): number {
  return monthDays - PAYROLL_DEFAULT_OFF_DAYS;
}

/** Required Hours = (days in month − contracted OFF days) × 12. */
export function requiredHoursFor(monthDays: number, offStructureDays: number): number {
  if (!Number.isFinite(monthDays) || !Number.isFinite(offStructureDays)) return 0;
  return Math.max(0, (monthDays - offStructureDays) * PAYROLL_DAY_HOURS);
}

export function prorateOffDays(offDays: number, days: number): number {
  if (!Number.isFinite(offDays) || !Number.isFinite(days) || days <= 0) return 0;
  return Math.round((offDays * days) / 30);
}

export function requiredHoursForRange(
  days: number,
  contractedOffDays: number,
  reqPerDay = PAYROLL_DAY_HOURS,
): number {
  const off = prorateOffDays(contractedOffDays, days);
  return Math.max(0, (days - off) * reqPerDay);
}

export function offStructureHoursFor(offStructureDays: number): number {
  if (!Number.isFinite(offStructureDays)) return 0;
  return Math.max(0, offStructureDays) * PAYROLL_DAY_HOURS;
}

export function parseMonthKey(key: string): { year: number; month: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return { year, month };
}

export function formatPayrollMonthLabel(key: string, locale = "en"): string {
  const parsed = parseMonthKey(key);
  if (!parsed) return key;
  return new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(parsed.year, parsed.month - 1, 1)));
}

export function monthMeta(key: string, locale = "en"): PayrollMonthMeta | null {
  const parsed = parseMonthKey(key);
  if (!parsed) return null;
  const days = daysInCalendarMonth(parsed.year, parsed.month);
  return {
    key,
    year: parsed.year,
    month: parsed.month,
    days,
    label: formatPayrollMonthLabel(key, locale),
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

/**
 * Allowed archive: Kuwait current month + previous 2.
 * Intentional product window — do not expand without a separate client discussion.
 */
export function payrollMonths(todayYmd: string, locale = "en"): PayrollMonthMeta[] {
  const currentKey = todayYmd.slice(0, 7);
  return [0, -1, -2].map((delta) => {
    const meta = monthMeta(shiftMonthKey(currentKey, delta), locale);
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

export function dayLabel(monthKey: string, dayNum: number, locale = "en"): string {
  const parsed = parseMonthKey(monthKey);
  if (!parsed) return String(dayNum);
  const month = new Intl.DateTimeFormat(locale, {
    month: "short",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(parsed.year, parsed.month - 1, 1)));
  return `${dayNum}-${month}`;
}

export function isoDateInMonth(monthKey: string, dayNum: number): string {
  return `${monthKey}-${String(dayNum).padStart(2, "0")}`;
}

const MONTH_ABBR_UPPER = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
] as const;

function parseYmd(iso: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

export function isoDayLabel(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso;
  return `${Number(match[3])}-${MONTH_ABBR_UPPER[Number(match[2]) - 1]}`;
}

export function rangeDates(from: string, to: string): string[] {
  const start = parseYmd(from);
  const end = parseYmd(to);
  if (!start || !end || start > end) return [];
  const dates: string[] = [];
  for (const cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    dates.push(cursor.toISOString().slice(0, 10));
  }
  return dates;
}

export function rangeDays(from: string, to: string): number {
  return rangeDates(from, to).length;
}

export function monthKeysTouched(from: string, to: string): string[] {
  return [...new Set(rangeDates(from, to).map((date) => date.slice(0, 7)))];
}

export function payrollAccessibleRange(todayYmd: string): PayrollRange {
  const months = payrollMonths(todayYmd);
  const newest = months[0]!;
  const oldest = months[months.length - 1]!;
  return {
    from: `${oldest.key}-01`,
    to: `${newest.key}-${String(newest.days).padStart(2, "0")}`,
  };
}

export function clampPayrollRange(from: string, to: string, todayYmd: string): PayrollRange {
  const win = payrollAccessibleRange(todayYmd);
  let a = from;
  let b = to;
  if (a > b) [a, b] = [b, a];
  if (a < win.from) a = win.from;
  if (b > win.to) b = win.to;
  if (a > b) return win;
  return { from: a, to: b };
}

export function periodFromMonthMeta(month: PayrollMonthMeta): PayrollPeriod {
  const from = `${month.key}-01`;
  const to = `${month.key}-${String(month.days).padStart(2, "0")}`;
  return { ...month, from, to, dates: rangeDates(from, to) };
}

export function periodFromRange(
  from: string,
  to: string,
  todayYmd: string,
  locale = "en",
): PayrollPeriod {
  const clamped = clampPayrollRange(from, to, todayYmd);
  const dates = rangeDates(clamped.from, clamped.to);
  const startKey = clamped.from.slice(0, 7);
  const meta = monthMeta(startKey, locale) ?? assertPayrollMonth(startKey, todayYmd);
  const endKey = clamped.to.slice(0, 7);
  const fullMonth =
    startKey === endKey &&
    clamped.from.endsWith("-01") &&
    clamped.to === `${startKey}-${String(meta.days).padStart(2, "0")}`;
  if (fullMonth) return periodFromMonthMeta(meta);
  return {
    key: `${clamped.from}_${clamped.to}`,
    year: meta.year,
    month: meta.month,
    days: dates.length,
    label: `${isoDayLabel(clamped.from)} – ${isoDayLabel(clamped.to)}`,
    fixedDays: dates.length - prorateOffDays(PAYROLL_DEFAULT_OFF_DAYS, dates.length),
    from: clamped.from,
    to: clamped.to,
    dates,
  };
}

export function payrollPeriodForPreset(
  preset: PayrollRangePreset,
  todayYmd: string,
  custom: PayrollRange | null,
  locale = "en",
): PayrollPeriod {
  if (preset === "custom" && custom) {
    return periodFromRange(custom.from, custom.to, todayYmd, locale);
  }
  const months = payrollMonths(todayYmd, locale);
  const meta = preset === "lastMonth" ? (months[1] ?? months[0]!) : months[0]!;
  return periodFromMonthMeta(meta);
}

export function kuwaitMonthBounds(monthKey: string): { startIso: string; endExclusiveIso: string } {
  const parsed = parseMonthKey(monthKey);
  if (!parsed) throw new Error("invalid_month");
  const start = `${monthKey}-01`;
  const next = shiftMonthKey(monthKey, 1);
  return { startIso: start, endExclusiveIso: `${next}-01` };
}

/** Attendance Efficiency = Actual Worked Hours ÷ Required Hours. */
export function efficiencyPct(actualHours: number, requiredHours: number): number {
  if (!Number.isFinite(actualHours) || !Number.isFinite(requiredHours) || requiredHours <= 0) {
    return 0;
  }
  return (actualHours / requiredHours) * 100;
}

/**
 * Hours for one attendance log. An open log (no check-out) is 0 hours: the shift
 * has not ended, and assuming a length would inflate the month.
 * Deliberately uncapped — a rider who worked 16 hours worked 16 hours.
 */
export function attendanceLogHours(
  checkInAt: string | null,
  checkOutAt: string | null,
): number {
  if (!checkInAt || !checkOutAt) return 0;
  const start = Date.parse(checkInAt);
  const end = Date.parse(checkOutAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, (end - start) / 3_600_000);
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
    case "off":
      return !approved.off;
    case "sick":
      return !approved.sick;
    case "accident":
      return !approved.accident;
    case "work":
    case "reduced3":
    case "half":
    case "actual":
    case "vehicle":
    case "absent":
    case "abs_lh":
    case "abs_lo":
    case "custom":
    case "blank":
      return false;
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
  /** Kuwait check-in date → summed check-in→check-out hours for that date. */
  hoursByDate?: ReadonlyMap<string, number>;
  /** Contracted OFF days for this driver this month. Absent = the 2-day default. */
  offStructureDays?: number;
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
  offStructureDays: number;
  offStructureHours: number;
  requiredHours: number;
  actualHours: number;
  efficiency: number;
} {
  const days: DayStatus[] = [];
  let workDays = 0;
  let offDays = 0;
  let sickDays = 0;
  let accidentDays = 0;
  let absentDays = 0;
  let unjustified = 0;
  let actualHours = 0;

  for (let d = 1; d <= input.month.days; d += 1) {
    const date = isoDateInMonth(input.month.key, d);
    actualHours += input.hoursByDate?.get(date) ?? 0;
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
      // The v4 rule statuses can only arrive from the rule engine / an
      // adjustment, never from `classifyDay` here. They are counted by the
      // rider row itself, so this legacy pass leaves them alone.
      case "reduced3":
      case "half":
      case "actual":
      case "vehicle":
      case "abs_lh":
      case "abs_lo":
      case "custom":
      case "blank":
        break;
      default: {
        const _never: never = status;
        void _never;
      }
    }
  }

  const offStructureDays = Number.isFinite(input.offStructureDays)
    ? (input.offStructureDays as number)
    : PAYROLL_DEFAULT_OFF_DAYS;
  const requiredHours = requiredHoursFor(input.month.days, offStructureDays);
  const rounded = Math.round(
    (input.hoursByDate ? actualHours : workDays * PAYROLL_DAY_HOURS) * 100,
  ) / 100;

  return {
    days,
    workDays,
    offDays,
    sickDays,
    accidentDays,
    absentDays,
    unjustified,
    totalHours: workDays * PAYROLL_DAY_HOURS,
    fixedDays: input.month.fixedDays,
    offStructureDays,
    offStructureHours: offStructureHoursFor(offStructureDays),
    requiredHours,
    actualHours: rounded,
    efficiency: efficiencyPct(rounded, requiredHours),
  };
}

export function computePayrollKpis(
  rows: ReadonlyArray<{
    status: "Active" | "Inactive";
    efficiency: number;
    unjustified: number;
    reducedDays?: number;
    adjustedCells?: number;
  }>,
): PayrollKpis {
  const riders = rows.length;
  const active = rows.filter((r) => r.status === "Active").length;
  const avgEfficiency =
    riders === 0 ? 0 : rows.reduce((sum, r) => sum + r.efficiency, 0) / riders;
  const atOrAbove100 = rows.filter((r) => r.efficiency >= 100).length;
  const unjustifiedRiders = rows.filter((r) => r.unjustified > 0).length;
  const reduced3Days = rows.reduce((sum, r) => sum + (r.reducedDays ?? 0), 0);
  const manualAdjustments = rows.reduce((sum, r) => sum + (r.adjustedCells ?? 0), 0);
  return {
    riders,
    active,
    avgEfficiency,
    atOrAbove100,
    unjustifiedRiders,
    reduced3Days,
    manualAdjustments,
  };
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
    case "reduced3":
      return "3h";
    case "half":
      return "HALF";
    case "actual":
      return "ACT";
    case "off":
      return "OFF";
    case "sick":
      return "Sick";
    case "accident":
      return "Accident";
    case "vehicle":
      return "Vehicle";
    case "absent":
      return "Absent";
    case "abs_lh":
      return "Abs·LH";
    case "abs_lo":
      return "Abs·LO";
    case "custom":
      return "CUS";
    case "blank":
      return "";
    default: {
      const _never: never = status;
      return _never;
    }
  }
}

/** Grid cell token. Actual / custom show credited hours, never ACT / CUS. */
export function dayGridLabel(status: DayStatus, hours: number): string {
  switch (status) {
    case "work":
      // A full SOP day keeps the bare `12`; a day attendance measured shorter
      // prints what it actually was, so the grid cannot claim a full day for a
      // 4 h shift.
      return hours > 0 && hours !== 12 ? `${formatHoursToken(hours)}h` : "12";
    case "reduced3":
      return "3h";
    case "off":
      return "OFF";
    case "sick":
      return "Sick";
    case "accident":
      return "Acc";
    case "vehicle":
      return "Veh";
    case "absent":
      return "Absent";
    case "half":
      return "Half";
    case "actual":
    case "custom":
      return `${hours}h`;
    case "abs_lh":
      return "Abs·LH";
    case "abs_lo":
      return "Abs·LO";
    case "blank":
      return "";
    default: {
      const _never: never = status;
      return _never;
    }
  }
}

/** `9`, `9.5` — one decimal at most, no trailing `.0`. */
function formatHoursToken(hours: number): string {
  const rounded = Math.round(hours * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/**
 * The hours a grid cell should print for a day.
 *
 * A `work` cell used to print a flat `12` no matter what attendance recorded,
 * so a 9 h shift and a 50-minute shift both read as a full SOP day. The cell now
 * carries the logged hours whenever attendance measured any, a still-open
 * check-in carries the hours elapsed so far (`elapsedHours`, today only), and a
 * day with no attendance reading at all falls back to the SOP credit. This is
 * display only — the rule engine still decides the day from `loggedHours`.
 */
export function dayDisplayHours(
  status: DayStatus,
  info:
    | { loggedHours?: number; elapsedHours?: number; creditedHours?: number }
    | undefined,
): number {
  if (!info) return 0;
  const credited = info.creditedHours ?? 0;
  if (status !== "work") return credited;
  const logged = info.loggedHours ?? 0;
  if (logged > 0) return logged;
  const elapsed = info.elapsedHours ?? 0;
  if (elapsed > 0) return elapsed;
  return credited;
}

export function formatPayrollPct(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return "0.0%";
  return `${value.toFixed(digits)}%`;
}

export function payrollRiderMatchesSearch(
  row: {
    name: string;
    zone: string;
    restaurant: string;
    restaurantId?: string | null;
    amId: string;
    mgId: string;
  },
  query: string,
): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [row.name, row.zone, row.restaurant, row.restaurantId ?? "", row.amId, row.mgId].some((value) =>
    value.toLowerCase().includes(needle),
  );
}

export function keepSelectedPayrollOptions<
  T extends {
    zones: Array<{ id: string; name: string }>;
    restaurants: Array<{ id: string; name: string }>;
    nationalities: string[];
  },
>(
  options: T,
  selected: { zoneIds: string[]; restaurantIds: string[]; nationalities: string[] },
): T {
  const zones = [...options.zones];
  for (const id of selected.zoneIds) {
    if (!zones.some((z) => z.id === id)) zones.push({ id, name: id });
  }
  const restaurants = [...options.restaurants];
  for (const id of selected.restaurantIds) {
    if (!restaurants.some((r) => r.id === id)) restaurants.push({ id, name: id });
  }
  const nationalities = [...options.nationalities];
  for (const code of selected.nationalities) {
    if (!nationalities.includes(code)) nationalities.push(code);
  }
  return { ...options, zones, restaurants, nationalities };
}
