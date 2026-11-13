import type ExcelJS from "exceljs";

/** The spreadsheet library is large; it is fetched when a workbook is built, not with the page. */
const loadExcelJS = async () => (await import("exceljs")).default;
import { HR_AWAITING } from "./hr-payroll-formulas";

export async function downloadHrWorkbook(args: {
  filename: string;
  headers: readonly string[];
  rows: readonly (readonly string[])[];
  /**
   * Rows whose Total Salary is below the Work Permit Salary, so the workbook
   * agrees with the screen. `column` is the 0-based index of the Total Salary
   * column in `headers`; `gaps` is one entry per data row (`null` = no flag).
   */
  shortfall?: { column: number; gaps: readonly (number | null)[] };
}): Promise<void> {
  const workbook = new (await loadExcelJS()).Workbook();
  const sheet = workbook.addWorksheet("HR Payroll");
  const header = sheet.addRow([...args.headers]);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF292A3F" } };
  });
  for (const row of args.rows) sheet.addRow([...row]);
  if (args.shortfall) {
    const { column, gaps } = args.shortfall;
    gaps.forEach((gap, index) => {
      if (gap === null) return;
      const cell = sheet.getRow(index + 2).getCell(column + 1);
      cell.font = { ...cell.font, bold: true, color: { argb: "FFB91C1C" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "26B91C1C" } };
    });
  }
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = args.filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function hrExportCell(value: string, awaitingLabel: string): string {
  return value === HR_AWAITING ? awaitingLabel : value;
}

export async function textFromImportFile(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".xlsx")) {
    const workbook = new (await loadExcelJS()).Workbook();
    await workbook.xlsx.load(await file.arrayBuffer());
    const sheet = workbook.worksheets[0];
    const lines: string[] = [];
    sheet?.eachRow((row) => {
      lines.push(`${row.getCell(1).text},${row.getCell(2).text}`);
    });
    return lines.join("\n");
  }
  return file.text();
}
