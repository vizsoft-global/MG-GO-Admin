// `xlsx` publishes no default export in its ESM build, so the namespace import
// is the one that survives bundling — same shape as `export-xlsx.ts` and the
// roster upload.
import * as XLSX from "xlsx";

/**
 * Read an uploaded sheet into raw rows.
 *
 * One reader for every importer in this module, so the baseline sheet and the
 * bike sheet cannot disagree about how a workbook becomes rows. The `xlsx`
 * reader is what the Service Type import already uses, and it handles `.xlsx`,
 * `.xls` and `.csv` from the same call — which is what the client sends us.
 */
export async function readSheetRows(file: File): Promise<unknown[][]> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0] ?? ""];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: "" }) as unknown[][];
}

/** A one-sheet download built from a header row plus sample rows. */
export function downloadSheet(
  fileName: string,
  sheetName: string,
  header: readonly string[],
  sample: readonly (readonly (string | number)[])[],
): void {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    [...header],
    ...sample.map((row) => [...row]),
  ]);
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
  const out = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  const blob = new Blob([out], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}
