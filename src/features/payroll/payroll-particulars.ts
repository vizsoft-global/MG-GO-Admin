import { dayDisplayHours, dayGridLabel, type DayStatus } from "./payroll-formulas";
import {
  ADJUSTMENT_STATUSES,
  ADJUSTMENT_STATUS_TO_DAY,
  hoursForStatus,
  type AdjustmentStatus,
} from "./payroll-rules-engine";
import type { PayrollRiderRow } from "./payroll-types";

/**
 * The one string a payroll day prints. Editor options, filters, Combined,
 * Attendance & Orders and Excel export all read this so a cell that says
 * `Half` cannot be offered as `pages.payroll.adjust.status.half`.
 *
 * `half` is the 6-hour / Half Day particular — there is no separate `6h`
 * adjustment status. Custom hours stay 0–24 and print as `{n}h`.
 */
export function cellParticular(row: PayrollRiderRow, dayIndex: number): string {
  const status = row.days[dayIndex];
  if (!status || status === "blank") return "";
  return dayGridLabel(status, dayDisplayHours(status, row.dayInfo[dayIndex]));
}

/** What the editor row for an adjustment status will write onto the cell. */
export function particularForAdjustment(status: AdjustmentStatus, hours = 0): string {
  if (status === "auto") return "";
  const day = ADJUSTMENT_STATUS_TO_DAY[status];
  const credited = hoursForStatus(day, {
    client: null,
    loggedHours: hours,
    customHours: status === "custom" ? hours : null,
  });
  return dayGridLabel(day, credited);
}

export function particularForDayStatus(status: DayStatus, hours = 0): string {
  if (status === "blank") return "";
  return dayGridLabel(status, hours);
}

/** Every selectable adjustment status, in the SOP picker order. Do not drop any. */
export const EDITOR_ADJUSTMENT_STATUSES: readonly AdjustmentStatus[] = ADJUSTMENT_STATUSES;

export function sortParticularValues(values: readonly string[]): string[] {
  return [...values].sort((a, b) => {
    const left = particularSortKey(a);
    const right = particularSortKey(b);
    if (left.kind !== right.kind) return left.kind === "num" ? -1 : 1;
    if (left.kind === "num" && right.kind === "num") return left.n - right.n;
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
  });
}

function particularSortKey(value: string): { kind: "num" | "word"; n: number } {
  const match = /^(\d+(?:\.\d+)?)h?$/i.exec(value.trim());
  if (match) return { kind: "num", n: Number(match[1]) };
  return { kind: "word", n: 0 };
}

export function countValueOccurrences(values: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}
