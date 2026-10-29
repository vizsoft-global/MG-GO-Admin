import { formatPct } from "@/lib/format/percent";
import {
  combinedEfficiencyPct,
  combinedRequiredHours,
  companyDayHours,
  dayDisplayHours,
  PAYROLL_DAY_HOURS,
} from "./payroll-formulas";
import { cellParticular } from "./payroll-particulars";
import { payrollVehicleKind, resolveRiderStatus } from "./payroll-rider-columns";
import type { PayrollRiderRow } from "./payroll-types";

/**
 * Combined Payroll column catalogue (SOP v1.0 items 6, 9, 10, 11).
 *
 * The pinned identity trio is not part of the catalogue: MG ID, Driver ID and
 * Name are frozen on the start edge, so the operator cannot lose sight of who a
 * row belongs to while scrolling the 31 day columns.
 */
export const COMBINED_IDENTITY_TRIPLE = ["amId", "mgId", "name"] as const;

/** The day block. One id, so the 31 day columns move and hide as a group. */
export const COMBINED_DAYS_COLUMN_ID = "days";

export type CombinedValueContext = {
  /** Every date in the selected period, in order. */
  dates: readonly string[];
  /** Kuwait date the page calls today; days after it print an en dash. */
  today?: string | null;
};

export type CombinedColumn = {
  id: string;
  /** Key under `pages.payroll.combinedCols`. */
  labelKey: string;
  numeric: boolean;
  /** Filter and sort basis. The printer only changes what is displayed. */
  value: (row: PayrollRiderRow, ctx: CombinedValueContext) => string | number | null;
};

function requiredHours(row: PayrollRiderRow, ctx: CombinedValueContext): number {
  return combinedRequiredHours(
    row,
    ctx.dates,
    ctx.today,
    companyDayHours(row.projectKey, row.partner),
  );
}

function efficiency(row: PayrollRiderRow, ctx: CombinedValueContext): number {
  const required = requiredHours(row, ctx);
  if (required <= 0) {
    // No countable day has happened yet: answer from the month's own figures so
    // a closed month still reports the same efficiency the Payroll tab does.
    return combinedEfficiencyPct(row.actualHours, row.requiredHours || PAYROLL_DAY_HOURS);
  }
  return combinedEfficiencyPct(row.actualHours, required);
}

export const COMBINED_COLUMNS: readonly CombinedColumn[] = [
  { id: "rest", labelKey: "restaurant", numeric: false, value: (row) => row.restaurant },
  { id: "zone", labelKey: "zone", numeric: false, value: (row) => row.zone },
  { id: "zcat", labelKey: "zoneCategory", numeric: false, value: (row) => row.zoneCategory },
  { id: "proj", labelKey: "projectName", numeric: false, value: (row) => row.partner },
  {
    id: "veh",
    labelKey: "vehicle",
    numeric: false,
    value: (row) => payrollVehicleKind(row.vehicleKey),
  },
  {
    id: "status",
    labelKey: "status",
    numeric: false,
    value: (row, ctx) => resolveRiderStatus(row, ctx.today).label,
  },
  { id: "wd", labelKey: "workingDays", numeric: true, value: (row) => row.workDays },
  { id: "tot", labelKey: "totalHours", numeric: true, value: (row) => row.totalHours },
  { id: "ord", labelKey: "totalOrders", numeric: true, value: (row) => row.finalOrders },
  { id: "req", labelKey: "requiredHours", numeric: true, value: requiredHours },
  { id: "act", labelKey: "actualHours", numeric: true, value: (row) => row.actualHours },
  { id: "eff", labelKey: "efficiency", numeric: true, value: efficiency },
  { id: "h3", labelKey: "threeHourDays", numeric: true, value: (row) => row.reducedDays },
  { id: "hd", labelKey: "sixHourDays", numeric: true, value: (row) => row.halfDays },
  { id: "ad", labelKey: "actualDays", numeric: true, value: (row) => row.actualDays },
  { id: "o", labelKey: "off", numeric: true, value: (row) => row.offDays },
  { id: "sk", labelKey: "sick", numeric: true, value: (row) => row.sickDays },
  { id: "ac", labelKey: "accident", numeric: true, value: (row) => row.accidentDays },
  { id: "aj", labelKey: "adjusted", numeric: true, value: (row) => row.adjustedCells },
  { id: "ua", labelKey: "unexcused", numeric: true, value: (row) => row.absentDays },
  { id: "lh", labelKey: "lessHours", numeric: true, value: (row) => row.absLhDays },
  { id: "lo", labelKey: "lessOrders", numeric: true, value: (row) => row.absLoDays },
];

