import type { PayrollRiderRow } from "./payroll-types";

/**
 * Attendance & Orders, split by project.
 *
 * The client's SOP (v1.0) makes the **project** the unit of this tab: its own
 * riders, its own day columns, its own payroll and its own report. Two things
 * differ from the rest of Payroll and they are both decisions, not styling:
 *
 * - **Keeta and Five Guys price a day on hours Operations loads**, not on the
 *   clock in `attendance_logs`. A rider's app session and the hours a client
 *   pays for are different facts, and only the uploaded figure is the one the
 *   client approved.
 * - **Five Guys has no day status at all** — one hours column per day, so the
 *   status chips and the payroll pill would be inventing a state the project
 *   has no concept of.
 *
 * Americana deliberately keeps everything it has today, including order cells
 * the operator may correct by hand and the full lead-column set.
 */
export const PAYROLL_PROJECT_VIEWS = ["americana", "keeta", "five_guys"] as const;

export type PayrollProjectView = (typeof PAYROLL_PROJECT_VIEWS)[number];

/** A day cell's pair: which figures the project carries for one date. */
export type ProjectDayColumn = "payroll" | "orders" | "workingHours" | "hours";

export type PayrollProjectConfig = {
  key: PayrollProjectView;
  /** i18n key under `pages.payroll.projects.*` for the card title. */
  labelKey: string;
  /** The line printed under the card title. */
  subtitleKey: string;
  dayColumns: readonly ProjectDayColumn[];
  /** Hours come from the daily upload instead of `attendance_logs`. */
  usesUploadedHours: boolean;
  /** Keeta riders work from the pool: no restaurant column. */
  showRestaurant: boolean;
  /** False for Five Guys — the project has no day status. */
  showDayStatus: boolean;
  /** Whether the hours cell opens the reason dialog on screen. */
  hoursEditable: boolean;
  /** File-name stem: `MGHub-Payroll-Keeta-Nov-2026`. */
  exportName: string;
};

const CONFIG: Record<PayrollProjectView, PayrollProjectConfig> = {
  americana: {
    key: "americana",
    labelKey: "americana",
    subtitleKey: "americanaSubtitle",
    dayColumns: ["payroll", "orders"],
    usesUploadedHours: false,
    showRestaurant: true,
    showDayStatus: true,
    hoursEditable: false,
    exportName: "Americana",
  },
  keeta: {
    key: "keeta",
    labelKey: "keeta",
    subtitleKey: "keetaSubtitle",
    dayColumns: ["payroll", "workingHours"],
    usesUploadedHours: true,
    showRestaurant: false,
    showDayStatus: true,
    hoursEditable: false,
    exportName: "Keeta",
  },
  five_guys: {
    key: "five_guys",
    labelKey: "fiveGuys",
    subtitleKey: "fiveGuysSubtitle",
    dayColumns: ["hours"],
    usesUploadedHours: true,
    showRestaurant: true,
    showDayStatus: false,
    hoursEditable: true,
    exportName: "FiveGuys",
  },
};

export function projectConfigOf(view: PayrollProjectView): PayrollProjectConfig {
  return CONFIG[view];
}

/** The view a stored `drivers.project_key` belongs to, or null for an unset one. */
export function viewOfProjectKey(projectKey: string | null | undefined): PayrollProjectView | null {
  const key = (projectKey ?? "").trim().toLowerCase();
  if (key === "americana") return "americana";
  if (key === "keeta") return "keeta";
  if (key === "five_guys" || key === "five guys" || key === "fiveguys") return "five_guys";
  return null;
}

/**
 * A rider belongs to exactly one card, and an unset project is **not** guessed
 * into one: a rider with no project would otherwise be priced under Americana
 * rules, which is the one outcome that produces a wrong payslip silently.
 */
export function ridersForProject(
  riders: readonly PayrollRiderRow[],
  view: PayrollProjectView,
): PayrollRiderRow[] {
  return riders.filter((row) => viewOfProjectKey(row.projectKey) === view);
}

export function projectCounts(
  riders: readonly PayrollRiderRow[],
): Record<PayrollProjectView, number> {
  const counts: Record<PayrollProjectView, number> = { americana: 0, keeta: 0, five_guys: 0 };
  for (const row of riders) {
    const view = viewOfProjectKey(row.projectKey);
    if (view) counts[view] += 1;
  }
  return counts;
}

/** Riders whose project is blank: counted so the tab can say so instead of hiding them. */
export function unassignedProjectCount(riders: readonly PayrollRiderRow[]): number {
  return riders.filter((row) => viewOfProjectKey(row.projectKey) === null).length;
}

