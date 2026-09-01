import * as XLSX from "xlsx";
import type { DriverImportCredential } from "../types";

const CREDENTIAL_HEADERS = [
  "Full Name",
  "Employee ID",
  "Driver Code",
  "Passcode",
  "Phone",
  "Civil ID",
  "Partner",
  "Zone",
  "Vehicle",
  "Restaurants",
  "Nationality",
  "Rider Category",
  "Client ID",
  "Client Name",
] as const;

export function downloadWorkbookXlsx(
  filename: string,
  sheets: Array<{ name: string; aoa: Array<Array<string | number>> }>,
) {
  const wb = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(sheet.aoa);
    XLSX.utils.book_append_sheet(wb, ws, sheet.name);
  }
  const buffer = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function downloadAoaXlsx(
  filename: string,
  sheetName: string,
  aoa: Array<Array<string | number>>,
) {
  downloadWorkbookXlsx(filename, [{ name: sheetName, aoa }]);
}

export function buildImportErrorAoa(
  headers: string[],
  rows: string[][],
  preview: Array<{ rowIndex: number; status: string }>,
  failures: Array<{ rowIndex: number; reason: string }>,
): Array<Array<string | number>> {
  const failByIndex = new Map(failures.map((f) => [f.rowIndex, f.reason]));
  const out: Array<Array<string | number>> = [["Row", "Status", "Reason", ...headers]];
  for (const row of preview) {
    const applyReason = failByIndex.get(row.rowIndex);
    if (row.status === "ok" && !applyReason) continue;
    const sheetRow = rows[row.rowIndex] ?? [];
    out.push([
      row.rowIndex + 1,
      applyReason ? "apply_failed" : row.status,
      applyReason ?? "",
      ...headers.map((_, i) => sheetRow[i] ?? ""),
    ]);
  }
  return out;
}

/**
 * One row per approved import. Login columns stay near the front so the
 * sheet still works as a credentials handout; the rest is the driver as
 * saved, so ops do not have to open the panel to see who a passcode belongs to.
 *
 * Custom-field columns are the union of keys present on any row, labelled
 * when the picker knows them, otherwise by key.
 */
export function buildCredentialsAoa(
  credentials: DriverImportCredential[],
  customFieldLabels: ReadonlyArray<{ key: string; label: string }> = [],
): Array<Array<string | number>> {
  const labelByKey = new Map(
    customFieldLabels.map((field) => [field.key, field.label || field.key]),
  );
  const customKeys = [
    ...new Set(credentials.flatMap((row) => Object.keys(row.custom_fields))),
  ].sort();
  return [
    [
      ...CREDENTIAL_HEADERS,
      ...customKeys.map((key) => labelByKey.get(key) ?? key),
    ],
    ...credentials.map((row) => [
      row.full_name,
      row.employee_id,
      row.driver_code,
      row.passcode,
      row.phone ?? "",
      row.civil_id ?? "",
      row.partner_name ?? "",
      row.zone_name ?? "",
      row.vehicle_label ?? "",
      row.restaurant_names.join(", "),
      row.nationality ?? "",
      row.rider_category,
      row.client_id ?? "",
      row.client_name ?? "",
      ...customKeys.map((key) => row.custom_fields[key] ?? ""),
    ]),
  ];
}
