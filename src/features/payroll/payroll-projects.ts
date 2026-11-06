import {
  DEFAULT_PAYROLL_CLIENTS,
  normalizePayrollClientKey,
  payrollClientExportName,
  type PayrollClientRow,
} from "./payroll-clients";
import type { PayrollRiderRow } from "./payroll-types";

/**
 * Attendance & Orders, split by client.
 *
 * The client's SOP (v1.0) makes the **client** the unit of this tab: its own
 * riders, its own day columns, its own payroll and its own report. The three
 * clients the SOP names keep the shape it approved:
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
 * the operator may correct by hand and the full lead-column set. A client added
 * in Employee Settings gets that same profile, with `uses_hours` deciding
 * whether its day block carries payroll + orders or payroll + hours.
 */
export const PAYROLL_PROJECT_VIEWS = ["americana", "keeta", "five_guys"] as const;

export type BuiltinPayrollProjectView = (typeof PAYROLL_PROJECT_VIEWS)[number];

/** A client key. Deliberately open: the catalog is the list, not this type. */
export type PayrollProjectView = string;

/** The catalog shape the cards, the tab and the export need. */
export type PayrollProjectClient = {
  key: string;
  name: string;
  usesHours?: boolean | null;
  isActive?: boolean | null;
  sortOrder?: number | null;
};

/** A day cell's pair: which figures the client carries for one date. */
export type ProjectDayColumn = "payroll" | "orders" | "workingHours" | "hours";

