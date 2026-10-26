export type CountRow = { key: string; count: number };

export type OpsKpis = {
  assigned: number;
  working: number;
  onLeave: number;
  absent: number;
  sick: number;
  other: number;
  accident: number;
  workingRate: number;
};

export type ProjectRow = {
  key: string;
  label: string;
  assigned: number;
  working: number;
  onLeave: number;
  absent: number;
  sick: number;
  other: number;
  barPct: number;
};

export type EmployeeStatusKey =
  | "running"
  | "extension"
  | "leave"
  | "new"
  | "absentFromMosal"
  | "cancelled";

export type EmployeeStatusTile = { key: EmployeeStatusKey; count: number };

export type LeaveMonthBar = {
  yearMonth: string;
  count: number;
  tense: "past" | "current" | "future";
  label?: string;
};

export type LeavePlanRow = {
  id: string;
  employeeId: string;
  name: string;
  project: string;
  leaveType: string;
  start: string;
  end: string;
  days: string;
  status: string;
  yearMonth: string;
  zone: string;
  source: "plan" | "request";
};

export type OutlookKey =
  | "returningThisWeek"
  | "startingThisWeek"
  | "pendingApproval"
  | "overdue"
  | "newJoiners";

export type OutlookFilter = Exclude<OutlookKey, "newJoiners">;

export type JobEndCardKey = "next30" | "eoy" | "next6m" | "noRenewal";

export type RiderOnLeaveRow = {
  employeeId: string;
  name: string;
  project: string;
  leaveType: string;
  start: string;
  end: string;
  returnWithin3Days: boolean;
};

export type StatusProjectRow = {
  key: string;
  running: number;
  extension: number;
  leave: number;
  new: number;
  absentFromMosal: number;
  cancelled: number;
  total: number;
};

export const ROSTER_STATUSES = ["working", "onLeave", "absent", "sick", "other"] as const;

export type RosterStatus = (typeof ROSTER_STATUSES)[number];

export type RosterFilter = "all" | "notWorking" | RosterStatus;

export type RosterRow = {
  employeeId: string;
  name: string;
  project: string;
  zone: string;
  status: RosterStatus;
  statuses: RosterStatus[];
  joined: string;
  phone: string;
};

export const DASHBOARD_PERIODS = ["today", "yesterday", "thisWeek", "last7", "thisMonth", "lastMonth", "custom"] as const;

export type DashboardPeriod = (typeof DASHBOARD_PERIODS)[number];

export type ContractMonth = { yearMonth: string; count: number; rate: number };

export type ContractTurnover = {
  rate: number;
  ended: number;
  assumed: number;
  total: number;
  months: ContractMonth[];
};

export type HireGroup = { label: string; current: number; leaving: number };

export type HiringPlan = {
  current: number;
  leaving: number;
  horizon: string;
  designation: HireGroup[];
  zone: HireGroup[];
  project: HireGroup[];
};

export type ZoneOption = { id: string; name: string };

export type PlainRow = Record<string, unknown>;

export type OperationsDashboard = {
  today: string;
  zones: ZoneOption[];
  statusBar: CountRow[];
  kpis: OpsKpis;
  byProject: ProjectRow[];
  employeeStatus: EmployeeStatusTile[];
  statusByProject: StatusProjectRow[];
  leaveMonths: LeaveMonthBar[];
  leavePlans: LeavePlanRow[];
  outlook: Record<OutlookKey, LeavePlanRow[]>;
  jobEndMonths: LeaveMonthBar[];
  jobEndCards: Record<JobEndCardKey, number>;
  ridersOnLeave: RiderOnLeaveRow[];
  roster: RosterRow[];
  from: string;
  to: string;
  turnover: ContractTurnover;
  hiring: HiringPlan;
  exportLeaveYear: PlainRow[];
  exportLeaveMonth: PlainRow[];
  exportJobEnd: PlainRow[];
};

export type LeaveImportRow = {
  employee_id: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  status: string;
};

