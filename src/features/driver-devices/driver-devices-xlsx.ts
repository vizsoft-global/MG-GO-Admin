import ExcelJS from "exceljs";
import {
  formatAndroid,
  formatBuild,
  formatDeviceName,
  formatProcessor,
  formatRam,
  type DriverDeviceListRow,
  type DriverDeviceSeverity,
} from "./driver-devices-types";

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF1E3A5F" },
};

const HEADER_FONT: Partial<ExcelJS.Font> = {
  bold: true,
  color: { argb: "FFFFFFFF" },
  size: 11,
};

const BORDER_THIN: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FFD0D5DD" } },
  left: { style: "thin", color: { argb: "FFD0D5DD" } },
  bottom: { style: "thin", color: { argb: "FFD0D5DD" } },
  right: { style: "thin", color: { argb: "FFD0D5DD" } },
};

const SEVERITY_FILL: Record<DriverDeviceSeverity, string> = {
  critical: "FFF8D7DA",
  high: "FFFEE4CF",
  medium: "FFFEF3C7",
  low: "FFD1FAE5",
};

const SEVERITY_LABEL: Record<DriverDeviceSeverity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "OK",
};

export const DRIVER_DEVICES_HEADERS = [
  "Severity",
  "MG ID",
  "Emp ID",
  "Driver",
  "Phone",
  "Zone",
  "Status",
  "App build",
  "Build code",
  "Builds behind",
  "Device",
  "Android",
  "RAM total (MB)",
  "RAM free (MB)",
  "Processor",
  "CPU cores",
  "Battery %",
  "Battery health",
  "Battery temp (C)",
  "Last seen",
  "Days since seen",
  "Sentry events 7d",
  "Sentry issues 7d",
  "Force update",
] as const;

const COLUMN_WIDTHS = [
  10, 10, 10, 26, 16, 16, 11, 16, 11, 13, 24, 16, 14, 13, 24, 10, 10, 14, 16, 20, 14, 15, 15, 14,
];

/** One row in header order. Exported so the test can assert the mapping. */
export function driverDeviceReportRow(row: DriverDeviceListRow): (string | number)[] {
  const meta = row.device_meta;
  return [
    SEVERITY_LABEL[row.severity],
    row.driver_code,
    row.employee_id ?? "—",
    row.full_name,
    row.phone ?? "—",
    row.zone_name ?? "—",
    row.is_blocked ? "blocked" : row.status,
    formatBuild(row),
    row.app_version_code ?? "—",
    // An em dash, never 0: an install whose build is unknown is not an install
    // that is up to date, and a reader sorting this column must not be told it is.
    row.buildGap ?? "—",
    formatDeviceName(row),
    formatAndroid(row),
    meta?.ram_total_mb ?? "—",
    meta?.ram_free_mb ?? "—",
    formatProcessor(meta),
    meta?.cpu_cores ?? "—",
    meta?.battery_pct ?? "—",
    meta?.battery_health ?? "—",
    meta?.battery_temp_c ?? "—",
    row.last_seen_at ?? "Never",
    row.lastSeenDays ?? "—",
    row.sentryEvents,
    row.sentryIssues,
    row.forced
      ? row.force_app_update_min_code != null
        ? `Yes (min ${row.force_app_update_min_code})`
        : "Yes"
      : "No",
  ];
}

function styleHeaderCell(cell: ExcelJS.Cell) {
  cell.fill = HEADER_FILL;
  cell.font = HEADER_FONT;
  cell.alignment = { vertical: "middle", horizontal: "center" };
  cell.border = BORDER_THIN;
}

export type DriverDevicesReportMeta = {
  minVersionCode: number | null;
  minVersionName: string | null;
  latestVersionCode: number | null;
  sentryConnected: boolean;
  sentryNote?: string;
};

export async function buildDriverDevicesXlsx(
  rows: DriverDeviceListRow[],
  meta: DriverDevicesReportMeta,
): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Driver devices", {
    views: [{ state: "frozen", xSplit: 4, ySplit: 1 }],
  });
  sheet.columns = COLUMN_WIDTHS.map((width) => ({ width }));

  const headerRow = sheet.addRow([...DRIVER_DEVICES_HEADERS]);
  headerRow.height = 22;
  headerRow.eachCell((cell) => styleHeaderCell(cell));

  const severityCol = DRIVER_DEVICES_HEADERS.indexOf("Severity") + 1;

  for (const row of rows) {
    const dataRow = sheet.addRow(driverDeviceReportRow(row));
    dataRow.eachCell((cell, colNumber) => {
      const isText = colNumber >= 4 && colNumber <= 7;
      cell.alignment = {
        vertical: "middle",
        horizontal: isText ? "left" : "center",
      };
      cell.border = BORDER_THIN;
      if (colNumber === severityCol) {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: SEVERITY_FILL[row.severity] },
        };
        cell.font = { bold: true };
      }
    });
  }

  const summary = workbook.addWorksheet("Summary");
  summary.columns = [{ width: 32 }, { width: 28 }];
  const summaryHeader = summary.addRow(["Metric", "Value"]);
  summaryHeader.eachCell((cell) => styleHeaderCell(cell));

  const count = (predicate: (row: DriverDeviceListRow) => boolean) =>
    rows.filter(predicate).length;

  const summaryRows: [string, string | number][] = [
    ["Generated", new Date().toISOString()],
    ["Drivers", rows.length],
    ["Critical", count((r) => r.severity === "critical")],
    ["High", count((r) => r.severity === "high")],
    ["Medium", count((r) => r.severity === "medium")],
    ["OK", count((r) => r.severity === "low")],
    ["Outdated", count((r) => r.outdated)],
    ["No device data", count((r) => !r.hasDeviceData)],
    ["Force update armed", count((r) => r.forced)],
    ["Minimum build code", meta.minVersionCode ?? "not set"],
    ["Minimum build name", meta.minVersionName ?? "not set"],
    ["Latest build in field", meta.latestVersionCode ?? "unknown"],
    [
      "Sentry",
      meta.sentryConnected
        ? "connected (7d)"
        : `not connected${meta.sentryNote ? ` — ${meta.sentryNote}` : ""}`,
    ],
  ];

  if (!meta.sentryConnected) {
    // Stated rather than left as zeros: a column of 0 error counts and a column
    // of unknown error counts look identical in a spreadsheet.
    summaryRows.push([
      "Note",
      "Sentry columns read 0 because the error feed was unavailable, not because there were no errors",
    ]);
  }

  for (const [label, value] of summaryRows) {
    const r = summary.addRow([label, value]);
    r.eachCell((cell) => {
      cell.border = BORDER_THIN;
      cell.alignment = { vertical: "middle", horizontal: "left" };
    });
  }

  return workbook.xlsx.writeBuffer();
}

export function downloadDriverDevicesXlsx(buffer: ArrayBuffer) {
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `driver-devices-${new Date().toISOString().slice(0, 10)}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