/** SOP order. `days` sits straight after Status, as the client sheet does. */
export const COMBINED_COLUMN_ORDER: readonly string[] = [
  "rest",
  "zone",
  "zcat",
  "proj",
  "veh",
  "status",
  COMBINED_DAYS_COLUMN_ID,
  "wd",
  "tot",
  "ord",
  "req",
  "act",
  "eff",
  "h3",
  "hd",
  "ad",
  "o",
  "sk",
  "ac",
  "aj",
  "ua",
  "lh",
  "lo",
];

const COLUMN_BY_ID = new Map(COMBINED_COLUMNS.map((column) => [column.id, column]));

export function combinedColumn(id: string): CombinedColumn | undefined {
  return COLUMN_BY_ID.get(id);
}

export function isCombinedColumnId(id: string): boolean {
  return COLUMN_BY_ID.has(id);
}

/** Numeric column ids, for the filter engine's Range mode. */
export const COMBINED_NUMERIC_IDS: ReadonlySet<string> = new Set(
  COMBINED_COLUMNS.filter((column) => column.numeric).map((column) => column.id),
);

/** Filter id of one day column. `d1` is the first day of the period. */
export function dayValueColumnId(dayIndex: number): string {
  return `d${dayIndex + 1}`;
}

/** One row's filter/sort numbers, keyed by column id plus the day columns. */
export function combinedRowValues(
  row: PayrollRiderRow,
  ctx: CombinedValueContext,
): Record<string, string | number | null> {
  const values: Record<string, string | number | null> = {};
  for (const column of COMBINED_COLUMNS) values[column.id] = column.value(row, ctx);
  for (let index = 0; index < ctx.dates.length; index += 1) {
    values[dayValueColumnId(index)] = cellParticular(row, index);
  }
  return values;
}

/** What one day cell prints: the credited hours, the status word, or an en dash. */
export function combinedDayCellText(
  row: PayrollRiderRow,
  dayIndex: number,
  ctx: CombinedValueContext,
): string {
  const date = ctx.dates[dayIndex];
  if (ctx.today && date && date > ctx.today) return "–";
  const status = row.days[dayIndex] ?? "blank";
  if (status === "blank") return "";
  const info = row.dayInfo[dayIndex];
  if (status === "work") {
    const hours =
      info?.creditedHours && info.creditedHours > 0 ? info.creditedHours : PAYROLL_DAY_HOURS;
    return dayDisplayHours(status, { creditedHours: hours }).toFixed(1);
  }
  if (status === "actual" || status === "custom") {
    const hours = dayDisplayHours(status, info);
    return hours > 0 ? hours.toFixed(1) : "";
  }
  return cellParticular(row, dayIndex);
}

const DECIMAL_1 = new Set(["req", "tot"]);
const DECIMAL_2 = new Set(["act"]);

/**
 * The string a column's funnel matches in Text mode. Efficiency prints `87.1%`,
 * so Text has to match that rather than the stored float (SOP §10); List and
 * Range keep using the exact number.
 */
export function combinedFilterText(columnId: string, value: string | number | null): string {
  if (columnId !== "eff") return String(value ?? "");
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? formatPct(numeric) : String(value ?? "");
}

/** What a summary cell prints. Efficiency is a percentage, always one decimal. */
export function formatCombinedValue(columnId: string, value: string | number | null): string {
  if (value == null || value === "") return "—";
  if (typeof value !== "number") return String(value);
  if (columnId === "eff") return formatPct(value);
  if (DECIMAL_1.has(columnId)) return value.toFixed(1);
  if (DECIMAL_2.has(columnId)) return value.toFixed(2);
  return String(value);
}

/**
 * The label a column funnel shows in List mode. The range and the sort still use
 * the exact number, so `74.0%` in the list never becomes text in the sort.
 */
export function combinedColumnListLabel(
  columnId: string,
): ((value: string) => string) | undefined {
  if (columnId !== "eff") return undefined;
  return (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? formatPct(parsed) : value;
  };
}

/**
 * Order and visibility, normalised against the catalogue so a saved preference
 * from an older build cannot hide a new column or revive a removed one.
 */
export function normalizeCombinedColumns(
  order: readonly string[] | undefined,
  visible: readonly string[] | undefined,
): { order: string[]; visible: Set<string> } {
  const known = new Set(COMBINED_COLUMN_ORDER);
  const nextOrder = (order ?? []).filter((id) => known.has(id));
  for (const id of COMBINED_COLUMN_ORDER) {
    if (!nextOrder.includes(id)) nextOrder.push(id);
  }
  const visibleSet = new Set((visible ?? []).filter((id) => known.has(id)));
  if (visibleSet.size === 0) for (const id of COMBINED_COLUMN_ORDER) visibleSet.add(id);
  return { order: nextOrder, visible: visibleSet };
}