const EMPLOYEE_STATUS_KEYS: readonly EmployeeStatusKey[] = [
  "running",
  "extension",
  "leave",
  "new",
  "absentFromMosal",
  "cancelled",
];

const OUTLOOK_KEYS: readonly OutlookKey[] = [
  "returningThisWeek",
  "startingThisWeek",
  "pendingApproval",
  "overdue",
  "newJoiners",
];

const DAILY_KEYS = ["working", "onLeave", "absent", "sick", "other", "accident"] as const;

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function num(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return 0;
}

function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function pick(row: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    const value = row[key];
    if (value != null && value !== "") return value;
  }
  return undefined;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function currentYearMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

function tenseOf(yearMonth: string, raw: unknown): LeaveMonthBar["tense"] {
  if (raw === "past" || raw === "current" || raw === "future") return raw;
  const today = currentYearMonth();
  if (yearMonth < today) return "past";
  if (yearMonth > today) return "future";
  return "current";
}

function emptyKpis(): OpsKpis {
  return {
    assigned: 0,
    working: 0,
    onLeave: 0,
    absent: 0,
    sick: 0,
    other: 0,
    accident: 0,
    workingRate: 0,
  };
}

function emptyOutlook(): Record<OutlookKey, LeavePlanRow[]> {
  return {
    returningThisWeek: [],
    startingThisWeek: [],
    pendingApproval: [],
    overdue: [],
    newJoiners: [],
  };
}

function emptyTurnover(): ContractTurnover {
  return { rate: 0, ended: 0, assumed: 0, total: 0, months: [] };
}

function emptyHiring(): HiringPlan {
  return { current: 0, leaving: 0, horizon: "", designation: [], zone: [], project: [] };
}

export function emptyOperationsDashboard(): OperationsDashboard {
  return {
    today: "",
    zones: [],
    statusBar: [],
    kpis: emptyKpis(),
    byProject: [],
    employeeStatus: EMPLOYEE_STATUS_KEYS.map((key) => ({ key, count: 0 })),
    statusByProject: [],
    leaveMonths: [],
    leavePlans: [],
    outlook: emptyOutlook(),
    jobEndMonths: [],
    jobEndCards: { next30: 0, eoy: 0, next6m: 0, noRenewal: 0 },
    ridersOnLeave: [],
    roster: [],
    from: "",
    to: "",
    turnover: emptyTurnover(),
    hiring: emptyHiring(),
    exportLeaveYear: [],
    exportLeaveMonth: [],
    exportJobEnd: [],
  };
}

function readKpis(raw: unknown): OpsKpis {
  const row = record(raw);
  if (!row) return emptyKpis();
  return {
    assigned: num(pick(row, ["assigned", "assignedRiders"])),
    working: num(pick(row, ["working", "workingToday"])),
    onLeave: num(pick(row, ["onLeave", "on_leave"])),
    absent: num(pick(row, ["absent"])),
    sick: num(pick(row, ["sick"])),
    other: num(pick(row, ["other"])),
    accident: num(pick(row, ["accident"])),
    workingRate: num(pick(row, ["workingRate", "working_rate"])),
  };
}

const STATUS_ALIASES: Record<string, string> = {
  on_leave: "onLeave",
  onleave: "onLeave",
};

export function isRosterStatus(value: string): value is RosterStatus {
  return (ROSTER_STATUSES as readonly string[]).includes(value);
}

export function rosterMatches(status: RosterStatus, filter: RosterFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "notWorking":
      return status !== "working";
    case "working":
    case "onLeave":
    case "absent":
    case "sick":
    case "other":
      return status === filter;
    default: {
      const neverFilter: never = filter;
      return neverFilter;
    }
  }
}

export function filterRoster(rows: readonly RosterRow[], filter: RosterFilter, query: string): RosterRow[] {
  const needle = query.trim().toLowerCase();
  return rows.filter((row) => {
    const statuses = row.statuses.length > 0 ? row.statuses : [row.status];
    if (!statuses.some((status) => rosterMatches(status, filter))) return false;
    if (!needle) return true;
    return row.name.toLowerCase().includes(needle) || row.employeeId.toLowerCase().includes(needle);
  });
}

