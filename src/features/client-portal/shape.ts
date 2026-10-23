import {
  cell,
  readLeavePlan,
  type LeaveMonthBar,
  type LeavePlanRow,
  type PlainRow,
} from "@/features/operations-dashboard/shape";

export type PortalKpis = {
  assigned: number;
  working: number;
  onLeave: number;
  absentSick: number;
  workingRate: number;
  accident: number;
};

export type TodayBar = {
  working: number;
  onLeave: number;
  absent: number;
  sick: number;
  other: number;
};

export type RiderStatusKey = "running" | "extension" | "leave" | "new" | "cancelled";

export type RiderStatusCard = { key: RiderStatusKey; count: number; pct: number };

export type Turnover = { monthly: string; yearly: string; footnote: string };

export type TurnoverMonthRow = {
  yearMonth: string;
  label: string;
  avgActive: number;
  departures: number;
  rate: number;
};

export type TurnoverComparison = {
  months: TurnoverMonthRow[];
  annualPct: number;
  monthlyAvgPct: number;
  departuresCount: number;
  peakMonth: string;
};

export type ZoneOption = { id: string; name: string };

export type ClientPortalDashboard = {
  todayBar: TodayBar;
  assignedToYou: number;
  kpis: PortalKpis;
  riderStatus: RiderStatusCard[];
  leaveMonths: LeaveMonthBar[];
  turnover: Turnover;
  turnoverComparison: TurnoverComparison;
  leavePlans: LeavePlanRow[];
  onLeaveNow: LeavePlanRow[];
  zones: ZoneOption[];
  exportRiders: PlainRow[];
  exportLeaveMonth: PlainRow[];
  exportTurnover: PlainRow[];
};

const RIDER_KEYS: readonly RiderStatusKey[] = ["running", "extension", "leave", "new", "cancelled"];

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

export function emptyClientPortal(): ClientPortalDashboard {
  return {
    todayBar: { working: 0, onLeave: 0, absent: 0, sick: 0, other: 0 },
    assignedToYou: 0,
    kpis: { assigned: 0, working: 0, onLeave: 0, absentSick: 0, workingRate: 0, accident: 0 },
    riderStatus: RIDER_KEYS.map((key) => ({ key, count: 0, pct: 0 })),
    leaveMonths: [],
    turnover: { monthly: "", yearly: "", footnote: "" },
    turnoverComparison: { months: [], annualPct: 0, monthlyAvgPct: 0, departuresCount: 0, peakMonth: "" },
    leavePlans: [],
    onLeaveNow: [],
    zones: [],
    exportRiders: [],
    exportLeaveMonth: [],
    exportTurnover: [],
  };
}

function readToday(raw: unknown): TodayBar {
  const row = record(raw);
  if (!row) return emptyClientPortal().todayBar;
  return {
    working: num(pick(row, ["working"])),
    onLeave: num(pick(row, ["onLeave", "on_leave"])),
    absent: num(pick(row, ["absent"])),
    sick: num(pick(row, ["sick"])),
    other: num(pick(row, ["other"])),
  };
}

function readKpis(raw: unknown, assignedToYou: number): PortalKpis {
  const row = record(raw);
  if (!row) {
    return { ...emptyClientPortal().kpis, assigned: assignedToYou };
  }
  const absent = num(pick(row, ["absent"]));
  const sick = num(pick(row, ["sick"]));
  const combined = pick(row, ["absentSick", "absent_sick"]);
  return {
    assigned: num(pick(row, ["assigned"])) || assignedToYou,
    working: num(pick(row, ["working", "workingToday"])),
    onLeave: num(pick(row, ["onLeave", "on_leave"])),
    absentSick: combined == null ? absent + sick : num(combined),
    workingRate: num(pick(row, ["workingRate", "working_rate"])),
    accident: num(pick(row, ["accident"])),
  };
}

const RIDER_ALIASES: Record<string, RiderStatusKey> = {
  running: "running",
  extension: "extension",
  leave: "leave",
  new: "new",
  cancelled: "cancelled",
  canceled: "cancelled",
};

function readRiderStatus(raw: unknown, assigned: number): RiderStatusCard[] {
  const counts = new Map<RiderStatusKey, { count: number; pct: number | null }>();
  const apply = (key: string, count: number, pct: number | null) => {
    const canonical = RIDER_ALIASES[key.replace(/[\s-]/g, "").toLowerCase()];
    if (!canonical) return;
    counts.set(canonical, { count, pct });
  };
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const row = record(item);
      if (!row) continue;
      const pctRaw = pick(row, ["pct", "percent"]);
      apply(
        text(pick(row, ["key", "status", "id"])),
        num(pick(row, ["count", "value", "total"])),
        pctRaw == null ? null : num(pctRaw),
      );
    }
  } else {
    const row = record(raw);
    if (row) {
      for (const key of RIDER_KEYS) {
        const value = row[key];
        const nested = record(value);
        if (nested) {
          const pctRaw = pick(nested, ["pct", "percent"]);
          apply(key, num(pick(nested, ["count", "value"])), pctRaw == null ? null : num(pctRaw));
        } else if (value != null) {
          apply(key, num(value), null);
        }
      }
    }
  }
  return RIDER_KEYS.map((key) => {
    const found = counts.get(key);
    const count = found?.count ?? 0;
    const pct = found?.pct != null
      ? (found.pct <= 1 && found.pct > 0 ? found.pct * 100 : found.pct)
      : assigned > 0
        ? (count / assigned) * 100
        : 0;
    return { key, count, pct };
  });
}

