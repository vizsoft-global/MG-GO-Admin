import { downloadCsv, toCsv } from "@/features/performance/performance-ops-table";
import {
  bucketOf,
  formatPayrollPct,
  isoDayLabel,
  PAYROLL_EFF_BUCKETS,
  type PayrollEffBucketId,
} from "./payroll-formulas";
import { aoShownOrders } from "./payroll-orders-display";
import { cellParticular } from "./payroll-particulars";
import {
  payrollVehicleKind,
  appAttendanceTotals,
  appHoursForDay,
  restaurantDisplayId,
  resolveRiderStatus,
} from "./payroll-rider-columns";
import type { PayrollHubTab, PayrollRequestRow, PayrollRiderRow } from "./payroll-types";

export const PAYROLL_VIEW_HEADERS = [
  "MG ID",
  "Driver ID",
  "Name",
  "Restaurant",
  "Zone",
  "Zone category",
  "LM zone orders",
  "LM zone DPD",
  "LM zone eff%",
  "Client Name",
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
  "MG ID",
  "Driver ID",
  "Name",
  "Restaurant",
  "Client ID",
  "Zone",
  "Zone category",
  "Project Name",
  "Vehicle",
  "Status",
  "Total Orders",
  "Actual hours",
] as const;

export const COMBINED_IDENTITY_KEYS = [
  "amId",
  "mgId",
  "name",
  "restaurant",
  "restaurantId",
  "zone",
  "zoneCategory",
  "partner",
  "vehicleKind",
  "status",
  "finalOrders",
  "actualHours",
] as const;

export const APP_ATTENDANCE_HEADERS = [
  "MG ID",
  "Driver ID",
  "Name",
  "Restaurant",
  "Client ID",
  "Client Name",
  "Zone",
  "Zone category",
  "Vehicle",
  "Status",
  "Total app hours",
  "Active app days",
  "Avg hours / active day",
] as const;

export const APP_ATTENDANCE_KEYS = [
  "amId",
  "mgId",
  "name",
  "restaurant",
  "restaurantId",
  "partner",
  "zone",
  "zoneCategory",
  "vehicleKind",
  "status",
  "appTotalHours",
  "appActiveDays",
  "appAvgHours",
] as const;

export const AO_LEAD_HEADERS = [
  "MG ID",
  "Driver ID",
  "Name",
  "Restaurant",
  "Client ID",
  "Client Name",
  "Zone",
  "Zone category",
  "Vehicle",
  "Status",
  "Final orders",
  "Actual hours",
] as const;

export const AO_LEAD_KEYS = [
  "amId",
  "mgId",
  "name",
  "restaurant",
  "restaurantId",
  "partner",
  "zone",
  "zoneCategory",
  "vehicleKind",
  "status",
  "finalOrders",
  "actualHours",
] as const;