function readStatuses(raw: unknown, fallback: RosterStatus): RosterStatus[] {
  const found: RosterStatus[] = [];
  for (const item of list(raw)) {
    const key = STATUS_ALIASES[text(item)] ?? text(item);
    if (isRosterStatus(key) && !found.includes(key)) found.push(key);
  }
  return found.length > 0 ? found : [fallback];
}

function addUtcDays(ymd: string, days: number): string {
  const [year, month, day] = ymd.split("-").map(Number);
  const next = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, (day ?? 1) + days));
  const mm = String(next.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(next.getUTCDate()).padStart(2, "0");
  return `${next.getUTCFullYear()}-${mm}-${dd}`;
}

function isPeriodYmd(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function periodBounds(period: DashboardPeriod, today: string, customFrom: string, customTo: string): { from: string; to: string } {
  const to = isPeriodYmd(today) ? today : new Date().toISOString().slice(0, 10);
  switch (period) {
    case "today":
      return { from: to, to };
    case "yesterday": {
      const yesterday = addUtcDays(to, -1);
      return { from: yesterday, to: yesterday };
    }
    case "thisWeek": {
      const dow = new Date(`${to}T00:00:00Z`).getUTCDay();
      const back = (dow + 1) % 7;
      return { from: addUtcDays(to, -back), to };
    }
    case "last7":
      return { from: addUtcDays(to, -6), to };
    case "thisMonth":
      return { from: `${to.slice(0, 7)}-01`, to };
    case "lastMonth": {
      const first = `${to.slice(0, 7)}-01`;
      const end = addUtcDays(first, -1);
      return { from: `${end.slice(0, 7)}-01`, to: end };
    }
    case "custom": {
      let end = isPeriodYmd(customTo) ? customTo : to;
      if (end > to) end = to;
      let start = isPeriodYmd(customFrom) ? customFrom : end;
      if (start > end) {
        const swap = start;
        start = end;
        end = swap;
      }
      const earliest = addUtcDays(end, -30);
      if (start < earliest) start = earliest;
      return { from: start, to: end };
    }
    default: {
      const neverPeriod: never = period;
      return neverPeriod;
    }
  }
}

function readRoster(raw: unknown): RosterRow[] {
  const rows: RosterRow[] = [];
  for (const item of list(raw)) {
    const row = record(item);
    if (!row) continue;
    const statusRaw = STATUS_ALIASES[text(pick(row, ["status"]))] ?? text(pick(row, ["status"]));
    if (!isRosterStatus(statusRaw)) continue;
    rows.push({
      employeeId: text(pick(row, ["employeeId", "employee_id"])),
      name: text(pick(row, ["name", "full_name"])),
      project: text(pick(row, ["project", "project_key"])),
      zone: text(pick(row, ["zone", "zone_name"])),
      status: statusRaw,
      statuses: readStatuses(row.statuses, statusRaw),
      joined: text(pick(row, ["joined", "work_start_date", "workStart"])),
      phone: text(pick(row, ["phone"])),
    });
  }
  return rows;
}

function readStatusBar(raw: unknown): CountRow[] {
  if (Array.isArray(raw)) {
    const rows: CountRow[] = [];
    for (const item of raw) {
      const row = record(item);
      if (!row) continue;
      const key = text(pick(row, ["key", "status", "id"]));
      if (!key) continue;
      rows.push({
        key: STATUS_ALIASES[key] ?? key,
        count: num(pick(row, ["count", "value", "total"])),
      });
    }
    return rows;
  }
  const row = record(raw);
  if (!row) return [];
  return DAILY_KEYS.map((key) => ({
    key,
    count: num(pick(row, [key, key === "onLeave" ? "on_leave" : key])),
  }));
}

function readProjects(raw: unknown): ProjectRow[] {
  const items = list(raw);
  const rows: ProjectRow[] = [];
  for (const item of items) {
    const row = record(item);
    if (!row) continue;
    const key = text(pick(row, ["key", "projectKey", "project_key", "project"]));
    if (!key) continue;
    rows.push({
      key,
      label: text(pick(row, ["label", "name"])) || key,
      assigned: num(pick(row, ["assigned", "count", "riders"])),
      working: num(pick(row, ["working"])),
      onLeave: num(pick(row, ["onLeave", "on_leave"])),
      absent: num(pick(row, ["absent"])),
      sick: num(pick(row, ["sick"])),
      other: num(pick(row, ["other"])),
      barPct: 0,
    });
  }
  const total = rows.reduce((sum, row) => sum + row.assigned, 0);
  return rows.map((row) => {
    const source = record(items.find((item) => {
      const candidate = record(item);
      return candidate != null && text(pick(candidate, ["key", "projectKey", "project_key", "project"])) === row.key;
    }));
    const share = source ? num(pick(source, ["share", "bar", "pct"])) : 0;
    const barPct = share > 0 ? (share <= 1 ? share * 100 : share) : total > 0 ? (row.assigned / total) * 100 : 0;
    return { ...row, barPct: Math.max(0, Math.min(100, barPct)) };
  });
}

const STATUS_KEY_ALIASES: Record<string, EmployeeStatusKey> = {
  running: "running",
  extension: "extension",
  leave: "leave",
  new: "new",
  absentfrommosal: "absentFromMosal",
  absent_from_mosal: "absentFromMosal",
  cancelled: "cancelled",
  canceled: "cancelled",
};

function canonicalStatus(key: string): EmployeeStatusKey | null {
  return STATUS_KEY_ALIASES[key.replace(/[\s-]/g, "").toLowerCase()] ?? STATUS_KEY_ALIASES[key] ?? null;
}

function readEmployeeStatus(raw: unknown): EmployeeStatusTile[] {
  const counts = new Map<EmployeeStatusKey, number>();
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const row = record(item);
      if (!row) continue;
      const key = canonicalStatus(text(pick(row, ["key", "status", "id"])));
      if (!key) continue;
      counts.set(key, num(pick(row, ["count", "value", "total"])));
    }
  } else {
    const row = record(raw);
    if (row) {
      for (const [key, value] of Object.entries(row)) {
        const canonical = canonicalStatus(key);
        if (canonical) counts.set(canonical, num(value));
      }
    }
  }
  return EMPLOYEE_STATUS_KEYS.map((key) => ({ key, count: counts.get(key) ?? 0 }));
}

