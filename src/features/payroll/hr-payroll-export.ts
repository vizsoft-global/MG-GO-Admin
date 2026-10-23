import ExcelJS from "exceljs";
import { HR_AWAITING } from "./hr-payroll-formulas";

export async function downloadHrWorkbook(args: {
  filename: string;
  headers: readonly string[];
  rows: readonly (readonly string[])[];
}): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("HR Payroll");
  const header = sheet.addRow([...args.headers]);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF292A3F" } };
  });
  for (const row of args.rows) sheet.addRow([...row]);
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
    const workbook = new ExcelJS.Workbook();
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
