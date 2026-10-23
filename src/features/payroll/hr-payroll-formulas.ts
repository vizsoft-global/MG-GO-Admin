import { countryLabel } from "@/lib/geo/countries";
import type { PayrollRiderRow } from "./payroll-types";
import { HR_COLUMNS, HR_FOOTER_KEYS, HR_OPS_KEYS } from "./hr-payroll-columns";
import { isHrActive } from "./hr-payroll-status";
import type {
  HrBundle,
  HrBundleRow,
  HrColumnFilter,
  HrEditState,
  HrPayrollNumbers,
  HrPayrollRow,
  HrSummaryBy,
  HrSummaryLine,
} from "./hr-payroll-types";

export const HR_AWAITING = "\u0000awaiting";
const DASH = "—";

export type HrComputeInput = {
  approved: boolean;
  monthDays: number;
  offs: number;
  requiredHoursPerDay: number;
  orders: number;
  workingDays: number;
  actualHours: number;
  restaurantDpd: number;
  fixedSalary: number;
  workPermitSalary: number;
  twoYear: number;
  fourYear: number;
  food: number;
  sick: number;
  incentives: number;
  pending: number;
  traffic: number;
  loan: number;
  allowances: number;
  deductions: number;
};

export type HrComputeResult = {
  fWorkingDays: number;
  fWorkingHours: number;
  hourlyRate: number;
  riderDpd: number;
  efficiency: number;
  salaryAsPerHours: number;
  twoYearAmount: number;
  fourYearAmount: number;
  sickReimbursement: number;
  incentivesPaid: number;
  totalSalary: number;
  payment: number;
};

export function computeHrPayroll(input: HrComputeInput): HrComputeResult {
  const fwd = input.monthDays - input.offs;
  const fwh = fwd * input.requiredHoursPerDay;
  const ok = input.approved;
  const hourly = ok && fwh ? input.fixedSalary / fwh : 0;
  const riderDpd = input.workingDays ? input.orders / input.workingDays : 0;
  const efficiency = ok && input.restaurantDpd ? riderDpd / input.restaurantDpd : 0;
  const salH = hourly * (ok ? input.actualHours : 0);
  const inc2v = ok && fwd ? (input.twoYear / fwd) * input.workingDays : 0;
  const inc4v = ok && fwd ? (input.fourYear / fwd) * input.workingDays : 0;
  const sickR = (input.workPermitSalary / 26) * input.sick;
  const incentivesPaid = ok ? input.incentives : 0;
  const total =
    salH +
    inc2v +
    inc4v +
    incentivesPaid +
    input.food +
    sickR +
    input.pending +
    input.allowances -
    input.traffic -
    input.loan -
    input.deductions;
  return {
    fWorkingDays: fwd,
    fWorkingHours: fwh,
    hourlyRate: hourly,
    riderDpd,
    efficiency,
    salaryAsPerHours: salH,
    twoYearAmount: inc2v,
    fourYearAmount: inc4v,
    sickReimbursement: Number.isFinite(sickR) ? sickR : 0,
    incentivesPaid,
    totalSalary: total,
    payment: total,
  };
}

export function formatHrEfficiency(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

function money(n: number): string {
  return Number.isFinite(n) ? n.toFixed(3) : DASH;
}

function dec2(n: number): string {
  return Number.isFinite(n) ? n.toFixed(2) : DASH;
}

function plain(n: number): string {
  return Number.isFinite(n) ? String(n) : DASH;
}

function dash(value: string): string {
  const trimmed = value.trim();
  return trimmed ? trimmed : DASH;
}

function nationalityText(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === DASH) return DASH;
  if (/^[A-Za-z]{2}$/.test(trimmed)) return countryLabel(trimmed);
  return trimmed;
}

function projectLabel(key: string, clientName: string): string {
  if (key === "keeta") return "Keeta";
  if (key === "americana") return "Americana";
  if (clientName.trim()) return clientName.trim();
  if (key.trim()) return key.trim();
  return DASH;
}

function selectText(value: number, unit: string, keepZero: boolean): string {
  if (!keepZero && value === 0) return DASH;
  if (keepZero) return String(value);
  return `${value}${unit}`;
}