function readMonths(raw: unknown): LeaveMonthBar[] {
  const bars: LeaveMonthBar[] = [];
  for (const item of list(raw)) {
    const row = record(item);
    if (!row) continue;
    const yearMonth = text(pick(row, ["yearMonth", "year_month", "month"]));
    if (!yearMonth) continue;
    bars.push({
      yearMonth,
      count: num(pick(row, ["count", "value", "total"])),
      tense: tenseOf(yearMonth, pick(row, ["tense"])),
    });
  }
  return bars;
}

function rateLabel(value: unknown): string {
  const row = record(value);
  if (row) {
    const rate = pick(row, ["rate"]);
    if (rate == null || rate === "") return "";
    return `${num(rate)}%`;
  }
  const plain = text(value);
  if (!plain) return "";
  return plain.endsWith("%") ? plain : `${plain}%`;
}

function readTurnover(raw: unknown): Turnover {
  const row = record(raw);
  if (!row) return { monthly: "", yearly: "", footnote: "" };
  return {
    monthly: rateLabel(pick(row, ["monthly"])),
    yearly: rateLabel(pick(row, ["yearly"])),
    footnote: text(pick(row, ["footnote"])),
  };
}

function emptyComparison(): TurnoverComparison {
  return { months: [], annualPct: 0, monthlyAvgPct: 0, departuresCount: 0, peakMonth: "" };
}

function readComparison(raw: unknown): TurnoverComparison {
  const row = record(raw);
  const nested = record(row?.comparison) ?? row;
  if (!nested) return emptyComparison();
  const months: TurnoverMonthRow[] = [];
  for (const item of list(nested.months)) {
    const month = record(item);
    if (!month) continue;
    const yearMonth = text(pick(month, ["yearMonth", "year_month"]));
    if (!yearMonth) continue;
    months.push({
      yearMonth,
      label: text(pick(month, ["label"])) || yearMonth,
      avgActive: num(pick(month, ["avgActive", "avg_active"])),
      departures: num(pick(month, ["departures"])),
      rate: num(pick(month, ["rate"])),
    });
  }
  return {
    months,
    annualPct: num(pick(nested, ["annualPct", "annual_pct"])),
    monthlyAvgPct: num(pick(nested, ["monthlyAvgPct", "monthly_avg_pct"])),
    departuresCount: num(pick(nested, ["departuresCount", "departures_count"])),
    peakMonth: text(pick(nested, ["peakMonth", "peak_month"])),
  };
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

function plainRows(raw: unknown): PlainRow[] {
  return list(raw).map(record).filter((row): row is PlainRow => row != null);
}

export function normalizeClientPortal(raw: unknown): ClientPortalDashboard {
  const row = record(raw) ?? {};
  const exported = record(row.exports) ?? {};
  const todayBar = readToday(pick(row, ["todayBar", "today_bar", "statusBar", "status_bar"]));
  const kpis = readKpis(pick(row, ["kpis"]), num(pick(row, ["assignedToYou", "assigned_to_you"])));
  return {
    todayBar,
    assignedToYou: kpis.assigned,
    kpis,
    riderStatus: readRiderStatus(pick(row, ["riderStatus", "rider_status"]), kpis.assigned),
    leaveMonths: readMonths(pick(row, ["leaveMonths", "leave_months"])),
    turnover: readTurnover(pick(row, ["turnover"])),
    turnoverComparison: readComparison(pick(row, ["turnover"])),
    leavePlans: list(pick(row, ["leavePlans", "leave_plans"]))
      .map(readLeavePlan)
      .filter((item): item is LeavePlanRow => item != null),
    onLeaveNow: list(pick(row, ["onLeaveNow", "on_leave_now"]))
      .map(readLeavePlan)
      .filter((item): item is LeavePlanRow => item != null),
    zones: readZones(pick(row, ["zones"])),
    exportRiders: plainRows(pick(row, ["exportRiders", "export_riders"]) ?? exported.riders),
    exportLeaveMonth: plainRows(pick(row, ["exportLeaveMonth", "export_leave_month"]) ?? exported.leaveMonth),
    exportTurnover: plainRows(pick(row, ["exportTurnover", "export_turnover"]) ?? exported.turnover),
  };
}

export function riderExportRows(rows: readonly PlainRow[]): string[][] {
  return rows.map((row) => [
    cell(row, ["employee_id", "employeeId", "Employee ID"]),
    cell(row, ["name", "full_name", "fullName", "Name"]),
    cell(row, ["status", "Status"]),
    cell(row, ["zone", "zone_name", "zoneName", "Zone"]),
  ]);
}

export function turnoverExportRows(rows: readonly PlainRow[]): string[][] {
  return rows.map((row) => [
    cell(row, ["Month", "month", "label"]),
    cell(row, ["Avg riders", "avgActive", "avg_active"]),
    cell(row, ["Riders who left", "departures"]),
    cell(row, ["Turnover %", "rate"]),
  ]);
}