export type PayrollProjectConfig = {
  key: PayrollProjectView;
  /** The catalog name, when the client has one. Cards print this first. */
  label?: string;
  /** i18n key under `pages.payroll.projects.*` for a built-in card title. */
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

const BUILTIN_CONFIG: Record<BuiltinPayrollProjectView, PayrollProjectConfig> = {
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

const BUILTIN_NAMES: Record<BuiltinPayrollProjectView, string> = {
  americana: "Americana",
  keeta: "Keeta",
  five_guys: "Five Guys",
};

export const DEFAULT_PROJECT_CLIENTS: readonly PayrollProjectClient[] = PAYROLL_PROJECT_VIEWS.map(
  (key) => ({
    key,
    name: BUILTIN_NAMES[key],
    usesHours: BUILTIN_CONFIG[key].usesUploadedHours,
    isActive: true,
    sortOrder: DEFAULT_PAYROLL_CLIENTS.find((row) => row.key === key)?.sortOrder ?? 100,
  }),
);

function isBuiltin(key: string): key is BuiltinPayrollProjectView {
  return (PAYROLL_PROJECT_VIEWS as readonly string[]).includes(key);
}

/**
 * The cards, in catalog order.
 *
 * An empty catalog (or a failed read) falls back to the three seeded clients, so
 * the tab can never render blank. An inactive client is absent on purpose: its
 * riders fall into the unassigned line instead of being priced under a client
 * nobody turned on.
 */
export function resolveProjectViews(
  clients: readonly PayrollProjectClient[] | null | undefined,
): PayrollProjectClient[] {
  const active = (clients ?? []).filter(
    (client) => client?.key && client.isActive !== false,
  );
  if (!active.length) return [...DEFAULT_PROJECT_CLIENTS];
  const seen = new Set<string>();
  const views: PayrollProjectClient[] = [];
  for (const client of active) {
    const key = normalizePayrollClientKey(client.key);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    views.push({
      key,
      name: client.name?.trim() || (isBuiltin(key) ? BUILTIN_NAMES[key] : key),
      usesHours:
        client.usesHours ?? (isBuiltin(key) ? BUILTIN_CONFIG[key].usesUploadedHours : false),
      isActive: true,
      sortOrder: client.sortOrder ?? 100,
    });
  }
  if (!views.length) return [...DEFAULT_PROJECT_CLIENTS];
  return views.sort((left, right) =>
    (left.sortOrder ?? 100) === (right.sortOrder ?? 100)
      ? left.key.localeCompare(right.key)
      : (left.sortOrder ?? 100) - (right.sortOrder ?? 100),
  );
}

/** Americana when it exists, otherwise the first card. */
export function defaultView(
  clients: readonly PayrollProjectClient[] | null | undefined,
): PayrollProjectView {
  const views = resolveProjectViews(clients);
  return views.some((view) => view.key === "americana") ? "americana" : views[0]!.key;
}

export function projectConfigOf(
  view: PayrollProjectView,
  clients?: readonly PayrollProjectClient[] | null,
): PayrollProjectConfig {
  const key = normalizePayrollClientKey(view) ?? view;
  const client = (clients ?? []).find((row) => row.key === key);
  if (isBuiltin(key)) {
    const config = BUILTIN_CONFIG[key];
    return client?.name ? { ...config, label: client.name } : config;
  }
  const label = client?.name?.trim() || key;
  const usesUploadedHours = client?.usesHours ?? false;
  return {
    key,
    label,
    labelKey: "custom",
    subtitleKey: "customSubtitle",
    dayColumns: usesUploadedHours ? ["payroll", "workingHours"] : ["payroll", "orders"],
    usesUploadedHours,
    showRestaurant: true,
    showDayStatus: true,
    hoursEditable: false,
    exportName: payrollClientExportName(key, label),
  };
}

/**
 * The card a stored `drivers.project_key` belongs to, or null for one no active
 * card holds. A key a retired client used to carry is null on purpose: the
 * rider is unassigned until someone picks a client again.
 */
export function viewOfProjectKey(
  projectKey: string | null | undefined,
  clients?: readonly PayrollProjectClient[] | null,
): PayrollProjectView | null {
  const normalized = normalizePayrollClientKey(projectKey);
  if (!normalized) return null;
  const views = clients
    ? resolveProjectViews(clients).map((client) => client.key)
    : [...PAYROLL_PROJECT_VIEWS];
  return views.includes(normalized) ? normalized : null;
}


/**
 * A rider belongs to exactly one card, and an unset project is **not** guessed
 * into one: a rider with no project would otherwise be priced under Americana
 * rules, which is the one outcome that produces a wrong payslip silently.
 */
export function ridersForProject(
  riders: readonly PayrollRiderRow[],
  view: PayrollProjectView,
  clients?: readonly PayrollProjectClient[] | null,
): PayrollRiderRow[] {
  return riders.filter((row) => viewOfProjectKey(row.projectKey, clients) === view);
}

export function projectCounts(
  riders: readonly PayrollRiderRow[],
  clients?: readonly PayrollProjectClient[] | null,
): Record<PayrollProjectView, number> {
  const counts: Record<PayrollProjectView, number> = {};
  for (const client of resolveProjectViews(clients)) counts[client.key] = 0;
  for (const row of riders) {
    const view = viewOfProjectKey(row.projectKey, clients);
    if (view) counts[view] = (counts[view] ?? 0) + 1;
  }
  return counts;
}

/** Riders whose project is blank: counted so the tab can say so instead of hiding them. */
export function unassignedProjectCount(
  riders: readonly PayrollRiderRow[],
  clients?: readonly PayrollProjectClient[] | null,
): number {
  return riders.filter((row) => viewOfProjectKey(row.projectKey, clients) === null).length;
}

/**
 * The hours a day is **judged** on.
 *
 * For a client that loads hours, the uploaded figure wins and the app session is
 * only a fallback while nothing has been loaded — a day with no upload has no
 * billable length, and inventing one from the app would price a shift the client
 * never acknowledged. For Americana the attendance clock stays the source, which
 * is what keeps that client unchanged.
 */
export function hoursForRules(
  view: PayrollProjectView,
  attendanceHours: number,
  uploadedHours: number | null | undefined,
  clients?: readonly PayrollProjectClient[] | null,
): number {
  if (!projectConfigOf(view, clients).usesUploadedHours) return attendanceHours;
  return uploadedHours == null ? 0 : uploadedHours;
}

/** The number the day cell prints, or null when the client has not loaded one. */
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
 * Row totals, client-aware.
 *
 * An hours client counts a day with **hours on it** (an uploaded figure above
 * zero), not a day the rules credited: a Payroll pill of `OFF` with six uploaded
 * hours is still six hours worked, and the client's report counts it.
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
  clients?: readonly PayrollProjectClient[] | null,
): ProjectRowTotals {
  if (!projectConfigOf(view, clients).usesUploadedHours) {
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
 * The four cards. `activeRiders` is the same rule the other payroll KPIs use — an
 * account Status of Active — so the two cannot disagree about who counts.
 */
export function projectKpis(
  view: PayrollProjectView,
  rows: readonly PayrollRiderRow[],
  clients?: readonly PayrollProjectClient[] | null,
): ProjectKpis {
  let totalOrders = 0;
  let totalHours = 0;
  let workedDays = 0;
  let activeRiders = 0;
  for (const row of rows) {
    if (row.status === "Active") activeRiders += 1;
    const totals = projectRowTotals(view, row, clients);
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
export function projectExportName(
  view: PayrollProjectView,
  monthKey: string,
  clients?: readonly PayrollProjectClient[] | null,
): string {
  const config = projectConfigOf(view, clients);
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

/** A catalog row as the card shape. Kept here so callers need one import. */
export function projectClientsFromCatalog(
  rows: readonly PayrollClientRow[] | null | undefined,
): PayrollProjectClient[] {
  return resolveProjectViews(
    (rows ?? []).map((row) => ({
      key: row.key,
      name: row.name,
      usesHours: row.usesHours,
      isActive: row.isActive,
      sortOrder: row.sortOrder,
    })),
  );
}