/**
 * The hours a day is **judged** on.
 *
 * For a project that loads hours, the uploaded figure wins and the app session is
 * only a fallback while nothing has been loaded — a day with no upload has no
 * billable length, and inventing one from the app would price a shift the client
 * never acknowledged. For Americana the attendance clock stays the source, which
 * is what keeps that project unchanged.
 */
export function hoursForRules(
  view: PayrollProjectView,
  attendanceHours: number,
  uploadedHours: number | null | undefined,
): number {
  if (!projectConfigOf(view).usesUploadedHours) return attendanceHours;
  return uploadedHours == null ? 0 : uploadedHours;
}

/** The number the day cell prints, or null when the project has not loaded one. */
export function shownHours(
  info: { workingHours?: number | null } | null | undefined,
): number | null {
  const value = info?.workingHours;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export type ProjectRowTotals = {
  workedDays: number;
  totalHours: number;
  totalOrders: number;
};

/**
 * Row totals, project-aware.
 *
 * A Keeta / Five Guys worked day is a day with **hours on it** (an uploaded
 * figure above zero), not a day the rules credited: a Payroll pill of `OFF` with
 * six uploaded hours is still six hours worked, and the client's report counts it.
 *
 * Americana reads the figures the snapshot already summed (`workDays` +
 * `reducedDays`, `actualHours`, `finalOrders`) rather than re-deriving them, so
 * the AO row cannot disagree with the Payroll tab's totals for the same rider.
 */
export function projectRowTotals(
  view: PayrollProjectView,
  row: Pick<
    PayrollRiderRow,
    "dayInfo" | "workDays" | "reducedDays" | "actualHours" | "finalOrders"
  >,
): ProjectRowTotals {
  if (!projectConfigOf(view).usesUploadedHours) {
    return {
      workedDays: row.workDays + row.reducedDays,
      totalHours: row.actualHours,
      totalOrders: row.finalOrders,
    };
  }
  let workedDays = 0;
  let totalHours = 0;
  for (const day of row.dayInfo) {
    const hours = shownHours(day);
    if (hours == null) continue;
    totalHours += hours;
    if (hours > 0) workedDays += 1;
  }
  return { workedDays, totalHours: Math.round(totalHours * 100) / 100, totalOrders: 0 };
}

export type ProjectKpis = {
  riders: number;
  activeRiders: number;
  totalOrders: number;
  totalHours: number;
  avgPerWorkedDay: number;
};

/**
 * The four cards. `activeRiders` is the same rule the other payroll KPIs use —
 * an account Status of Active — so the two cannot disagree about who counts.
 */
export function projectKpis(
  view: PayrollProjectView,
  rows: readonly PayrollRiderRow[],
): ProjectKpis {
  let totalOrders = 0;
  let totalHours = 0;
  let workedDays = 0;
  let activeRiders = 0;
  for (const row of rows) {
    if (row.status === "Active") activeRiders += 1;
    const totals = projectRowTotals(view, row);
    totalOrders += totals.totalOrders;
    totalHours += totals.totalHours;
    workedDays += totals.workedDays;
  }
  const rounded = Math.round(totalHours * 100) / 100;
  return {
    riders: rows.length,
    activeRiders,
    totalOrders,
    totalHours: rounded,
    avgPerWorkedDay: workedDays > 0 ? Math.round((totalHours / workedDays) * 10) / 10 : 0,
  };
}

/** `MGHub-Payroll-Keeta-Nov-2026` — the name the SOP asks the export to carry. */
export function projectExportName(view: PayrollProjectView, monthKey: string): string {
  const config = projectConfigOf(view);
  const [yearText, monthText] = monthKey.split("-");
  const index = Number(monthText) - 1;
  const label = MONTH_LABEL[index] ?? monthText ?? "";
  return `MGHub-Payroll-${config.exportName}-${label}-${yearText}`;
}

const MONTH_LABEL = [
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
 * The day column's header word, keyed for i18n.
 *
 * `Payroll` prints the credited payroll day in every project that has one; the
 * second column is whatever that project loads.
 */
export function dayColumnLabelKey(column: ProjectDayColumn): string {
  switch (column) {
    case "payroll":
      return "ao.payrollShort";
    case "orders":
      return "ao.ordersShort";
    case "workingHours":
      return "ao.workingHoursShort";
    case "hours":
      return "ao.hoursShort";
    default: {
      const never: never = column;
      return never;
    }
  }
}
