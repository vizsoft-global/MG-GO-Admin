import * as XLSX from "xlsx";
import {
  DRIVER_IMPORT_HEADERS,
  DRIVER_IMPORT_SAMPLE_ROW,
} from "@/features/drivers/import/template";

export async function GET() {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    [...DRIVER_IMPORT_HEADERS],
    [...DRIVER_IMPORT_SAMPLE_ROW],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, "Drivers");
  const buffer = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;

  return new Response(buffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition":
        'attachment; filename="dpd-driver-import-template.xlsx"',
    },
  });
}
