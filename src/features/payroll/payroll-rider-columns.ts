"use client";

import { vehicleLabel } from "@/features/performance/performance-ops-format";
import { PAYROLL_DAY_HOURS, type DayStatus } from "./payroll-formulas";
import { cellParticular } from "./payroll-particulars";
import { ADJUSTMENT_STATUS_TO_DAY } from "./payroll-rules-engine";
import type { PayrollRiderRow } from "./payroll-types";

export type PayrollRiderColumn = {
  id: string;
  numeric: boolean;
  labelKey: string;
};

export const PAYROLL_SUMMARY_COLUMNS: readonly PayrollRiderColumn[] = [
  { id: "amId", numeric: false, labelKey: "amId" },
  { id: "mgId", numeric: false, labelKey: "mgId" },
  { id: "name", numeric: false, labelKey: "name" },
  { id: "restaurant", numeric: false, labelKey: "restaurant" },
  { id: "zone", numeric: false, labelKey: "zone" },
  { id: "zoneCategory", numeric: false, labelKey: "zoneCategory" },
  { id: "zoneOrders", numeric: true, labelKey: "zoneOrders" },
  { id: "zoneDpd", numeric: true, labelKey: "zoneDpd" },
  { id: "zoneEff", numeric: true, labelKey: "zoneEff" },
  { id: "partner", numeric: false, labelKey: "partner" },
  { id: "vehicleKind", numeric: false, labelKey: "vehicleKind" },
  { id: "status", numeric: false, labelKey: "status" },
  { id: "totalDays", numeric: true, labelKey: "totalDays" },
  { id: "finalOrders", numeric: true, labelKey: "finalOrders" },
  { id: "reduced3", numeric: true, labelKey: "reduced3" },
  { id: "half", numeric: true, labelKey: "half" },
  { id: "off", numeric: true, labelKey: "off" },
  { id: "sick", numeric: true, labelKey: "sick" },
  { id: "accident", numeric: true, labelKey: "accident" },
  { id: "vehicle", numeric: true, labelKey: "vehicle" },
  { id: "absence", numeric: true, labelKey: "absence" },
  { id: "absLh", numeric: true, labelKey: "absLh" },
  { id: "absLo", numeric: true, labelKey: "absLo" },
  { id: "offStructure", numeric: true, labelKey: "offStructure" },
  { id: "requiredHours", numeric: true, labelKey: "requiredHours" },
  { id: "actualHours", numeric: true, labelKey: "actualHours" },
  { id: "efficiency", numeric: true, labelKey: "efficiency" },
] as const;

export const COMBINED_IDENTITY_COLUMNS: readonly PayrollRiderColumn[] = [
  { id: "amId", numeric: false, labelKey: "amId" },
  { id: "mgId", numeric: false, labelKey: "mgId" },
  { id: "name", numeric: false, labelKey: "name" },
  { id: "zone", numeric: false, labelKey: "zone" },
  { id: "zoneCategory", numeric: false, labelKey: "zoneCategory" },
  { id: "partner", numeric: false, labelKey: "partner" },
  { id: "vehicleKind", numeric: false, labelKey: "vehicleKind" },
] as const;

export const AO_LEAD_COLUMNS: readonly PayrollRiderColumn[] = [
  { id: "amId", numeric: false, labelKey: "amId" },
  { id: "mgId", numeric: false, labelKey: "mgId" },
  { id: "name", numeric: false, labelKey: "name" },
  { id: "restaurant", numeric: false, labelKey: "restaurant" },
  { id: "restaurantId", numeric: false, labelKey: "restaurantId" },
  { id: "partner", numeric: false, labelKey: "partner" },
  { id: "zone", numeric: false, labelKey: "zone" },
  { id: "zoneCategory", numeric: false, labelKey: "zoneCategory" },
  { id: "vehicleKind", numeric: false, labelKey: "vehicleKind" },
  { id: "finalOrders", numeric: true, labelKey: "finalOrders" },
  { id: "actualHours", numeric: true, labelKey: "actualHours" },
] as const;

/** @deprecated Use COMBINED_IDENTITY_COLUMNS / PAYROLL_SUMMARY_COLUMNS. */
export const RIDER_IDENTITY_COLUMNS = COMBINED_IDENTITY_COLUMNS;
/** @deprecated Use PAYROLL_SUMMARY_COLUMNS. */
export const RIDER_TOTAL_COLUMNS = PAYROLL_SUMMARY_COLUMNS.filter((c) => c.numeric);

const NUMERIC_IDS = new Set<string>(
  [...PAYROLL_SUMMARY_COLUMNS, ...COMBINED_IDENTITY_COLUMNS, ...AO_LEAD_COLUMNS]
    .filter((c) => c.numeric)
    .map((c) => c.id),
);

export function isNumericRiderColumn(columnId: string): boolean {
  return NUMERIC_IDS.has(columnId);
}

export function payrollVehicleKind(key: string | null): string {
  if (!key) return "—";
  return vehicleLabel(key);
}

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
    case "restaurantId":
      return row.restaurantId;
    case "zone":
      return row.zone;
    case "zoneCategory":
      return row.zoneCategory;
    case "zoneOrders":
      return row.zoneOrders;
    case "zoneDpd":
      return row.zoneDpd;
    case "zoneEff":
      return row.zoneEfficiency;
    case "partner":
      return row.partner;
    case "vehicleKind":
      return payrollVehicleKind(row.vehicleKey);
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
      if (/^d\d+$/.test(columnId)) {
        const index = Number(columnId.slice(1)) - 1;
        const particular = cellParticular(row, index);
        return particular || null;
      }
      if (/^o\d+$/.test(columnId)) {
        const index = Number(columnId.slice(1)) - 1;
        const info = row.dayInfo[index];
        return info ? info.orders : null;
      }
      return null;
  }
}

export function dayOrdersColumnId(dayIndex: number): string {
  return `o${dayIndex + 1}`;
}

export function dayColumnValue(status: DayStatus): string {
  return status;
}

export function dayColumnId(dayIndex: number): string {
  return `d${dayIndex + 1}`;
}

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
