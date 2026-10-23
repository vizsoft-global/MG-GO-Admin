"use client";

import { vehicleLabel } from "@/features/performance/performance-ops-format";
import { kuwaitToday } from "@/features/performance/performance-formulas";
import { PAYROLL_DAY_HOURS, PAYROLL_STATUS_CHIP, type DayStatus } from "./payroll-formulas";
import { aoShownOrders } from "./payroll-orders-display";
import { cellParticular } from "./payroll-particulars";
import { ADJUSTMENT_STATUS_TO_DAY, type AdjustmentStatus } from "./payroll-rules-engine";
import {
  CORE_PAYROLL_STATUS_HEX,
  CORE_PAYROLL_STATUS_LABEL,
  CUSTOM_STATUS_HEX,
  isCorePayrollStatus,
  payrollGridStatusFromDay,
  payrollStatusChoiceFromLabel,
  type CorePayrollStatusKey,
} from "./payroll-status-options";
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
  { id: "restaurantId", numeric: false, labelKey: "restaurantId" },
  { id: "zone", numeric: false, labelKey: "zone" },
  { id: "zoneCategory", numeric: false, labelKey: "zoneCategory" },
  { id: "zoneOrders", numeric: true, labelKey: "zoneOrders" },
  { id: "zoneDpd", numeric: true, labelKey: "zoneDpd" },
  { id: "zoneEff", numeric: true, labelKey: "zoneEff" },
  { id: "partner", numeric: false, labelKey: "partner" },
  { id: "nationality", numeric: false, labelKey: "nationality" },
  { id: "vehicleKind", numeric: false, labelKey: "vehicleKind" },
  { id: "status", numeric: false, labelKey: "status" },
  { id: "totalDays", numeric: true, labelKey: "totalDays" },
  { id: "totalHours", numeric: true, labelKey: "totalHours" },
  { id: "finalOrders", numeric: true, labelKey: "finalOrders" },
  { id: "requiredHours", numeric: true, labelKey: "requiredHours" },
  { id: "actualHours", numeric: true, labelKey: "actualHours" },
  { id: "offStructure", numeric: true, labelKey: "offStructure" },
  { id: "efficiency", numeric: true, labelKey: "efficiency" },
  { id: "reduced3", numeric: true, labelKey: "reduced3" },
  { id: "half", numeric: true, labelKey: "half" },
  { id: "actual", numeric: true, labelKey: "actual" },
  { id: "off", numeric: true, labelKey: "off" },
  { id: "sick", numeric: true, labelKey: "sick" },
  { id: "accident", numeric: true, labelKey: "accident" },
  { id: "vehicle", numeric: true, labelKey: "vehicle" },
  { id: "custom", numeric: true, labelKey: "custom" },
  { id: "adjusted", numeric: true, labelKey: "adjusted" },
  { id: "absence", numeric: true, labelKey: "absence" },
  { id: "absLh", numeric: true, labelKey: "absLh" },
  { id: "absLo", numeric: true, labelKey: "absLo" },
] as const;

/**
 * Columns pinned to the start of the summary table. Their sticky offsets are
 * hard-coded in `stickyClass`, so they cannot be hidden or reordered.
 */
export const PAYROLL_SUMMARY_LOCKED_COLUMNS = ["amId", "mgId", "name"] as const;

export const COMBINED_IDENTITY_COLUMNS: readonly PayrollRiderColumn[] = [
  { id: "amId", numeric: false, labelKey: "amId" },
  { id: "mgId", numeric: false, labelKey: "mgId" },
  { id: "name", numeric: false, labelKey: "name" },
  { id: "restaurant", numeric: false, labelKey: "restaurant" },
  { id: "restaurantId", numeric: false, labelKey: "restaurantId" },
  { id: "zone", numeric: false, labelKey: "zone" },
  { id: "zoneCategory", numeric: false, labelKey: "zoneCategory" },
  { id: "partner", numeric: false, labelKey: "partner" },
  { id: "vehicleKind", numeric: false, labelKey: "vehicleKind" },
  { id: "status", numeric: false, labelKey: "status" },
  { id: "finalOrders", numeric: true, labelKey: "finalOrders" },
  { id: "actualHours", numeric: true, labelKey: "actualHours" },
] as const;

/**
 * Application Attendance leads: the same identity block the Attendance &
 * Orders grid shows, then the three app-usage totals computed from the day
 * grid. Kept separate from `COMBINED_IDENTITY_COLUMNS` so the Combined tab can
 * grow without silently adding app columns to a payroll table.
 */
