import ExcelJS from "exceljs";
import { downloadBuffer, styleHeader } from "./service-records-xlsx";
import type { MaintenanceProgramRow, MaintenanceStatus } from "./types";

/**
 * One row per **vehicle × program**. The old export was one row per vehicle,
 * which could only describe a single interval per vehicle — the whole point of
 * the rework is that oil, front tyres, rear tyres, brakes and the bike chain are
 * five independent rows for the same plate.
 */
const HEADERS: { key: string; width: number }[] = [
  { key: "plate", width: 14 },
  { key: "program", width: 16 },
  { key: "model", width: 18 },
  { key: "condition", width: 12 },
  { key: "driver", width: 22 },
  { key: "currentKm", width: 12 },
  { key: "lastKm", width: 14 },
  { key: "lastDate", width: 13 },
  { key: "nextKm", width: 14 },
  { key: "remainingKm", width: 13 },
  { key: "daysSince", width: 11 },
  { key: "nextDate", width: 13 },
  { key: "remainingDays", width: 13 },
  { key: "kmInterval", width: 12 },
  { key: "dayInterval", width: 12 },
  { key: "status", width: 14 },
] as const;

export type MaintenanceColumnKey = (typeof HEADERS)[number]["key"];

export type MaintenanceXlsxOptions = {
  provisional: boolean;
  labelStatus: (status: MaintenanceStatus) => string;
  labelProvisional: string;
  columnLabels: Record<MaintenanceColumnKey, string>;
};

export async function buildServiceMaintenanceWorkbook(
  rows: readonly MaintenanceProgramRow[],
  options: MaintenanceXlsxOptions,
): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Preventive maintenance");
  ws.columns = [...HEADERS.map((column) => ({ width: column.width })), { width: 22 }];
  ws.getRow(1).values = [
    ...HEADERS.map((column) => options.columnLabels[column.key as MaintenanceColumnKey]),
    "Status note",
  ];
  styleHeader(ws.getRow(1));

  for (const row of rows) {
    ws.addRow([
      row.plate,
      row.programLabel,
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
      // 0 is "not tracked on this dimension", so it prints as a dash rather than
      // a zero interval that would read as "due every kilometre".
      row.kmInterval > 0 ? row.kmInterval : "—",
      row.dayInterval > 0 ? row.dayInterval : "—",
      options.labelStatus(row.status),
      // Every export says out loud that the intervals it judged by are unapproved.
      row.provisional && options.provisional ? options.labelProvisional : "",
    ]);
  }

  const buffer = await wb.xlsx.writeBuffer();
  return buffer as ArrayBuffer;
}

export async function downloadServiceMaintenanceXlsx(
  rows: readonly MaintenanceProgramRow[],
  options: MaintenanceXlsxOptions,
): Promise<void> {
  const buffer = await buildServiceMaintenanceWorkbook(rows, options);
  downloadBuffer(buffer, `MGGO-Service-Maintenance-${new Date().toISOString().slice(0, 10)}.xlsx`);
}