export type PayrollExportOptions = {
  labels?: Readonly<Record<string, string>>;
  hidden?: ReadonlySet<string>;
  /** Kuwait date the page calls today, so the Status cell matches the grid. */
  today?: string;
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

function summaryCells(row: PayrollRiderRow, today?: string): Array<string | number> {
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
    resolveRiderStatus(row, today).label,
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

function combinedIdentityCells(row: PayrollRiderRow, today?: string): Array<string | number> {
  return [
    row.amId,
    row.mgId,
    row.name,
    row.restaurant,
    restaurantDisplayId(row),
    row.zone,
    row.zoneCategory,
    row.partner,
    payrollVehicleKind(row.vehicleKey),
    resolveRiderStatus(row, today).label,
    row.finalOrders,
    Number(row.actualHours.toFixed(2)),
  ];
}

function appAttendanceLeadCells(row: PayrollRiderRow, today?: string): Array<string | number> {
  const totals = appAttendanceTotals(row);
  return [
    row.amId,
    row.mgId,
    row.name,
    row.restaurant,
    restaurantDisplayId(row),
    row.partner,
    row.zone,
    row.zoneCategory,
    payrollVehicleKind(row.vehicleKey),
    resolveRiderStatus(row, today).label,
    Number(totals.totalHours.toFixed(2)),
    totals.activeDays,
    Number(totals.avgHours.toFixed(2)),
  ];
}

export function exportPayrollViewCsv(
  fileKey: string,
  dates: readonly string[],
  rows: readonly PayrollRiderRow[],
  options?: PayrollExportOptions,
) {
  void dates;
  downloadCsv(
    `MGGO-payroll-${fileKey}`,
    toCsv(
      [...PAYROLL_VIEW_HEADERS],
      rows.map((row) => summaryCells(row, options?.today)),
    ),
  );
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
    (row) => combinedIdentityCells(row, options?.today),
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
  const identity = visibleIdentity(AO_LEAD_HEADERS, AO_LEAD_KEYS, options, (row) =>
    aoLeadCells(row, options?.today),
  );
  const dayHeaders = dates.flatMap((date) => [`${isoDayLabel(date)} · Payroll`, `${isoDayLabel(date)} · Orders`]);
  downloadCsv(
    `MGGO-payroll-attendance-orders-${fileKey}`,
    toCsv(
      [...identity.headers, ...dayHeaders],
      rows.map((row) => [
        ...identity.cells(row),
        ...dates.flatMap((_, i) => [
          cellParticular(row, i),
          aoShownOrders(row.dayInfo[i], row.days[i]) || "–",
        ]),
      ]),
    ),
  );
}

function aoLeadCells(row: PayrollRiderRow, today?: string): Array<string | number> {
  return [
    row.amId,
    row.mgId,
    row.name,
    row.restaurant,
    restaurantDisplayId(row),
    row.partner,
    row.zone,
    row.zoneCategory,
    payrollVehicleKind(row.vehicleKey),
    resolveRiderStatus(row, today).label,
    row.finalOrders,
    Number(row.actualHours.toFixed(2)),
  ];
}

export function exportPayrollApplicationAttendanceCsv(
  fileKey: string,
  dates: readonly string[],
  rows: readonly PayrollRiderRow[],
  options?: PayrollExportOptions,
) {
  const identity = visibleIdentity(
    APP_ATTENDANCE_HEADERS,
    APP_ATTENDANCE_KEYS,
    options,
    (row) => appAttendanceLeadCells(row, options?.today),
  );
  downloadCsv(
    `MGGO-payroll-app-attendance-${fileKey}`,
    toCsv(
      [...identity.headers, ...dates.map(isoDayLabel)],
      rows.map((row) => [
        ...identity.cells(row),
        ...dates.map((_, i) => Number(appHoursForDay(row, i).toFixed(2))),
      ]),
    ),
  );
}

export function payrollHubExportKind(
  tab: PayrollHubTab,
): "payroll" | "combined" | "ao" | "app_attendance" | "requests" | null {
  switch (tab) {
    case "payroll":
      return "payroll";
    case "combined":
      return "combined";
    case "attendance-orders":
      return "ao";
    case "app-attendance":
      return "app_attendance";
    case "requests":
      return "requests";
    case "settings":
      return null;
    default: {
      const never: never = tab;
      return never;
    }
  }
}

export function exportPayrollHubCsv(input: {
  tab: PayrollHubTab;
  fileKey: string;
  dates: readonly string[];
  riders: readonly PayrollRiderRow[];
  requests?: readonly PayrollRequestRow[];
  options?: PayrollExportOptions;
  tileLabel?: (tile: PayrollRequestRow["tile"]) => string;
  statusLabel?: (status: PayrollRequestRow["uiStatus"]) => string;
}): boolean {
  const kind = payrollHubExportKind(input.tab);
  if (kind === "payroll") {
    exportPayrollViewCsv(input.fileKey, input.dates, input.riders, input.options);
    return true;
  }
  if (kind === "combined") {
    exportCombinedPayrollCsv(input.fileKey, input.dates, input.riders, input.options);
    return true;
  }
  if (kind === "ao") {
    exportPayrollAttendanceOrdersCsv(input.fileKey, input.dates, input.riders, input.options);
    return true;
  }
  if (kind === "app_attendance") {
    exportPayrollApplicationAttendanceCsv(input.fileKey, input.dates, input.riders, input.options);
    return true;
  }
  if (kind === "requests") {
    if (!input.requests || !input.tileLabel || !input.statusLabel) return false;
    exportRequestsCsv(input.fileKey, input.requests, input.tileLabel, input.statusLabel);
    return true;
  }
  return false;
}

export function exportPayrollDistributionCsv(
  monthKey: string,
  rows: readonly PayrollRiderRow[],
) {
  const headers = [
    "Bucket",
    "MG ID",
    "Driver ID",
    "Name",
    "Restaurant",
    "Zone",
    "Client Name",
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
