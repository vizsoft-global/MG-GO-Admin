import ExcelJS from "exceljs";
import {
  INCENTIVE_DAILY_HEADERS,
  incentiveDailyReportRowCells,
  type IncentiveDailyReport,
} from "./incentive-daily-report";

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

export async function buildIncentiveDailyWorkbook(
  report: IncentiveDailyReport,
): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "DPD Admin";

  const sheet = wb.addWorksheet("Daily incentives");
  sheet.addRow([...INCENTIVE_DAILY_HEADERS]);
  const header = sheet.getRow(1);
  header.height = 20;
  header.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
  });

  for (const row of report.rows) {
    sheet.addRow(incentiveDailyReportRowCells(row));
  }

  sheet.columns = [
    { width: 28 },
    { width: 14 },
    { width: 12 },
    { width: 22 },
    { width: 16 },
    { width: 12 },
    { width: 24 },
    { width: 14 },
    { width: 14 },
  ];
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  const summary = wb.addWorksheet("Summary");
  summary.addRow(["From", report.from]);
  summary.addRow(["To", report.to]);
  summary.addRow(["Rows", report.rows.length]);
  summary.addRow(["Day", "Asia/Kuwait calendar (earn_date)"]);
  summary.columns = [{ width: 18 }, { width: 28 }];

  return wb.xlsx.writeBuffer();
}
