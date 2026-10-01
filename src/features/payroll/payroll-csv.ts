import { downloadCsv, toCsv } from "@/features/performance/performance-ops-table";
import {
  bucketOf,
  dayLabel,
  dayStatusLabel,
  formatPayrollPct,
  PAYROLL_EFF_BUCKETS,
  type PayrollEffBucketId,
} from "./payroll-formulas";
import { dayClipboardToken } from "./payroll-rider-columns";
import type { PayrollRequestRow, PayrollRiderRow } from "./payroll-types";

export const PAYROLL_IDENTITY_HEADERS = [
  "AM ID",
  "Driver ID",
  "Name",
  "Restaurant",
  "Zone",
  "Zone category",
  "Partner",
  "Nationality",
  "Status",
] as const;

export const PAYROLL_TOTAL_HEADERS = [
  "Total Days",
  "Total Hours",
  "OFF",
  "Sick",
  "Accident",
  "Absence",
  "3h days",
  "Half days",
  "Actual days",
  "Vehicle issue",
  "Abs · LH",
  "Abs · LO",
  "Custom days",
  "Adjusted cells",
  "Final orders",
  "Off Structure",
  "Required Hours",
  "Actual Hours",
  "Efficiency%",
] as const;

export function payrollTableHeaders(monthKey: string, days: number): string[] {
  const dayHeaders = Array.from({ length: days }, (_, i) => dayLabel(monthKey, i + 1));
  return [...PAYROLL_IDENTITY_HEADERS, ...dayHeaders, ...PAYROLL_TOTAL_HEADERS];
}

export function payrollTableRow(row: PayrollRiderRow): Array<string | number> {
  return [
    row.amId,
    row.mgId,
    row.name,
    row.restaurant,
    row.zone,
    row.zoneCategory,
    row.partner,
    row.nationality,
    row.status,
    ...row.days.map(dayStatusLabel),
    row.workDays,
    row.totalHours,
    row.offDays,
    row.sickDays,
    row.accidentDays,
    row.absentDays,
    row.reducedDays,
    row.halfDays,
    row.actualDays,
    row.vehicleDays,
    row.absLhDays,
    row.absLoDays,
    row.customDays,
    row.adjustedCells,
    row.finalOrders,
    row.offStructureDays,
    Number(row.requiredHours.toFixed(2)),
    Number(row.actualHours.toFixed(2)),
    Number(row.efficiency.toFixed(2)),
  ];
}

export function exportPayrollViewCsv(
  monthKey: string,
  days: number,
  rows: readonly PayrollRiderRow[],
) {
  downloadCsv(
    `MGGO-payroll-${monthKey}`,
    toCsv(payrollTableHeaders(monthKey, days), rows.map(payrollTableRow)),
  );
}

/**
 * The Combined tab's own export. It is the same grid, but the day cells are the
 * SOP token (`12`, `3h`, `OFF`, `ALH`) rather than the UI sentence, so the sheet
 * can be pasted back into the grid: `parseAdjustmentCellText` reads exactly this.
 */
export function exportCombinedPayrollCsv(
  monthKey: string,
  days: number,
  rows: readonly PayrollRiderRow[],
) {
  downloadCsv(
    `MGGO-payroll-combined-${monthKey}`,
    toCsv(
      payrollTableHeaders(monthKey, days),
      rows.map((row) => [
        ...payrollTableRow(row).slice(0, PAYROLL_IDENTITY_HEADERS.length),
        ...Array.from({ length: days }, (_, i) => dayClipboardToken(row, i)),
        ...payrollTableRow(row).slice(PAYROLL_IDENTITY_HEADERS.length + days),
      ]),
    ),
  );
}

/**
 * Payroll attendance and Orders — two cells per day, so the reader can see the
 * credited day and the reconciled order count side by side and tell a rider who
 * worked without orders from one who never turned up.
 */
export function exportPayrollAttendanceOrdersCsv(
  monthKey: string,
  days: number,
  rows: readonly PayrollRiderRow[],
) {
  const dayHeaders = Array.from({ length: days }, (_, i) => dayLabel(monthKey, i + 1)).flatMap(
    (label) => [`${label} · Payroll`, `${label} · Orders`],
  );
  const headers = [
    ...PAYROLL_IDENTITY_HEADERS,
    ...dayHeaders,
    ...PAYROLL_TOTAL_HEADERS,
  ];
  const data = rows.map((row) => [
    ...payrollTableRow(row).slice(0, PAYROLL_IDENTITY_HEADERS.length),
    ...Array.from({ length: days }, (_, i) => [
      dayStatusLabel(row.days[i] ?? "blank"),
      row.dayInfo[i]?.orders ?? 0,
    ]).flat(),
    ...payrollTableRow(row).slice(PAYROLL_IDENTITY_HEADERS.length + days),
  ]);
  downloadCsv(`MGGO-payroll-attendance-orders-${monthKey}`, toCsv(headers, data));
}

export function exportPayrollDistributionCsv(
  monthKey: string,
  rows: readonly PayrollRiderRow[],
) {
  const headers = [
    "Bucket",
    ...PAYROLL_IDENTITY_HEADERS,
    "Total Days",
    "Off Structure",
    "Required Hours",
    "Actual Hours",
    "Efficiency%",
    "Absence",
    "Unjustified Days",
  ];
  const data = [...PAYROLL_EFF_BUCKETS].flatMap((bucket) =>
    rows
      .filter((r) => bucketOf(r.efficiency) === bucket.id)
      .map((r) => [
        bucket.label,
        r.amId,
        r.mgId,
        r.name,
        r.restaurant,
        r.zone,
        r.partner,
        r.nationality,
        r.status,
        r.workDays,
        r.offStructureDays,
        Number(r.requiredHours.toFixed(2)),
        Number(r.actualHours.toFixed(2)),
        Number(r.efficiency.toFixed(2)),
        r.absentDays,
        r.unjustified,
      ]),
  );
  downloadCsv(`MGGO-efficiency-distribution-${monthKey}`, toCsv(headers, data));
}

export function exportRequestsCsv(
  monthKey: string,
  rows: readonly PayrollRequestRow[],
  tileLabel: (tile: PayrollRequestRow["tile"]) => string,
  statusLabel: (status: PayrollRequestRow["uiStatus"]) => string,
) {
  downloadCsv(
    `MGGO-requests-${monthKey}`,
    toCsv(
      [
        "Request ID",
        "Rider",
        "ID",
        "Type",
        "Day",
        "Zone",
        "Partner",
        "Reviewing dept.",
        "Status",
      ],
      rows.map((r) => [
        r.code,
        r.riderName,
        r.riderCode,
        tileLabel(r.tile),
        r.day,
        r.zone,
        r.partner,
        r.reviewingDept,
        statusLabel(r.uiStatus),
      ]),
    ),
  );
}

export function formatEfficiencyCell(value: number): { text: string; tone: "good" | "bad" | "mid" } {
  return {
    text: formatPayrollPct(value),
    tone: value >= 100 ? "good" : value < 80 ? "bad" : "mid",
  };
}

export function bucketLabel(id: PayrollEffBucketId): string {
  return PAYROLL_EFF_BUCKETS.find((b) => b.id === id)?.label ?? id;
}