function readMonths(raw: unknown): LeaveMonthBar[] {
  const bars: LeaveMonthBar[] = [];
  for (const item of list(raw)) {
    const row = record(item);
    if (!row) continue;
    const yearMonth = text(pick(row, ["yearMonth", "year_month", "month", "key"]));
    if (!yearMonth) continue;
    const label = text(pick(row, ["label"]));
    bars.push({
      yearMonth,
      count: num(pick(row, ["count", "value", "total"])),
      tense: tenseOf(yearMonth, pick(row, ["tense"])),
      ...(label ? { label } : {}),
    });
  }
  return bars;
}

export function readLeavePlan(value: unknown): LeavePlanRow | null {
  const row = record(value);
  if (!row) return null;
  const employeeId = text(pick(row, ["employeeId", "employee_id", "mgId", "mg_id"]));
  const name = text(pick(row, ["name", "fullName", "full_name", "driver_name", "driverName"]));
  if (!employeeId && !name && !text(pick(row, ["id", "planId", "plan_id"]))) return null;
  return {
    id: text(pick(row, ["id", "planId", "plan_id"])),
    employeeId,
    name,
    project: text(pick(row, ["project", "projectKey", "project_key"])),
    leaveType: text(pick(row, ["leaveType", "leave_type", "type"])),
    start: text(pick(row, ["start", "startDate", "start_date"])),
    end: text(pick(row, ["end", "endDate", "end_date"])),
    days: text(pick(row, ["days", "dayCount", "day_count", "days_count", "daysCount", "Days"])),
    status: text(pick(row, ["status"])),
    yearMonth: text(pick(row, ["yearMonth", "year_month"])),
    zone: text(pick(row, ["zone", "zoneName", "zone_name"])),
    source: text(pick(row, ["source"])) === "request" ? "request" : "plan",
  };
}