const EMPTY_EDIT: HrEditState = {
  twoYear: 0,
  fourYear: 0,
  food: 0,
  sick: 0,
  pending: 0,
  traffic: 0,
  loan: 0,
  allowances: 0,
  deductions: 0,
};

function editFromBundle(row: HrBundleRow | undefined, patch: Partial<HrEditState> | undefined): HrEditState {
  return {
    twoYear: patch?.twoYear ?? row?.twoYear ?? 0,
    fourYear: patch?.fourYear ?? row?.fourYear ?? 0,
    food: patch?.food ?? row?.food ?? 0,
    sick: patch?.sick ?? row?.sick ?? 0,
    pending: patch?.pending ?? row?.pending ?? 0,
    traffic: patch?.traffic ?? row?.traffic ?? 0,
    loan: patch?.loan ?? row?.loan ?? 0,
    allowances: patch?.allowances ?? row?.allowances ?? 0,
    deductions: patch?.deductions ?? row?.deductions ?? 0,
  };
}

function restaurantDpds(riders: readonly PayrollRiderRow[]): Map<string, number> {
  const orders = new Map<string, number>();
  const days = new Map<string, number>();
  for (const rider of riders) {
    const name = rider.restaurant.trim() || DASH;
    orders.set(name, (orders.get(name) ?? 0) + rider.finalOrders);
    days.set(name, (days.get(name) ?? 0) + rider.workDays);
  }
  const out = new Map<string, number>();
  for (const [name, totalOrders] of orders) {
    const totalDays = days.get(name) ?? 0;
    out.set(name, totalDays ? totalOrders / totalDays : 0);
  }
  return out;
}

/** Figures the Payroll tab already shows. They stay on this sheet before Operations approval. */
const PAYROLL_TAB_KEYS = new Set(["offs", "fwd", "fwh", "orders", "wd", "ah", "restDpd", "riderDpd"]);

function shownIdentity(value: string | null | undefined): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed || trimmed === "—" || trimmed === DASH) return "";
  return trimmed;
}

function opsText(approved: boolean, key: string, text: string): string {
  if (approved || PAYROLL_TAB_KEYS.has(key) || !HR_OPS_KEYS.has(key)) return text;
  return DASH;
}

