import ExcelJS from "exceljs";
import type { OrderReconTableRow } from "./order-recon-types";
import { buildReconViews, comparedStoreRows, inUpload } from "./order-recon-views";

export async function buildOrderReconWorkbook(rows: OrderReconTableRow[]) {
  const views = buildReconViews(rows);
  const wb = new ExcelJS.Workbook();

  const daily = wb.addWorksheet("Daily");
  daily.addRow(["Rider", "Date", "Excel Order Count", "App Logged Order Count", "Difference"]);
  for (const row of views.daily) {
    daily.addRow([
      row.employee_name || row.employee_id,
      row.work_date,
      row.excel_orders,
      row.app_orders,
      row.difference,
    ]);
  }

  const unused = wb.addWorksheet("Not using the app");
  unused.addRow(["Rider", "Excel Order Count", "Days with Excel orders", "App Logged Order Count"]);
  for (const row of views.unused) {
    unused.addRow([
      row.employee_name || row.employee_id,
      row.excel_orders,
      row.days_with_excel,
      row.app_orders,
    ]);
  }

  const store = wb.addWorksheet("By store");
  store.addRow(["Employee", "Restaurant", "Date", "Excel Orders", "App Orders", "Difference", "Status"]);
  for (const row of comparedStoreRows(rows).filter(inUpload)) {
    store.addRow([
      row.employee_id,
      row.restaurant_name,
      row.work_date,
      row.excel_orders,
      row.app_orders,
      row.difference,
      row.status,
    ]);
  }
  for (const row of views.unresolved) {
    store.addRow([
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