function readPlans(raw: unknown): LeavePlanRow[] {
  return list(raw).map(readLeavePlan).filter((row): row is LeavePlanRow => row != null);
}

/** Accepts a bare array or a `{ leavePlans | rows | plans }` payload from adminListLeavePlans. */
export function leavePlansFromPayload(raw: unknown): LeavePlanRow[] | null {
  if (Array.isArray(raw)) return readPlans(raw);
  const row = record(raw);
  if (!row) return null;
  const nested = pick(row, ["leavePlans", "leave_plans", "rows", "plans"]);
  if (nested == null) return null;
  return readPlans(nested);
}

function readOutlook(raw: unknown): Record<OutlookKey, LeavePlanRow[]> {
  const base = emptyOutlook();
  const row = record(raw);
  if (!row) return base;
  for (const key of OUTLOOK_KEYS) {
    const snake = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
    base[key] = readPlans(pick(row, [key, snake]));
  }
  return base;
}

function cardCount(raw: unknown): number {
  if (Array.isArray(raw)) return raw.length;
  const row = record(raw);
  if (row && row.count != null) return num(row.count);
  return num(raw);
}

function readJobCards(raw: unknown): Record<JobEndCardKey, number> {
  const row = record(raw);
  if (!row) return { next30: 0, eoy: 0, next6m: 0, noRenewal: 0 };
  return {
    next30: cardCount(pick(row, ["next30", "next_30", "next30Days"])),
    eoy: cardCount(pick(row, ["eoy", "endOfYear", "end_of_year"])),
    next6m: cardCount(pick(row, ["next6m", "next_6m", "next6Months"])),
    noRenewal: cardCount(pick(row, ["noRenewal", "no_renewal"])),
  };
}

function readRidersOnLeave(raw: unknown): RiderOnLeaveRow[] {
  const rows: RiderOnLeaveRow[] = [];
  for (const item of list(raw)) {
    const row = record(item);
    if (!row) continue;
    const plan = readLeavePlan(row);
    if (!plan) continue;
    const flag = pick(row, ["returnWithin3Days", "return_within_3_days"]);
    rows.push({
      employeeId: plan.employeeId,
      name: plan.name,
      project: plan.project,
      leaveType: plan.leaveType,
      start: plan.start,
      end: plan.end,
      returnWithin3Days: flag === true || flag === "true" || flag === 1,
    });
  }
  return rows;
}

function plainRows(raw: unknown): PlainRow[] {
  return list(raw).map(record).filter((row): row is PlainRow => row != null);
}

function readZones(raw: unknown): ZoneOption[] {
  const zones: ZoneOption[] = [];
  for (const item of list(raw)) {
    const row = record(item);
    if (!row) continue;
    const id = text(pick(row, ["id", "zoneId", "zone_id"]));
    const name = text(pick(row, ["name", "label"])) || id;
    if (!id && !name) continue;
    zones.push({ id: id || name, name });
  }
  return zones;
}

