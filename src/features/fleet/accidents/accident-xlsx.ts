import type ExcelJS from "exceljs";

/** The spreadsheet library is large; it is fetched when a workbook is built, not with the page. */
const loadExcelJS = async () => (await import("exceljs")).default;
import { accidentCaseStatusOf, accidentDayOf, accidentDescriptionOf, accidentAttachmentCount } from "./accident-model";
import { downloadBuffer, styleHeader } from "../service/service-records-xlsx";
import { ACCIDENT_CASE_STATUSES, type AccidentCaseStatus, type AccidentRow } from "./accident-types";

/**
 * The workbook is the screen: the same rows, the same columns, the same order,
 * with the case pill painted on its cell. Built in the browser with `exceljs`,
 * exactly like `service-records-xlsx.ts`, so no row set crosses the wire.
 */

const KWD_FMT = "0.000";
const CASE_FILL: Record<AccidentCaseStatus, string> = {
  close: "FFD1FAE5",
  pending: "FFFEF3C7",
  delay: "FFFEE2E2",
};

export type AccidentExportLabels = {
  caseStatus: (status: AccidentCaseStatus) => string;
  source: (source: "admin" | "rider") => string;
  /** The other four closed vocabularies print exactly what the screen prints. */
  driverFault: (key: "yes" | "no") => string;
  vehicleCase: (key: string) => string;
  insuranceClaim: (key: string) => string;
  policeReport: (key: string) => string;
};

export async function buildAccidentWorkbook(
  rows: readonly AccidentRow[],
  labels: AccidentExportLabels,
): Promise<ArrayBuffer> {
  const wb = new (await loadExcelJS()).Workbook();
  const ws = wb.addWorksheet("Accidents");
  ws.columns = [
    { width: 12 },
    { width: 12 },
    { width: 14 },
    { width: 26 },
    { width: 12 },
    { width: 12 },
    { width: 22 },
    { width: 30 },
    { width: 22 },
    { width: 14 },
    { width: 16 },
    { width: 22 },
    { width: 16 },
    { width: 16 },
    { width: 14 },
    { width: 12 },
    { width: 10 },
    { width: 34 },
  ];
  ws.getRow(1).values = [
    "Reference",
    "Date",
    "Vehicle",
    "Driver",
    "Case",
    "Driver fault",
    "Vehicle status",
    "Location",
    "Other party",
    "Other party plate",
    "Other party phone",
    "Insurance company",
    "Insurance claim",
    "Police report",
    "Amount (KWD)",
    "Source",
    "Documents",
    "Fleet comment",
  ];
  styleHeader(ws.getRow(1));

  for (const row of rows) {
    const status = accidentCaseStatusOf(row);
    const excelRow = ws.addRow([
      row.reference ?? "",
      accidentDayOf(row),
      row.plate_snapshot ?? "",
      row.driver_name ?? "",
      labels.caseStatus(status),
      row.driver_fault ? labels.driverFault(row.driver_fault) : "",
      row.vehicle_case_status ? labels.vehicleCase(row.vehicle_case_status) : "",
      row.location_text ?? "",
      row.other_party_name ?? "",
      row.other_party_plate ?? "",
      row.other_party_phone ?? "",
      row.insurance_company ?? "",
      row.insurance_claim_status ? labels.insuranceClaim(row.insurance_claim_status) : "",
      row.police_report_status ? labels.policeReport(row.police_report_status) : "",
      row.amount_kwd ?? "",
      labels.source(row.source),
      accidentAttachmentCount(row),
      row.fleet_comment ?? accidentDescriptionOf(row) ?? "",
    ]);
    excelRow.getCell(5).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: CASE_FILL[status] },
    };
    excelRow.getCell(15).numFmt = KWD_FMT;
  }

  const buffer = await wb.xlsx.writeBuffer();
  return buffer as ArrayBuffer;
}

export async function downloadAccidentsXlsx(
  rows: readonly AccidentRow[],
  labels: AccidentExportLabels,
): Promise<void> {
  const buffer = await buildAccidentWorkbook(rows, labels);
  downloadBuffer(buffer, `MGGO-Accidents-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

/** The three keys, in the PDF's order — used by tests and the column header. */
export const ACCIDENT_EXPORT_CASE_ORDER = ACCIDENT_CASE_STATUSES;
