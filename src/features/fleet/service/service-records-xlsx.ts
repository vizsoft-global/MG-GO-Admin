import type ExcelJS from "exceljs";

/** The spreadsheet library is large; it is fetched when a workbook is built, not with the page. */
const loadExcelJS = async () => (await import("exceljs")).default;
import { effectiveRecordCost, recordDay, recordStage } from "./service-records-model";
import type { ServiceRecordRow, ServiceStage } from "./types";

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF1E3A5F" },
};
const HEADER_FONT: Partial<ExcelJS.Font> = {
  bold: true,
  color: { argb: "FFFFFFFF" },
  size: 10,
};
const KWD_FMT = "0.0";

export function styleHeader(row: ExcelJS.Row) {
  row.height = 26;
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  });
}

export function downloadBuffer(buffer: ExcelJS.Buffer | ArrayBuffer, fileName: string) {
  const blob = new Blob([buffer as ArrayBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}

function stamp(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Same rows the screen shows, in the same column order. */
export async function buildServiceRecordsWorkbook(
  rows: readonly ServiceRecordRow[],
  labelForStage: (stage: ServiceStage) => string,
): Promise<ArrayBuffer> {
  const wb = new (await loadExcelJS()).Workbook();
  const ws = wb.addWorksheet("Service records");
  ws.columns = [
    { width: 12 },
    { width: 28 },
    { width: 30 },
    { width: 14 },
    { width: 22 },
    { width: 22 },
    { width: 22 },
    { width: 12 },
    { width: 12 },
    { width: 14 },
    { width: 14 },
  ];
  ws.getRow(1).values = [
    "Date",
    "Description",
    "Service type",
    "Vehicle",
    "Driver",
    "Vendor",
    "Company",
    "Cost (KWD)",
    "Odometer (km)",
    "Stage",
    "Invoice",
  ];
  styleHeader(ws.getRow(1));

  for (const row of rows) {
    const excelRow = ws.addRow([
      recordDay(row),
      row.description ?? "",
      row.service_type_label ?? row.kind,
      row.vehicle_snapshot?.plate ?? "",
      row.driver_name ?? "",
      row.vendor ?? "",
      row.company ?? "",
      effectiveRecordCost(row),
      row.odometer_km ?? row.odometer ?? "",
      labelForStage(recordStage(row)),
      row.invoice_no ?? "",
    ]);
    excelRow.getCell(8).numFmt = KWD_FMT;
  }

  const buffer = await wb.xlsx.writeBuffer();
  return buffer as ArrayBuffer;
}

export async function downloadServiceRecordsXlsx(
  rows: readonly ServiceRecordRow[],
  options: { labelForStage: (stage: ServiceStage) => string },
): Promise<void> {
  const buffer = await buildServiceRecordsWorkbook(rows, options.labelForStage);
  downloadBuffer(buffer, `MGGO-Service-Records-${stamp()}.xlsx`);
}
