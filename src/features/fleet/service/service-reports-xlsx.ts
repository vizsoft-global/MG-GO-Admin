import type ExcelJS from "exceljs";

/** The spreadsheet library is large; it is fetched when a workbook is built, not with the page. */
const loadExcelJS = async () => (await import("exceljs")).default;
import type { ServiceReport } from "./service-reports-model";
import { downloadBuffer, styleHeader } from "./service-records-xlsx";
import type { ServiceCategoryKey } from "./service-types";

const KWD_FMT = "0.0";

function sheet(wb: ExcelJS.Workbook, name: string, widths: number[]) {
  const ws = wb.addWorksheet(name);
  ws.columns = widths.map((width) => ({ width }));
  return ws;
}

function header(ws: ExcelJS.Worksheet, values: string[]) {
  ws.getRow(1).values = values;
  styleHeader(ws.getRow(1));
}

export async function buildServiceReportWorkbook(
  report: ServiceReport,
  options: {
    year: string;
    labelCategory: (key: ServiceCategoryKey) => string;
    labelOwnership: (ownership: "contract" | "service") => string;
  },
): Promise<ArrayBuffer> {
  const wb = new (await loadExcelJS()).Workbook();

  const monthly = sheet(wb, "Monthly", [12, 16, 16, 16, 10]);
  header(monthly, [
    `Month (${options.year})`,
    `${options.labelOwnership("contract")} (KWD)`,
    `${options.labelOwnership("service")} (KWD)`,
    "Total (KWD)",
    "Records",
  ]);
  for (const point of report.monthly) {
    const row = monthly.addRow([
      point.month,
      point.contractKwd,
      point.serviceKwd,
      point.totalKwd,
      point.records,
    ]);
    row.getCell(2).numFmt = KWD_FMT;
    row.getCell(3).numFmt = KWD_FMT;
    row.getCell(4).numFmt = KWD_FMT;
  }

  const breakdowns: { name: string; label: string; rows: typeof report.byCategory }[] = [
    { name: "By category", label: "Category", rows: report.byCategory },
    { name: "By service type", label: "Service type", rows: report.byServiceType },
    { name: "By vendor", label: "Vendor", rows: report.byVendor },
    { name: "By vehicle", label: "Vehicle", rows: report.byVehicle },
  ];
  for (const block of breakdowns) {
    const ws = sheet(wb, block.name, [34, 16, 10]);
    header(ws, [block.label, "Total (KWD)", "Records"]);
    for (const row of block.rows) {
      const excelRow = ws.addRow([row.label, row.totalKwd, row.records]);
      excelRow.getCell(2).numFmt = KWD_FMT;
    }
  }

  const parts = sheet(wb, "Spare parts", [34, 12, 16, 16, 10]);
  header(parts, ["Part", "Qty", "Average unit (KWD)", "Total (KWD)", "Records"]);
  for (const part of report.parts) {
    const row = parts.addRow([part.name, part.qty, part.avgUnitKwd, part.totalKwd, part.records]);
    row.getCell(3).numFmt = KWD_FMT;
    row.getCell(4).numFmt = KWD_FMT;
  }

  const buffer = await wb.xlsx.writeBuffer();
  return buffer as ArrayBuffer;
}

export async function downloadServiceReportXlsx(
  report: ServiceReport,
  options: {
    year: string;
    labelCategory: (key: ServiceCategoryKey) => string;
    labelOwnership: (ownership: "contract" | "service") => string;
  },
): Promise<void> {
  const buffer = await buildServiceReportWorkbook(report, options);
  downloadBuffer(buffer, `MGGO-Service-Cost-${options.year}.xlsx`);
}