export function buildHrPayrollRows(args: {
  riders: readonly PayrollRiderRow[];
  bundle: HrBundle | null;
  monthDays: number;
  edits?: Readonly<Record<string, Partial<HrEditState>>>;
  statusLabels?: Readonly<Record<string, string>>;
}): HrPayrollRow[] {
  const byId = new Map((args.bundle?.rows ?? []).map((row) => [row.driverId, row]));
  const approved = args.bundle?.opsApproved ?? false;
  const dpds = restaurantDpds(args.riders);
  return args.riders.map((rider) => {
    const identity = byId.get(rider.driverId);
    const edit = editFromBundle(identity, args.edits?.[rider.driverId]);
    const restaurant = rider.restaurant.trim() || DASH;
    const zone = rider.zone.trim() || DASH;
    const computed = computeHrPayroll({
      approved,
      monthDays: args.monthDays,
      offs: rider.offStructureDays,
      requiredHoursPerDay: rider.requiredHoursPerDay || 12,
      orders: rider.finalOrders,
      workingDays: rider.workDays,
      actualHours: rider.actualHours,
      restaurantDpd: dpds.get(restaurant) ?? 0,
      fixedSalary: identity?.fixedSalary ?? 0,
      workPermitSalary: identity?.workPermitSalary ?? 0,
      twoYear: edit.twoYear,
      fourYear: edit.fourYear,
      food: edit.food,
      sick: edit.sick,
      incentives: identity?.incentives ?? 0,
      pending: edit.pending,
      traffic: edit.traffic,
      loan: edit.loan,
      allowances: edit.allowances,
      deductions: edit.deductions,
    });
    const statusKey = identity?.statusKey ?? "";
    const statusLabel = args.statusLabels?.[statusKey] || identity?.statusLabel || statusKey;
    const clientId = shownIdentity(rider.restaurantClientId) || shownIdentity(identity?.clientId);
    const mgId = shownIdentity(rider.amId) || shownIdentity(identity?.employeeId);
    const name = shownIdentity(rider.name) || shownIdentity(identity?.fullName);
    const cells: Record<string, string> = {
      i: "",
      client: dash(clientId),
      mg: dash(mgId),
      name: dash(name),
      civil: dash(identity?.civilId ?? ""),
      bankNo: dash(identity?.bankNumber ?? ""),
      bank: dash(identity?.bankName ?? ""),
      cur: dash(identity?.currency || "KWD"),
      payment: money(computed.payment),
      clientName: projectLabel(identity?.projectKey || rider.projectKey || "", identity?.clientName ?? ""),
      zone,
      rest: restaurant,
      nationality: nationalityText(identity?.nationality || rider.nationality || ""),
      natCat: dash(identity?.nationalityCategory ?? ""),
      sponsor: dash(identity?.sponsor ?? ""),
      company: dash(identity?.company || rider.sourceCompany || ""),
      position: dash(identity?.position ?? ""),
      hiring: dash(identity?.hiringType ?? ""),
      start: dash(identity?.workStart ?? ""),
      endDate: dash(identity?.jobEnd ?? ""),
      endDesc: dash(identity?.jobEndDescription ?? ""),
      status: dash(statusLabel),
      section: dash(identity?.section ?? ""),
      fixed: money(identity?.fixedSalary ?? 0),
      wps: money(identity?.workPermitSalary ?? 0),
      inc2: selectText(edit.twoYear, " KWD", false),
      inc4: selectText(edit.fourYear, " KWD", false),
      offs: opsText(approved, "offs", plain(rider.offStructureDays)),
      fwd: opsText(approved, "fwd", plain(computed.fWorkingDays)),
      fwh: opsText(approved, "fwh", plain(computed.fWorkingHours)),
      hourly: opsText(approved, "hourly", money(computed.hourlyRate)),
      orders: opsText(approved, "orders", plain(rider.finalOrders)),
      wd: opsText(approved, "wd", plain(rider.workDays)),
      ah: opsText(approved, "ah", dec2(rider.actualHours)),
      restDpd: opsText(approved, "restDpd", dec2(dpds.get(restaurant) ?? 0)),
      riderDpd: opsText(approved, "riderDpd", dec2(computed.riderDpd)),
      eff: opsText(approved, "eff", formatHrEfficiency(computed.efficiency)),
      salH: opsText(approved, "salH", money(computed.salaryAsPerHours)),
      inc2v: opsText(approved, "inc2v", money(computed.twoYearAmount)),
      inc4v: opsText(approved, "inc4v", money(computed.fourYearAmount)),
      incent: opsText(approved, "incent", money(identity?.incentives ?? 0)),
      food: selectText(edit.food, " KWD", false),
      sick: selectText(edit.sick, "", true),
      sickR: money(computed.sickReimbursement),
      pending: money(edit.pending),
      traffic: money(edit.traffic),
      loan: money(edit.loan),
      allow: money(edit.allowances),
      ded: money(edit.deductions),
      total: money(computed.totalSalary),
    };
    const searchBlob = [name, mgId, identity?.civilId ?? "", zone, restaurant, clientId]
      .join(" ")
      .toLowerCase();
    const numbers: HrPayrollNumbers = {
      payment: computed.payment,
      totalSalary: computed.totalSalary,
      salaryAsPerHours: computed.salaryAsPerHours,
      pendingSalary: edit.pending,
      trafficViolation: edit.traffic,
      loanDeduction: edit.loan,
      totalAllowances: edit.allowances,
      totalDeductions: edit.deductions,
      sickReimbursement: computed.sickReimbursement,
      twoYearAmount: computed.twoYearAmount,
      fourYearAmount: computed.fourYearAmount,
      incentives: computed.incentivesPaid,
      foodAllowance: edit.food,
    };
    return {
      driverId: rider.driverId,
      approved,
      active: isHrActive(statusKey),
      statusKey,
      jobEndDescription: identity?.jobEndDescription ?? "",
      searchBlob,
      company: cells.company,
      project: cells.clientName,
      section: cells.section,
      sponsor: cells.sponsor,
      zone,
      cells,
      numbers,
      edit,
      identityEdit: {
        clientId,
        employeeId: mgId,
        fullName: name,
        restaurantName: restaurant === DASH ? "" : restaurant,
      },
    };
  });
}

