import ExcelJS from "exceljs";
import type {
  PerformanceReport,
  PerformanceScoreBand,
} from "./performance-types";

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

const BAND_FILL: Record<PerformanceScoreBand, string> = {
  top: "FFD1FAE5",
  good: "FFE8F0FE",
  watch: "FFFEF3C7",
  critical: "FFF8D7DA",
};

const BAND_LABEL: Record<PerformanceScoreBand, string> = {
  top: "Top",
  good: "Good",
  watch: "Watch",
  critical: "Critical",
};

export const PERFORMANCE_REPORT_HEADERS = [
  "Rank",
  "Emp ID",
  "MG ID",
  "Driver",
  "Partner",
  "Zone",
  "Status",
  "Worked days",
  "Leave days",
  "Absent days",
  "Deliveries",
  "Target",
  "Delivery %",
  "Utilization %",
  "Compliance",
  "Exceptions",
  "Score",
  "Band",
] as const;

const COLUMN_WIDTHS = [
  7, 10, 10, 28, 18, 16, 11, 12, 11, 12, 11, 9, 11, 13, 11, 11, 8, 10,
];

/** One row of the report, in header order. Exported for the test. */
export function performanceReportRow(
  row: PerformanceReport["rows"][number],
): (string | number)[] {
  return [
    row.dpd_rank,
    row.employee_id ?? "",
    row.driver_code,
    row.driver_name,
    row.partner_name ?? "—",
    row.zone_name ?? "—",
    row.driver_status,
    row.worked_days,
    row.leave_days,
    row.absent_days,
    row.actual_deliveries,
    row.target_deliveries,
    Math.round(row.delivery_efficiency_raw * 100),
    Math.round(row.utilization * 100),
    Math.round(row.compliance_score),
    row.exception_count,
    row.overall_score,
    BAND_LABEL[row.score_band],
  ];
}

function styleHeaderCell(cell: ExcelJS.Cell) {
  cell.fill = HEADER_FILL;
  cell.font = HEADER_FONT;
  cell.alignment = { vertical: "middle", horizontal: "center" };
  cell.border = BORDER_THIN;
}

export async function buildPerformanceReportXlsx(
  report: PerformanceReport,
): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("DPD Ranking", {
    views: [{ state: "frozen", xSplit: 4, ySplit: 1 }],
  });

  sheet.columns = COLUMN_WIDTHS.map((width) => ({ width }));

  const headerRow = sheet.addRow([...PERFORMANCE_REPORT_HEADERS]);
  headerRow.height = 22;
  headerRow.eachCell((cell) => styleHeaderCell(cell));

  const scoreCol = PERFORMANCE_REPORT_HEADERS.indexOf("Score") + 1;
  const bandCol = PERFORMANCE_REPORT_HEADERS.indexOf("Band") + 1;

  for (const row of report.rows) {
    const dataRow = sheet.addRow(performanceReportRow(row));
    const bandFill: ExcelJS.Fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: BAND_FILL[row.score_band] },
    };
    dataRow.eachCell((cell, colNumber) => {
      const isText = colNumber >= 4 && colNumber <= 7;
      cell.alignment = {
        vertical: "middle",
        horizontal: isText ? "left" : "center",
      };
      cell.border = BORDER_THIN;
      if (colNumber === scoreCol || colNumber === bandCol) {
        cell.fill = bandFill;
        cell.font = { bold: colNumber === scoreCol };
      }
    });
  }

  const summary = workbook.addWorksheet("Summary");
  summary.columns = [{ width: 30 }, { width: 24 }];
  const summaryHeader = summary.addRow(["Metric", "Value"]);
  summaryHeader.eachCell((cell) => styleHeaderCell(cell));

  const k = report.kpis;
  const summaryRows: [string, string | number][] = [
    ["Period", `${report.from} → ${report.to}`],
    ["Drivers ranked", report.rows.length],
    ["Drivers in period", report.totalCount],
    ["Average score", k.avg_overall ?? "—"],
    ["Average delivery %", k.avg_delivery_pct ?? "—"],
    ["Average utilization %", k.avg_utilization_pct ?? "—"],
    ["Average compliance", k.avg_compliance ?? "—"],
    [
      "Highest score",
      k.top_score != null ? `${k.top_score} — ${k.top_driver_name ?? "—"}` : "—",
    ],
    [
      "Lowest score",
      k.bottom_score != null
        ? `${k.bottom_score} — ${k.bottom_driver_name ?? "—"}`
        : "—",
    ],
    ["Top (80+)", k.band_top],
    ["Good (70-79)", k.band_good],
    ["Watch (50-69)", k.band_watch],
    ["Critical (under 50)", k.band_critical],
    [
      "Score weights",
      `delivery ${report.weights.delivery} · utilization ${report.weights.utilization} · compliance ${report.weights.compliance}`,
    ],
  ];

  if (report.truncated) {
    summaryRows.push([
      "Note",
      `Report capped at ${report.rows.length} of ${report.totalCount} drivers`,
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

export function downloadPerformanceReportXlsx(
  report: PerformanceReport,
  buffer: ArrayBuffer,
) {
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `dpd-performance-${report.from}_${report.to}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
