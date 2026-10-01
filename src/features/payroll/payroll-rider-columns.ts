"use client";

import { PAYROLL_DAY_HOURS, type DayStatus } from "./payroll-formulas";
import { ADJUSTMENT_STATUS_TO_DAY } from "./payroll-rules-engine";
import type { PayrollRiderRow } from "./payroll-types";

/**
 * One column list for every payroll grid.
 *
 * The Payroll summary, the Combined day grid and the read-only Attendance and
 * Orders tab must agree about which columns exist, what they are called, which
 * are numeric and what a row's value in each one is, or a column filter applied
 * on one tab would mean something different on the next. The same reason the
 * headers carry the filter popover from this list rather than each tab wiring
 * its own.
 */

export type PayrollRiderColumn = {
  id: string;
  /** Numeric columns get Range mode in the filter popover. */
  numeric: boolean;
  /** The i18n key under `pages.payroll.riderCols`. */
  labelKey: string;
};

export const RIDER_IDENTITY_COLUMNS: readonly PayrollRiderColumn[] = [
  { id: "amId", numeric: false, labelKey: "amId" },
  { id: "mgId", numeric: false, labelKey: "mgId" },
  { id: "name", numeric: false, labelKey: "name" },
  { id: "restaurant", numeric: false, labelKey: "restaurant" },
  { id: "zone", numeric: false, labelKey: "zone" },
  { id: "zoneCategory", numeric: false, labelKey: "zoneCategory" },
  { id: "partner", numeric: false, labelKey: "partner" },
  { id: "nationality", numeric: false, labelKey: "nationality" },
  { id: "status", numeric: false, labelKey: "status" },
] as const;

export const RIDER_TOTAL_COLUMNS: readonly PayrollRiderColumn[] = [
  { id: "totalDays", numeric: true, labelKey: "totalDays" },
  { id: "totalHours", numeric: true, labelKey: "totalHours" },
  { id: "off", numeric: true, labelKey: "off" },
  { id: "sick", numeric: true, labelKey: "sick" },
  { id: "accident", numeric: true, labelKey: "accident" },
  { id: "reduced3", numeric: true, labelKey: "reduced3" },
  { id: "half", numeric: true, labelKey: "half" },
  { id: "actual", numeric: true, labelKey: "actual" },
  { id: "vehicle", numeric: true, labelKey: "vehicle" },
  { id: "absLh", numeric: true, labelKey: "absLh" },
  { id: "absLo", numeric: true, labelKey: "absLo" },
  { id: "custom", numeric: true, labelKey: "custom" },
  { id: "absence", numeric: true, labelKey: "absence" },
  { id: "adjusted", numeric: true, labelKey: "adjusted" },
  { id: "offStructure", numeric: true, labelKey: "offStructure" },
  { id: "requiredHours", numeric: true, labelKey: "requiredHours" },
  { id: "actualHours", numeric: true, labelKey: "actualHours" },
  { id: "finalOrders", numeric: true, labelKey: "finalOrders" },
  { id: "efficiency", numeric: true, labelKey: "efficiency" },
] as const;

const NUMERIC_IDS = new Set<string>(
  [...RIDER_IDENTITY_COLUMNS, ...RIDER_TOTAL_COLUMNS]
    .filter((c) => c.numeric)
    .map((c) => c.id),
);

export function isNumericRiderColumn(columnId: string): boolean {
  return NUMERIC_IDS.has(columnId);
}

/** The value a column filter and a sort compare against. */
export function riderColumnValue(
  row: PayrollRiderRow,
  columnId: string,
): string | number | null {
  switch (columnId) {
    case "amId":
      return row.amId;
    case "mgId":
      return row.mgId;
    case "name":
      return row.name;
    case "restaurant":
      return row.restaurant;
    case "zone":
      return row.zone;
    case "zoneCategory":
      return row.zoneCategory;
    case "partner":
      return row.partner;
    case "nationality":
      return row.nationality;
    case "status":
      return row.status;
    case "totalDays":
      return row.workDays;
    case "totalHours":
      return row.totalHours;
    case "off":
      return row.offDays;
    case "sick":
      return row.sickDays;
    case "accident":
      return row.accidentDays;
    case "reduced3":
      return row.reducedDays;
    case "half":
      return row.halfDays;
    case "actual":
      return row.actualDays;
    case "vehicle":
      return row.vehicleDays;
    case "absLh":
      return row.absLhDays;
    case "absLo":
      return row.absLoDays;
    case "custom":
      return row.customDays;
    case "absence":
      return row.absentDays;
    case "adjusted":
      return row.adjustedCells;
    case "offStructure":
      return row.offStructureDays;
    case "requiredHours":
      return row.requiredHours;
    case "actualHours":
      return row.actualHours;
    case "finalOrders":
      return row.finalOrders;
    case "efficiency":
      return row.efficiency;
    default:
      // A day column: `d1`…`d31` reads that day's status token, and `o1`…`o31`
      // the day's final adjusted orders. The Attendance and Orders tab shows
      // both side by side, so both must be filterable.
      if (/^d\d+$/.test(columnId)) {
        const index = Number(columnId.slice(1)) - 1;
        const status = row.days[index];
        return status && status !== "blank" ? dayColumnValue(status) : null;
      }
      if (/^o\d+$/.test(columnId)) {
        const index = Number(columnId.slice(1)) - 1;
        const info = row.dayInfo[index];
        return info ? info.orders : null;
      }
      return null;
  }
}

/** The orders sub-column beside `d{n}` on the attendance-and-orders grid. */
export function dayOrdersColumnId(dayIndex: number): string {
  return `o${dayIndex + 1}`;
}

/** The status token a day column filters on, kept identical to the grid's label. */
export function dayColumnValue(status: DayStatus): string {
  return status;
}

export function dayColumnId(dayIndex: number): string {
  return `d${dayIndex + 1}`;
}

/**
 * The text an operator copies out of a cell, and what `parseAdjustmentCellText`
 * accepts back. Excel text rather than the UI label, because the SOP is operated
 * from a spreadsheet and `12` / `3h` / `OFF` is what the team types.
 */
export function dayClipboardToken(row: PayrollRiderRow, dayIndex: number): string {
  const status = row.days[dayIndex];
  if (!status || status === "blank") return "";
  switch (status) {
    case "work":
      return String(PAYROLL_DAY_HOURS);
    case "reduced3":
      return "3h";
    case "half":
      return "half";
    case "actual":
      return "act";
    case "off":
      return "OFF";
    case "sick":
      return "sick";
    case "accident":
      return "accident";
    case "vehicle":
      return "vehicle";
    case "absent":
      return "abs";
    case "abs_lh":
      return "alh";
    case "abs_lo":
      return "alo";
    case "custom": {
      const hours = row.dayInfo[dayIndex]?.creditedHours;
      return hours == null ? "cus" : `${hours}h`;
    }
    default:
      return "";
  }
}

/** The credited hours a day status stands for, for the tooltip. */
export function dayCreditedHours(row: PayrollRiderRow, dayIndex: number): number | null {
  const info = row.dayInfo[dayIndex];
  if (!info) return null;
  return info.creditedHours;
}

export function isAdjustedCell(row: PayrollRiderRow, dayIndex: number): boolean {
  return Boolean(row.dayInfo[dayIndex]?.adjusted);
}

export function statusFromAdjustment(status: keyof typeof ADJUSTMENT_STATUS_TO_DAY): DayStatus {
  return ADJUSTMENT_STATUS_TO_DAY[status];
}