export const APP_ATTENDANCE_LEAD_COLUMNS: readonly PayrollRiderColumn[] = [
  { id: "amId", numeric: false, labelKey: "amId" },
  { id: "mgId", numeric: false, labelKey: "mgId" },
  { id: "name", numeric: false, labelKey: "name" },
  { id: "restaurant", numeric: false, labelKey: "restaurant" },
  { id: "restaurantId", numeric: false, labelKey: "restaurantId" },
  { id: "partner", numeric: false, labelKey: "partner" },
  { id: "zone", numeric: false, labelKey: "zone" },
  { id: "zoneCategory", numeric: false, labelKey: "zoneCategory" },
  { id: "vehicleKind", numeric: false, labelKey: "vehicleKind" },
  { id: "status", numeric: false, labelKey: "status" },
  { id: "appTotalHours", numeric: true, labelKey: "appTotalHours" },
  { id: "appActiveDays", numeric: true, labelKey: "appActiveDays" },
  { id: "appAvgHours", numeric: true, labelKey: "appAvgHours" },
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
  { id: "status", numeric: false, labelKey: "status" },
  { id: "finalOrders", numeric: true, labelKey: "finalOrders" },
  { id: "actualHours", numeric: true, labelKey: "actualHours" },
] as const;

/** @deprecated Use COMBINED_IDENTITY_COLUMNS / PAYROLL_SUMMARY_COLUMNS. */
export const RIDER_IDENTITY_COLUMNS = COMBINED_IDENTITY_COLUMNS;
/** @deprecated Use PAYROLL_SUMMARY_COLUMNS. */
export const RIDER_TOTAL_COLUMNS = PAYROLL_SUMMARY_COLUMNS.filter((c) => c.numeric);

