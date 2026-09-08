import ExcelJS from "exceljs";
import { formatUncappedPct } from "./performance-dpd-formulas";
import type { DpdEfficiencySnapshot } from "./performance-types";

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

function styleHeader(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
  });
  row.height = 20;
}

const RIDER_HEADERS = [
  "Rider",
  "Employee ID",
  "MG ID",
  "Restaurant",
  "Zone",
  "Actual",
  "Target",
  "Efficiency",
  "DPD Rider",
  "Worked days",
];

const GROUP_HEADERS = [
  "Name",
  "Zone",
  "Restaurant",
  "Actual",
  "Target",
  "Efficiency",
  "Riders",
];

export async function buildDpdEfficiencyWorkbook(
  snapshot: DpdEfficiencySnapshot,
): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "DPD Admin";

  const riders = wb.addWorksheet("Riders");
  riders.addRow(RIDER_HEADERS);
  styleHeader(riders.getRow(1));
  for (const row of snapshot.riders) {
    riders.addRow([
      row.driver_name,
      row.employee_id ?? "",
      row.driver_code,
      row.restaurant_name ?? "",
      row.zone_name ?? "",
      row.actual,
      row.target ?? "",
      formatUncappedPct(row.efficiency),
      row.dpd_rider == null ? "" : Math.round(row.dpd_rider * 10) / 10,
      row.worked_days,
    ]);
  }
  riders.columns = [
    { width: 28 },
    { width: 12 },
    { width: 10 },
    { width: 22 },
    { width: 16 },
    { width: 10 },
    { width: 10 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
  ];

  const restaurants = wb.addWorksheet("Restaurants");
  restaurants.addRow(GROUP_HEADERS);
  styleHeader(restaurants.getRow(1));
  for (const row of snapshot.restaurants) {
    restaurants.addRow([
      row.name ?? "",
      row.zone_name ?? "",
      row.restaurant_name ?? row.name ?? "",
      row.actual,
      row.target ?? "",
      formatUncappedPct(row.efficiency),
      row.riders,
    ]);
  }
  restaurants.columns = [
    { width: 24 },
    { width: 16 },
    { width: 22 },
    { width: 10 },
    { width: 10 },
    { width: 12 },
    { width: 10 },
  ];

  const zones = wb.addWorksheet("Zones");
  zones.addRow(GROUP_HEADERS);
  styleHeader(zones.getRow(1));
  for (const row of snapshot.zones) {
    zones.addRow([
      row.name ?? "",
      row.zone_name ?? row.name ?? "",
      "",
      row.actual,
      row.target ?? "",
      formatUncappedPct(row.efficiency),
      row.riders,
    ]);
  }
  for (const row of snapshot.zone_restaurants) {
    zones.addRow([
      row.zone_name ?? "",
      row.zone_name ?? "",
      row.restaurant_name ?? "",
      row.actual,
      row.target ?? "",
      formatUncappedPct(row.efficiency),
      row.riders,
    ]);
  }
  zones.columns = restaurants.columns;

  const buf = await wb.xlsx.writeBuffer();
  return buf as ArrayBuffer;
}
