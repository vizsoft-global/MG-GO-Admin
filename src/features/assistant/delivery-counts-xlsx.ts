import ExcelJS from "exceljs";
import type { DeliveryCountsByFilters } from "@/features/deliveries/deliveries-actions";

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF1E3A5F" },
};

const HEADER_FONT: Partial<ExcelJS.Font> = {
  bold: true,
  color: { argb: "FFFFFFFF" },
  size: 11,
};

export const DELIVERY_COUNTS_HEADERS = [
  "Filter",
  "Value",
] as const;

export const DELIVERY_COUNTS_STATUS_HEADERS = [
  "Status",
  "Count",
] as const;

/** Counts sheet only — no order ids, no Orders Report columns. */
export async function buildDeliveryCountsWorkbook(
  counts: DeliveryCountsByFilters,
  labels?: { zoneName?: string; partnerName?: string; from?: string; to?: string },
): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "DPD Admin";
  const sheet = wb.addWorksheet("Delivery counts");

  sheet.addRow([...DELIVERY_COUNTS_HEADERS]);
  const header = sheet.getRow(1);
  header.height = 20;
  header.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
  });

  sheet.addRow(["From", labels?.from ?? counts.filters.dateFrom ?? ""]);
  sheet.addRow(["To", labels?.to ?? counts.filters.dateTo ?? ""]);
  sheet.addRow(["Zone", labels?.zoneName ?? counts.filters.zoneId ?? "All"]);
  sheet.addRow(["Partner", labels?.partnerName ?? counts.filters.partnerId ?? "All"]);
  sheet.addRow([]);
  sheet.addRow([...DELIVERY_COUNTS_STATUS_HEADERS]);
  const statusHeader = sheet.getRow(7);
  statusHeader.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
  });
  sheet.addRow(["total", counts.total]);
  sheet.addRow(["verified", counts.verified]);
  sheet.addRow(["pending", counts.pending]);
  sheet.addRow(["rejected", counts.rejected]);
  sheet.addRow(["cancelled", counts.cancelled]);
  sheet.addRow(["in_transit", counts.in_transit]);
  sheet.addRow(["under_review", counts.under_review]);

  sheet.columns = [{ width: 18 }, { width: 28 }];
  return wb.xlsx.writeBuffer();
}

export function deliveryCountsWorkbookHasOrderColumns(headers: string[]): boolean {
  const banned = ["order id", "order_id", "external_order_id", "short_id", "delivery id"];
  return headers.some((h) => banned.includes(h.trim().toLowerCase()));
}