const NUMERIC_IDS = new Set<string>(
  [...PAYROLL_SUMMARY_COLUMNS, ...COMBINED_IDENTITY_COLUMNS, ...AO_LEAD_COLUMNS, ...APP_ATTENDANCE_LEAD_COLUMNS]
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

/**
 * Application hours for one day: the logged check-in → check-out length, or the
 * elapsed length of a shift that is still open. Deliberately independent of the
 * payroll engine's `creditedHours` — this tab answers "how long was the app in
 * use", not "how many hours are payable".
 */
export function appHoursForDay(row: PayrollRiderRow, dayIndex: number): number {
  const info = row.dayInfo[dayIndex];
  if (!info) return 0;
  return info.loggedHours || (info.elapsedHours ?? 0);
}

export function appAttendanceTotals(row: PayrollRiderRow): {
  totalHours: number;
  activeDays: number;
  avgHours: number;
} {
  let totalHours = 0;
  let activeDays = 0;
  for (let index = 0; index < row.dayInfo.length; index += 1) {
    const hours = appHoursForDay(row, index);
    if (hours <= 0) continue;
    totalHours += hours;
    activeDays += 1;
  }
  return {
    totalHours,
    activeDays,
    avgHours: activeDays > 0 ? totalHours / activeDays : 0,
  };
}

/**
 * What the Restaurant ID column/CSV prints. Operators quote the partner's own
 * merchant id ("105913"), not the Firestore document id, so that is what this
 * returns; the doc id stays on `restaurantId` because slicers match on it.
 */
export function restaurantDisplayId(row: PayrollRiderRow): string {
  return row.restaurantClientId || row.restaurantId || "";
}

/**
 * What the Rider Status column says for one row.
 *
 * The column answers "what is this rider doing today", so a day status wins
 * whenever the selected month actually contains today. A past month has no
 * today cell, and a rider whose today cell is still blank has nothing to
 * report, so both fall back to the account status the riders list shows.
 * `label` is the one string the pill, the column filter, the sort and the CSV
 * all read, so an export can never disagree with the grid.
 */
export type RiderStatusValue = {
  /** A core Status choice, a custom label, or the riders-list Inactive account. */
  status: CorePayrollStatusKey | "inactive" | "custom";
  label: string;
  /** Null for Active and Inactive, which use the account pill. */
  hex: string | null;
  /** Kuwait date the day status came from, when one did. */
  date: string | null;
  kind: "day" | "account" | "manual";
};

/** Pill vocabulary: the legend's words, shortened to fit one cell. */
const RIDER_STATUS_LABELS: Record<DayStatus, string> = {
  work: "Work",
  reduced3: "3h",
  half: "Half",
  actual: "Actual",
  off: "OFF",
  sick: "Sick",
  accident: "Accident",
  vehicle: "Vehicle",
  absent: "Absent",
  abs_lh: "Abs·LH",
  abs_lo: "Abs·LO",
  custom: "Custom",
  cancelled: "Cancelled",
  leave: "Leave",
  terminated: "Terminated",
  phone_issue: "Phone issue",
  id_suspended: "ID Suspended",
  new_hire: "New hire",
  training: "Training",
  blank: "",
};

export function riderStatusLabel(status: DayStatus): string {
  return RIDER_STATUS_LABELS[status];
}

/**
 * Legend swatch per status. `actual`, `custom`, `abs_lh` and `abs_lo` are not
 * legend chips of their own, so they borrow the swatch of the day type they
 * behave like: a worked day, or an absence.
 */
const RIDER_STATUS_HEX: Record<DayStatus, string | null> = {
  work: PAYROLL_STATUS_CHIP.work.hex,
  reduced3: PAYROLL_STATUS_CHIP.reduced3.hex,
  half: PAYROLL_STATUS_CHIP.half.hex,
  actual: PAYROLL_STATUS_CHIP.work.hex,
  off: PAYROLL_STATUS_CHIP.off.hex,
  sick: PAYROLL_STATUS_CHIP.sick.hex,
  accident: PAYROLL_STATUS_CHIP.accident.hex,
  vehicle: PAYROLL_STATUS_CHIP.vehicle.hex,
  absent: PAYROLL_STATUS_CHIP.absent.hex,
  abs_lh: PAYROLL_STATUS_CHIP.absent.hex,
  abs_lo: PAYROLL_STATUS_CHIP.absent.hex,
  custom: PAYROLL_STATUS_CHIP.work.hex,
  cancelled: PAYROLL_STATUS_CHIP.cancelled.hex,
  leave: PAYROLL_STATUS_CHIP.leave.hex,
  terminated: PAYROLL_STATUS_CHIP.terminated.hex,
  phone_issue: PAYROLL_STATUS_CHIP.phone_issue.hex,
  id_suspended: PAYROLL_STATUS_CHIP.id_suspended.hex,
  new_hire: PAYROLL_STATUS_CHIP.new_hire.hex,
  training: PAYROLL_STATUS_CHIP.training.hex,
  blank: null,
};

export function riderStatusHex(status: DayStatus): string | null {
  return RIDER_STATUS_HEX[status];
}

function manualStatus(row: PayrollRiderRow): RiderStatusValue | null {
  const override = row.statusOverride;
  const raw = override?.label?.trim();
  if (!override || !raw) return null;
  if (isCorePayrollStatus(override.key)) {
    return {
      status: override.key,
      label: CORE_PAYROLL_STATUS_LABEL[override.key],
      hex: CORE_PAYROLL_STATUS_HEX[override.key],
      date: null,
      kind: "manual",
    };
  }
  const choice = payrollStatusChoiceFromLabel(raw);
  if (!choice) return null;
  if (isCorePayrollStatus(choice.key)) {
    return {
      status: choice.key,
      label: choice.label,
      hex: CORE_PAYROLL_STATUS_HEX[choice.key],
      date: null,
      kind: "manual",
    };
  }
  return {
    status: "custom",
    label: choice.label,
    hex: CUSTOM_STATUS_HEX,
    date: null,
    kind: "manual",
  };
}

export function resolveRiderStatus(
  row: PayrollRiderRow,
  todayDate?: string | null,
): RiderStatusValue {
  const manual = manualStatus(row);
  if (manual) return manual;
  const today = todayDate ?? kuwaitToday();
  const index = row.dayInfo.findIndex((info) => info.date === today);
  const dayStatus = index >= 0 ? row.days[index] : undefined;
  if (dayStatus && dayStatus !== "blank") {
    const key = payrollGridStatusFromDay(dayStatus);
    if (key) {
      return {
        status: key,
        label: CORE_PAYROLL_STATUS_LABEL[key],
        hex: CORE_PAYROLL_STATUS_HEX[key],
        date: today,
        kind: "day",
      };
    }
  }
  const active = row.status === "Active";
  return {
    status: active ? "active" : "inactive",
    label: active ? "Active" : "Inactive",
    hex: null,
    date: null,
    kind: "account",
  };
}

export function riderColumnValue(
  row: PayrollRiderRow,
  columnId: string,
  todayDate?: string | null,
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
      return restaurantDisplayId(row);
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
      return resolveRiderStatus(row, todayDate).label;
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
    case "appTotalHours":
      return appAttendanceTotals(row).totalHours;
    case "appActiveDays":
      return appAttendanceTotals(row).activeDays;
    case "appAvgHours":
      return appAttendanceTotals(row).avgHours;
    default:
      if (/^d\d+$/.test(columnId)) {
        const index = Number(columnId.slice(1)) - 1;
        const particular = cellParticular(row, index);
        return particular || null;
      }
      if (/^a\d+$/.test(columnId)) {
        const index = Number(columnId.slice(1)) - 1;
        return row.dayInfo[index] ? appHoursForDay(row, index) : null;
      }
      if (/^o\d+$/.test(columnId)) {
        const index = Number(columnId.slice(1)) - 1;
        const info = row.dayInfo[index];
        return info ? aoShownOrders(info, row.days[index]) : null;
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

/** Column id for one day's application hours in the Application Attendance grid. */
export function appDayColumnId(dayIndex: number): string {
  return `a${dayIndex + 1}`;
}

export function dayAdjustmentInput(
  row: PayrollRiderRow,
  dayIndex: number,
  date: string,
  text?: string,
): {
  driverId: string;
  date: string;
  text: string;
  currentHours: number;
  beforeStatus: AdjustmentStatus;
  beforeHours: number | null;
} {
  const info = row.dayInfo[dayIndex];
  const manual = Boolean(info?.adjusted && info.adjustmentStatus && info.adjustmentStatus !== "auto");
  return {
    driverId: row.driverId,
    date,
    text: text ?? dayClipboardToken(row, dayIndex),
    currentHours: info?.creditedHours ?? 0,
    beforeStatus: manual ? info!.adjustmentStatus! : "auto",
    beforeHours: manual ? (info!.adjustmentHours ?? null) : null,
  };
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
