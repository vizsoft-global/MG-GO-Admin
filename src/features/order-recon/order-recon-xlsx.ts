import ExcelJS from "exceljs";
import type { OrderReconTableRow } from "./order-recon-types";

export async function buildOrderReconWorkbook(rows: OrderReconTableRow[]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Reconciliation");
  ws.addRow(["Employee", "Restaurant", "Date", "Excel Orders", "App Orders", "Difference", "Status"]);
  for (const row of rows) {
    ws.addRow([
      row.employee_id,
      row.restaurant_name,
      row.work_date,
      row.excel_orders,
      row.app_orders,
      row.difference,
      row.status,
    ]);
  }
  return wb.xlsx.writeBuffer();
}

export function downloadOrderReconXlsx(buffer: ExcelJS.Buffer, fileName: string) {
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(a.href);
}
