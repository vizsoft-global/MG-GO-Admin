import ExcelJS from "exceljs";
import type { DpdLiveSnapshot } from "@/features/performance/performance-types";

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

export async function buildPerformanceLiveWorkbook(
  snapshot: Pick<DpdLiveSnapshot, "date" | "deliveries" | "roster" | "alerts">,
): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "DPD Admin";
  const sheet = wb.addWorksheet("Live snapshot");
  sheet.addRow(["Metric", "Value"]);
  const header = sheet.getRow(1);
  header.height = 20;
  header.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
  });
  sheet.addRow(["Date", snapshot.date]);
  sheet.addRow(["Roster · active", snapshot.roster.active_drivers]);
  sheet.addRow(["Roster · total", snapshot.roster.total_drivers]);
  sheet.addRow(["Roster · on duty", snapshot.roster.on_duty]);
  sheet.addRow(["Roster · GPS live", snapshot.roster.tracking_live]);
  sheet.addRow(["Roster · checked in", snapshot.roster.checked_in]);
  sheet.addRow(["Deliveries · created", snapshot.deliveries.created]);
  sheet.addRow(["Deliveries · in transit", snapshot.deliveries.in_transit]);
  sheet.addRow(["Deliveries · pending", snapshot.deliveries.pending]);
  sheet.addRow(["Deliveries · under review", snapshot.deliveries.under_review]);
  sheet.addRow(["Deliveries · verified", snapshot.deliveries.verified]);
  sheet.addRow(["Deliveries · rejected", snapshot.deliveries.rejected]);
  sheet.addRow(["Deliveries · cancelled", snapshot.deliveries.cancelled]);
  sheet.addRow(["Alerts · out of zone", snapshot.alerts.out_of_zone]);
  sheet.addRow(["Alerts · GPS offline", snapshot.alerts.gps_offline]);
  sheet.addRow(["Alerts · low battery", snapshot.alerts.low_battery]);
  sheet.columns = [{ width: 28 }, { width: 16 }];
  return wb.xlsx.writeBuffer();
}
