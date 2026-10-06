import { downloadCsv, toCsv } from "@/features/performance/performance-ops-table";
import {
  bucketOf,
  formatPayrollPct,
  isoDayLabel,
  PAYROLL_EFF_BUCKETS,
  type PayrollEffBucketId,
} from "./payroll-formulas";
import { cellParticular } from "./payroll-particulars";
import { payrollVehicleKind } from "./payroll-rider-columns";
import type { PayrollRequestRow, PayrollRiderRow } from "./payroll-types";

export const PAYROLL_VIEW_HEADERS = [
  "AM ID",
  "Driver ID",
  "Name",
  "Restaurant",
  "Zone",
  "Zone category",
  "LM zone orders",
  "LM zone DPD",
  "LM zone eff%",
  "Partner",
  "Vehicle",
  "Status",
  "Total days",
  "Final orders",
  "3H days",
  "Half days",
  "OFF",
  "Sick",
  "Accident",
  "Vehicle issue",
  "Absence",
  "Abs LH",
  "Abs LO",
  "Off structure",
  "Required hours",
  "Actual hours",
  "Efficiency%",
] as const;

export const COMBINED_IDENTITY_HEADERS = [
  "AM ID",
  "Driver ID",
  "Name",
  "Zone",
  "Zone category",
  "Partner",
  "Vehicle",
] as const;

export const COMBINED_IDENTITY_KEYS = [
  "amId",
  "mgId",
  "name",
  "zone",
  "zoneCategory",
  "partner",
  "vehicleKind",
] as const;

export const AO_LEAD_HEADERS = [
  "AM ID",
  "Driver ID",
  "Name",
  "Partner",
  "Zone",
  "Zone category",
  "Vehicle",
  "Final orders",
  "Actual hours",
] as const;

export const AO_LEAD_KEYS = [
  "amId",
  "mgId",
  "name",
  "partner",
  "zone",
  "zoneCategory",
  "vehicleKind",
  "finalOrders",
  "actualHours",
] as const;

export type PayrollExportOptions = {
  labels?: Readonly<Record<string, string>>;
  hidden?: ReadonlySet<string>;
};

function headerFor(
  key: string,
  fallback: string,
  options?: PayrollExportOptions,
): string | null {
  if (options?.hidden?.has(key)) return null;
  const custom = options?.labels?.[key]?.trim();
  return custom || fallback;
}

function visibleIdentity(
  headers: readonly string[],
  keys: readonly string[],
  options: PayrollExportOptions | undefined,
  cellsOf: (row: PayrollRiderRow) => Array<string | number>,
): {
  headers: string[];
  cells: (row: PayrollRiderRow) => Array<string | number>;
} {
  const keep: number[] = [];
  const outHeaders: string[] = [];
  keys.forEach((key, index) => {
    const header = headerFor(key, headers[index] ?? key, options);
    if (header == null) return;
    keep.push(index);
    outHeaders.push(header);
  });
  return {
    headers: outHeaders,
    cells: (row) => {
      const all = cellsOf(row);
      return keep.map((index) => all[index] ?? "");
    },
  };
}

function summaryCells(row: PayrollRiderRow): Array<string | number> {
  return [
    row.amId,
    row.mgId,
    row.name,
    row.restaurant,
    row.zone,
    row.zoneCategory,
    row.zoneOrders ?? "",
    row.zoneDpd ?? "",
    row.zoneEfficiency ?? "",
    row.partner,
    payrollVehicleKind(row.vehicleKey),
    row.status,
    row.workDays,
    row.finalOrders,
    row.reducedDays,
    row.halfDays,
    row.offDays,
    row.sickDays,
    row.accidentDays,
    row.vehicleDays,
    row.absentDays,
    row.absLhDays,
    row.absLoDays,
    row.offStructureDays,
    Number(row.requiredHours.toFixed(2)),
    Number(row.actualHours.toFixed(2)),
    Number(row.efficiency.toFixed(2)),
  ];
}

function combinedIdentityCells(row: PayrollRiderRow): Array<string | number> {
  return [
    row.amId,
    row.mgId,
    row.name,
    row.zone,
    row.zoneCategory,
    row.partner,
    payrollVehicleKind(row.vehicleKey),
  ];
}

export function exportPayrollViewCsv(
  fileKey: string,
  dates: readonly string[],
  rows: readonly PayrollRiderRow[],
) {
  void dates;
  downloadCsv(`MGGO-payroll-${fileKey}`, toCsv([...PAYROLL_VIEW_HEADERS], rows.map(summaryCells)));
}

export function exportCombinedPayrollCsv(
  fileKey: string,
  dates: readonly string[],
  rows: readonly PayrollRiderRow[],
  options?: PayrollExportOptions,
) {
  const identity = visibleIdentity(
    COMBINED_IDENTITY_HEADERS,
    COMBINED_IDENTITY_KEYS,
    options,
    combinedIdentityCells,
  );
  const headers = [...identity.headers, ...dates.map(isoDayLabel)];
  downloadCsv(
    `MGGO-payroll-combined-${fileKey}`,
    toCsv(
      headers,
      rows.map((row) => [
        ...identity.cells(row),
        ...dates.map((_, i) => cellParticular(row, i)),
      ]),
    ),
  );
}

export function exportPayrollAttendanceOrdersCsv(
  fileKey: string,
  dates: readonly string[],
  rows: readonly PayrollRiderRow[],
  options?: PayrollExportOptions,
) {
  const identity = visibleIdentity(AO_LEAD_HEADERS, AO_LEAD_KEYS, options, aoLeadCells);
  const dayHeaders = dates.flatMap((date) => [`${isoDayLabel(date)} · Payroll`, `${isoDayLabel(date)} · Orders`]);
  downloadCsv(
    `MGGO-payroll-attendance-orders-${fileKey}`,
    toCsv(
      [...identity.headers, ...dayHeaders],
      rows.map((row) => [
        ...identity.cells(row),
        ...dates.flatMap((_, i) => [
          cellParticular(row, i),
          row.dayInfo[i]?.orders ? row.dayInfo[i]!.orders : "–",
        ]),
      ]),
    ),
  );
}

function aoLeadCells(row: PayrollRiderRow): Array<string | number> {
  return [
    row.amId,
    row.mgId,
    row.name,
    row.partner,
    row.zone,
    row.zoneCategory,
    payrollVehicleKind(row.vehicleKey),
    row.finalOrders,
    Number(row.actualHours.toFixed(2)),
  ];
}

export function exportPayrollDistributionCsv(
  monthKey: string,
  rows: readonly PayrollRiderRow[],
) {
  const headers = [
    "Bucket",
    "AM ID",
    "Driver ID",
    "Name",
    "Restaurant",
    "Zone",
    "Partner",
    "Status",
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