function readStatusProjects(raw: unknown): StatusProjectRow[] {
  const rows: StatusProjectRow[] = [];
  for (const item of list(raw)) {
    const row = record(item);
    if (!row) continue;
    const key = text(pick(row, ["key", "project", "projectKey", "project_key"]));
    if (!key) continue;
    const running = num(pick(row, ["running"]));
    const extension = num(pick(row, ["extension"]));
    const leave = num(pick(row, ["leave"]));
    const fresh = num(pick(row, ["new"]));
    const absentFromMosal = num(pick(row, ["absentFromMosal", "absent_from_mosal"]));
    const cancelled = num(pick(row, ["cancelled"]));
    const summed = running + extension + leave + fresh + absentFromMosal + cancelled;
    rows.push({
      key,
      running,
      extension,
      leave,
      new: fresh,
      absentFromMosal,
      cancelled,
      total: num(pick(row, ["total"])) || summed,
    });
  }
  return rows;
}

function readGroups(raw: unknown): HireGroup[] {
  const groups: HireGroup[] = [];
  for (const item of list(raw)) {
    const row = record(item);
    if (!row) continue;
    groups.push({
      label: text(pick(row, ["label"])),
      current: num(pick(row, ["current"])),
      leaving: num(pick(row, ["leaving"])),
    });
  }
  return groups;
}

function readTurnover(raw: unknown): ContractTurnover {
  const row = record(raw);
  if (!row || row.ended == null && row.assumed == null && !Array.isArray(row.months)) return emptyTurnover();
  const months: ContractMonth[] = [];
  for (const item of list(row.months)) {
    const month = record(item);
    if (!month) continue;
    months.push({
      yearMonth: text(pick(month, ["yearMonth", "year_month"])),
      count: num(pick(month, ["count"])),
      rate: num(pick(month, ["rate"])),
    });
  }
  return {
    rate: num(pick(row, ["rate"])),
    ended: num(pick(row, ["ended"])),
    assumed: num(pick(row, ["assumed"])),
    total: num(pick(row, ["total"])),
    months,
  };
}

function readHiring(raw: unknown): HiringPlan {
  const row = record(raw);
  if (!row || row.current == null && row.leaving == null && row.designation == null) return emptyHiring();
  return {
    current: num(pick(row, ["current"])),
    leaving: num(pick(row, ["leaving"])),
    horizon: text(pick(row, ["horizon"])),
    designation: readGroups(row.designation),
    zone: readGroups(row.zone),
    project: readGroups(row.project),
  };
}

export function normalizeOperationsDashboard(raw: unknown): OperationsDashboard {
  const row = record(raw) ?? {};
  const empty = emptyOperationsDashboard();
  const jobEndRaw = row.jobEnd;
  const jobEnd = record(jobEndRaw);
  const jobEndMonthsRaw = Array.isArray(jobEndRaw) ? jobEndRaw : jobEnd?.months;
  const exported = record(row.exports) ?? {};
  return {
    today: text(pick(row, ["today", "day"])),
    zones: readZones(pick(row, ["zones"])),
    statusBar: readStatusBar(pick(row, ["statusBar", "status_bar"])),
    kpis: readKpis(pick(row, ["kpis"])),
    byProject: readProjects(pick(row, ["byProject", "by_project"])),
    employeeStatus: row.employeeStatus == null && row.employee_status == null
      ? empty.employeeStatus
      : readEmployeeStatus(pick(row, ["employeeStatus", "employee_status"])),
    statusByProject: readStatusProjects(pick(row, ["statusByProject", "status_by_project"])),
    leaveMonths: readMonths(pick(row, ["leaveMonths", "leave_months"])),
    leavePlans: readPlans(pick(row, ["leavePlans", "leave_plans"])),
    outlook: readOutlook(pick(row, ["outlook"])),
    jobEndMonths: readMonths(pick(row, ["jobEndMonths", "job_end_months"]) ?? jobEndMonthsRaw),
    jobEndCards: readJobCards(pick(row, ["jobEndCards", "job_end_cards"]) ?? jobEnd?.cards),
    ridersOnLeave: readRidersOnLeave(pick(row, ["ridersOnLeave", "riders_on_leave"])),
    roster: readRoster(pick(row, ["roster", "riders"])),
    from: text(pick(row, ["from"])) || text(pick(row, ["today", "day"])),
    to: text(pick(row, ["to"])) || text(pick(row, ["today", "day"])),
    turnover: readTurnover(pick(row, ["turnover"])),
    hiring: readHiring(pick(row, ["hiring"])),
    exportLeaveYear: plainRows(pick(row, ["exportLeaveYear", "export_leave_year"]) ?? exported.leaveYear),
    exportLeaveMonth: plainRows(pick(row, ["exportLeaveMonth", "export_leave_month"]) ?? exported.leaveMonth),
    exportJobEnd: plainRows(pick(row, ["exportJobEnd", "export_job_end"]) ?? exported.jobEnd),
  };
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index] ?? "";
    if (quoted) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === ",") {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current);
  return cells;
}