export function filterHrRows(
  rows: readonly HrPayrollRow[],
  input: { search: string; statusKey: string; filters: readonly HrColumnFilter[] },
): HrPayrollRow[] {
  const needle = input.search.trim().toLowerCase();
  return rows.filter((row) => {
    if (needle && !row.searchBlob.includes(needle)) return false;
    if (input.statusKey && row.statusKey !== input.statusKey) return false;
    return input.filters.every((filter) => {
      if (!filter.value) return true;
      const text = row.cells[filter.key] ?? "";
      if (filter.mode === "exact") return text === filter.value;
      return text.toLowerCase().includes(filter.value.trim().toLowerCase());
    });
  });
}

export function hrColumnFilterMode(
  columnKey: string,
  rows: readonly HrPayrollRow[],
): "none" | "contains" | "exact" {
  const column = HR_COLUMNS.find((item) => item.key === columnKey);
  if (!column || column.filter === "none") return "none";
  if (column.filter === "contains") return "contains";
  if (column.filter === "exact") return "exact";
  const values = new Set(rows.map((row) => row.cells[columnKey] ?? ""));
  return values.size <= 30 ? "exact" : "contains";
}

export function distinctHrValues(rows: readonly HrPayrollRow[], key: string): string[] {
  return [...new Set(rows.map((row) => row.cells[key] ?? "").filter((value) => value && value !== HR_AWAITING))].sort(
    (a, b) => a.localeCompare(b),
  );
}

export function hrKpis(rows: readonly HrPayrollRow[]): { riders: number; active: number; payment: number } {
  return {
    riders: rows.length,
    active: rows.filter((row) => row.active).length,
    payment: rows.reduce((sum, row) => sum + row.numbers.payment, 0),
  };
}

export function hrFooterTotals(rows: readonly HrPayrollRow[]): Record<(typeof HR_FOOTER_KEYS)[number], number> {
  const totals = {
    payment: 0,
    total: 0,
    salH: 0,
    pending: 0,
    traffic: 0,
    loan: 0,
    allow: 0,
    ded: 0,
    sickR: 0,
    inc2v: 0,
    inc4v: 0,
    incent: 0,
    food: 0,
  };
  for (const row of rows) {
    totals.payment += row.numbers.payment;
    totals.total += row.numbers.totalSalary;
    totals.salH += row.numbers.salaryAsPerHours;
    totals.pending += row.numbers.pendingSalary;
    totals.traffic += row.numbers.trafficViolation;
    totals.loan += row.numbers.loanDeduction;
    totals.allow += row.numbers.totalAllowances;
    totals.ded += row.numbers.totalDeductions;
    totals.sickR += row.numbers.sickReimbursement;
    totals.inc2v += row.numbers.twoYearAmount;
    totals.inc4v += row.numbers.fourYearAmount;
    totals.incent += row.numbers.incentives;
    totals.food += row.numbers.foodAllowance;
  }
  return totals;
}

export function summarizeHr(rows: readonly HrPayrollRow[], by: HrSummaryBy): HrSummaryLine[] {
  const groups = new Map<string, HrSummaryLine>();
  for (const row of rows) {
    const label =
      by === "company"
        ? row.company
        : by === "sponsor"
          ? row.sponsor
          : by === "project"
            ? row.project
            : by === "zone"
              ? row.zone
              : row.section;
    const key = label || DASH;
    const line = groups.get(key) ?? {
      key,
      label: key,
      payment: 0,
      salaryAsPerHours: 0,
      incentives: 0,
      pendingSalary: 0,
      sickReimbursement: 0,
      trafficViolation: 0,
      loanDeduction: 0,
      totalAllowances: 0,
      totalDeductions: 0,
      riders: 0,
    };
    line.payment += row.numbers.payment;
    line.salaryAsPerHours += row.numbers.salaryAsPerHours;
    line.incentives += row.numbers.incentives;
    line.pendingSalary += row.numbers.pendingSalary;
    line.sickReimbursement += row.numbers.sickReimbursement;
    line.trafficViolation += row.numbers.trafficViolation;
    line.loanDeduction += row.numbers.loanDeduction;
    line.totalAllowances += row.numbers.totalAllowances;
    line.totalDeductions += row.numbers.totalDeductions;
    line.riders += 1;
    groups.set(key, line);
  }
  return [...groups.values()];
}

export function emptyHrEdit(): HrEditState {
  return { ...EMPTY_EDIT };
}
