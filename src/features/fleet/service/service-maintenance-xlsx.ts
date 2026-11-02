import ExcelJS from "exceljs";
import { downloadBuffer, styleHeader } from "./service-records-xlsx";
import type { MaintenanceRow, MaintenanceStatus } from "./types";

const HEADERS: { key: string; width: number }[] = [
  { key: "plate", width: 14 },
  { key: "model", width: 18 },
  { key: "condition", width: 12 },
  { key: "driver", width: 22 },
  { key: "currentKm", width: 14 },
  { key: "lastKm", width: 16 },
  { key: "lastDate", width: 14 },
  { key: "nextKm", width: 16 },
  { key: "remainingKm", width: 14 },
  { key: "daysSince", width: 12 },
  { key: "nextDate", width: 14 },
  { key: "remainingDays", width: 14 },
  { key: "status", width: 14 },
];

export type MaintenanceColumnKey = (typeof HEADERS)[number]["key"];

export async function buildServiceMaintenanceWorkbook(
  rows: readonly MaintenanceRow[],
  options: {
    provisional: boolean;
    labelStatus: (status: MaintenanceStatus) => string;
    labelProvisional: string;
    columnLabels: Record<MaintenanceColumnKey, string>;
  },
): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Preventive maintenance");
  ws.columns = [
    ...HEADERS.map((column) => ({ width: column.width })),
    { width: 18 },
  ];
  ws.getRow(1).values = [
    ...HEADERS.map((column) => options.columnLabels[column.key as MaintenanceColumnKey]),
    "Status note",
  ];
  styleHeader(ws.getRow(1));

  for (const row of rows) {
    ws.addRow([
      row.plate,
      row.model ?? "",
      row.condition ?? "",
      row.driverName ?? "",
      row.currentKm ?? "",
      row.lastServiceKm ?? "",
      row.lastServiceDate ?? "",
      row.nextDueKm ?? "",
      row.remainingKm ?? "",
      row.daysSinceService ?? "",
      row.nextDueDate ?? "",
      row.remainingDays ?? "",
      options.labelStatus(row.status),
      // Every export says out loud that the intervals it judged by are unapproved.
      options.provisional ? options.labelProvisional : "",
    ]);
  }

  const buffer = await wb.xlsx.writeBuffer();
  return buffer as ArrayBuffer;
}

export async function downloadServiceMaintenanceXlsx(
  rows: readonly MaintenanceRow[],
  options: {
    provisional: boolean;
    labelStatus: (status: MaintenanceStatus) => string;
    labelProvisional: string;
    columnLabels: Record<MaintenanceColumnKey, string>;
  },
): Promise<void> {
  const buffer = await buildServiceMaintenanceWorkbook(rows, options);
  downloadBuffer(buffer, `MGGO-Service-Maintenance-${new Date().toISOString().slice(0, 10)}.xlsx`);
}