export function parseLeaveCsv(csv: string): { rows: LeaveImportRow[] } | { error: "empty" | "header" } {
  const lines = csv.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
  if (lines.length === 0) return { error: "empty" };
  const header = splitCsvLine(lines[0] ?? "").map((cell) => cell.trim().toLowerCase());
  const expected = ["employee_id", "leave_type", "start_date", "end_date", "status"];
  if (expected.some((key, index) => header[index] !== key)) return { error: "header" };
  const rows: LeaveImportRow[] = [];
  for (const line of lines.slice(1)) {
    const cols = splitCsvLine(line);
    const row: LeaveImportRow = {
      employee_id: (cols[0] ?? "").trim(),
      leave_type: (cols[1] ?? "").trim(),
      start_date: (cols[2] ?? "").trim(),
      end_date: (cols[3] ?? "").trim(),
      status: (cols[4] ?? "").trim(),
    };
    if (row.employee_id) rows.push(row);
  }
  return { rows };
}

const BLOCKED_EXPORT_KEYS = new Set([
  "salary",
  "fixed_salary",
  "fixedsalary",
  "work_permit_salary",
  "workpermitsalary",
  "bank",
  "bank_details",
  "bankdetails",
  "iban",
  "passcode",
  "app_passcode",
  "apppasscode",
  "note",
  "note_internal",
  "noteinternal",
]);

export function cell(row: PlainRow, keys: readonly string[]): string {
  const value = pick(row, keys);
  if (value == null) return "";
  if (typeof value === "object") return "";
  return text(value);
}

export function leaveExportRows(rows: readonly PlainRow[]): string[][] {
  return rows.map((row) => [
    cell(row, ["employee_id", "employeeId", "Employee ID"]),
    cell(row, ["name", "full_name", "fullName", "Name"]),
    cell(row, ["project", "project_key", "projectKey", "Project"]),
    cell(row, ["leave_type", "leaveType", "Leave Type"]),
    cell(row, ["start_date", "startDate", "start", "Start"]),
    cell(row, ["end_date", "endDate", "end", "End"]),
    cell(row, ["days", "Days"]),
    cell(row, ["status", "Status"]),
  ]);
}

export function jobEndExportRows(rows: readonly PlainRow[]): string[][] {
  return rows.map((row) => [
    cell(row, ["employee_id", "employeeId", "Employee ID"]),
    cell(row, ["name", "full_name", "fullName", "Name"]),
    cell(row, ["project", "project_key", "projectKey", "Project"]),
    cell(row, ["status", "Status"]),
    cell(row, ["joining_date", "joiningDate", "work_start_date", "workStartDate", "Joining Date"]),
    cell(row, ["job_end_date", "jobEndDate", "Job End Date"]),
    cell(row, ["days_left", "daysLeft", "Days Left"]),
    cell(row, ["renewal_decision", "renewalDecision", "Renewal Decision"]),
  ]);
}

export function safePlainRows(rows: readonly PlainRow[]): PlainRow[] {
  return rows.map((row) => {
    const next: PlainRow = {};
    for (const [key, value] of Object.entries(row)) {
      if (BLOCKED_EXPORT_KEYS.has(key.toLowerCase())) continue;
      if (value != null && typeof value !== "object") next[key] = value;
    }
    return next;
  });
}
