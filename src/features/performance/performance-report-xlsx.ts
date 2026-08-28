import ExcelJS from "exceljs";
import { scoreToStars } from "./performance-types";
import { componentPct } from "./performance-formulas";
import type {
  PerformanceComponent,
  PerformanceReport,
  PerformanceReportTeam,
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
  "Rating",
  "Score",
  "Band",
] as const;

const COLUMN_WIDTHS = [
  7, 10, 10, 28, 18, 16, 11, 12, 11, 12, 11, 9, 11, 13, 11, 11, 9, 8, 10,
];

/** Width of one per-team rating column. */
const TEAM_COLUMN_WIDTH = 13;

/** Width of one per-component column. */
const COMPONENT_COLUMN_WIDTH = 14;

/**
 * Header order, with one column per score component and then one per rating
 * team appended. Both are tenant-configurable, so both go after the fixed
 * columns — the fixed ones keep their positions whatever a tenant has set up.
 */
export function performanceReportHeaders(
  teams: PerformanceReportTeam[] = [],
  components: PerformanceComponent[] = [],
): string[] {
  return [
    ...PERFORMANCE_REPORT_HEADERS,
    ...components.map((c) => `${c.label_en} %`),
    ...teams.map((team) => `${team.label} (1-5)`),
  ];
}

/** One row of the report, in header order. Exported for the test. */
export function performanceReportRow(
  row: PerformanceReport["rows"][number],
  teams: PerformanceReportTeam[] = [],
  components: PerformanceComponent[] = [],
): (string | number)[] {
  const byTeam = new Map(row.manual_teams.map((t) => [t.team_key, t.score]));
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
    // An em dash, never 0. A component blend with nothing to measure is not a
    // driver who scored zero, and a reader sorting this column must not be told
    // it was.
    row.compliance_score == null ? "—" : Math.round(row.compliance_score),
    row.penalised_exception_count,
    // The 1–5 the raters picked, not the 0–100 the formula uses: a reader of the
    // sheet compares this against a rating, not against a percentage.
    row.manual_score == null ? "—" : scoreToStars(row.manual_score),
    row.overall_score,
    BAND_LABEL[row.score_band],
    ...components.map((c) => {
      const value = componentPct(row.component_scores, c.key);
      return value == null ? "—" : Math.round(value);
    }),
    ...teams.map((team) => {
      const score = byTeam.get(team.key);
      return score == null ? "—" : Math.round(score * 10) / 10;
    }),
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

  const teams = report.ratingTeams ?? [];
  const components = report.components ?? [];

  sheet.columns = [
    ...COLUMN_WIDTHS,
    ...components.map(() => COMPONENT_COLUMN_WIDTH),
    ...teams.map(() => TEAM_COLUMN_WIDTH),
  ].map((width) => ({ width }));

  const headerRow = sheet.addRow(performanceReportHeaders(teams, components));
  headerRow.height = 22;
  headerRow.eachCell((cell) => styleHeaderCell(cell));

  const scoreCol = PERFORMANCE_REPORT_HEADERS.indexOf("Score") + 1;
  const bandCol = PERFORMANCE_REPORT_HEADERS.indexOf("Band") + 1;

  for (const row of report.rows) {
    const dataRow = sheet.addRow(performanceReportRow(row, teams, components));
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
    ["Drivers with a team rating", k.rated_drivers],
    ["Average team rating", k.avg_manual != null ? scoreToStars(k.avg_manual) : "—"],
    [
      "Score weights",
      `delivery ${report.weights.delivery} · utilization ${report.weights.utilization} · compliance ${report.weights.compliance} · rating ${report.weights.manual}`,
    ],
  ];

  if (report.weights.manual === 0) {
    summaryRows.push([
      "Note",
      "Team rating weight is 0 — ratings are reported but do not move the score",
    ]);
  }

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
