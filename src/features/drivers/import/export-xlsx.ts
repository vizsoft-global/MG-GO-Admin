import * as XLSX from "xlsx";

export function downloadAoaXlsx(
  filename: string,
  sheetName: string,
  aoa: Array<Array<string | number>>,
) {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
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

export function buildCredentialsAoa(
  credentials: Array<{ employee_id: string; driver_code: string; passcode: string }>,
): Array<Array<string | number>> {
  return [
    ["Employee ID", "Driver Code", "Passcode"],
    ...credentials.map((row) => [row.employee_id, row.driver_code, row.passcode]),
  ];
}
