import { downloadCsv, toCsv } from "@/features/performance/performance-ops-table";
import {
  bucketOf,
  dayLabel,
  dayStatusLabel,
  formatPayrollPct,
  PAYROLL_EFF_BUCKETS,
  type PayrollEffBucketId,
} from "./payroll-formulas";
import type { PayrollRequestRow, PayrollRiderRow } from "./payroll-types";

export const PAYROLL_IDENTITY_HEADERS = [
  "AM ID",
  "MG ID",
  "Name",
  "Restaurant",
  "Zone",
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
  "Fixed Days",
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
    row.fixedDays,
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

export function exportPayrollDistributionCsv(
  monthKey: string,
  rows: readonly PayrollRiderRow[],
) {
  const headers = [
    "Bucket",
    ...PAYROLL_IDENTITY_HEADERS,
    "Total Days",
    "Fixed Days",
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
        r.fixedDays,
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
