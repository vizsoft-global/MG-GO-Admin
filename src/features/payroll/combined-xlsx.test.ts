import assert from "node:assert/strict";
import { describe, it } from "node:test";
import ExcelJS from "exceljs";
import { buildCombinedPayrollWorkbook, combinedWorkbookName, excelArgb } from "./combined-xlsx";
import type { DayStatus } from "./payroll-formulas";
import type { PayrollRiderRow } from "./payroll-types";

const DATES = ["2026-10-01", "2026-10-02", "2026-10-03"];

function riderRow(): PayrollRiderRow {
  return {
    driverId: "d1",
    amId: "0108899",
    mgId: "10001",
    name: "Test Rider",
    restaurant: "KFC FAHAHEEL",
    restaurantId: "r1",
    zone: "Fahaheel",
    zoneId: "z1",
    zoneCategory: "good",
    partner: "Americana",
    projectKey: "americana",
    vehicleKey: "bike",
    status: "Active",
    days: ["work", "off", "work"] as DayStatus[],
    dayInfo: DATES.map((date) => ({
      date,
      orders: 0,
      loggedHours: 0,
      source: "app",
      ruleLabel: null,
      adjusted: false,
      adjustmentStatus: null,
      adjustmentHours: null,
      adjustmentReason: null,
      creditedHours: 12,
      autoStatus: "work",
      autoHours: 12,
      autoRuleIndex: null,
      autoRuleLabel: null,
      autoSource: "app",
    })),
    workDays: 1,
    totalHours: 12,
    finalOrders: 3,
    reducedDays: 0,
    halfDays: 0,
    actualDays: 0,
    offDays: 1,
    sickDays: 0,
    accidentDays: 0,
    vehicleDays: 0,
    absentDays: 0,
    absLhDays: 0,
    absLoDays: 0,
    customDays: 0,
    adjustedCells: 0,
    actualHours: 6,
    requiredHours: 12,
  } as unknown as PayrollRiderRow;
}

async function build() {
  const buffer = await buildCombinedPayrollWorkbook({
    fileKey: "2026-10",
    identityHeaders: { amId: "MG ID", mgId: "Driver ID", name: "Name" },
    columns: [
      { id: "rest", header: "Restaurant" },
      { id: "zcat", header: "Zone Category" },
      { id: "status", header: "Status" },
      { id: "days", header: "Days" },
      { id: "req", header: "Required Hours" },
      { id: "act", header: "Actual Hours" },
      { id: "eff", header: "Efficiency %" },
    ],
    dates: DATES,
    dayHeaders: ["1-OCT", "2-OCT", "3-OCT"],
    rows: [riderRow()],
    today: "2026-10-02",
    zoneCategoryLabels: { good: "Good", average: "Average", low: "Low", not_set: "Not set" },
  });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(buffer));
  const sheet = workbook.worksheets[0];
  assert.ok(sheet);
  return sheet;
}

describe("excelArgb", () => {
  it("turns a hex fill into an Excel argb and refuses transparent", () => {
    assert.equal(excelArgb("#BFE4F8"), "FFBFE4F8");
    assert.equal(excelArgb("transparent"), null);
  });
});

describe("combinedWorkbookName", () => {
  it("names the file after the month", () => {
    assert.equal(combinedWorkbookName("2026-10"), "MGGO-combined-payroll-2026-10.xlsx");
  });
});

describe("Combined Payroll workbook", () => {
  it("writes the on-screen columns in order, with the day block expanded", async () => {
    const sheet = await build();
    const header = sheet.getRow(1).values as unknown[];
    assert.deepEqual(header.slice(1), [
      "MG ID",
      "Driver ID",
      "Name",
      "Restaurant",
      "Zone Category",
      "Status",
      "1-OCT",
      "2-OCT",
      "3-OCT",
      "Required Hours",
      "Actual Hours",
      "Efficiency %",
    ]);
  });

  it("keeps MG ID and Driver ID as text so a leading zero survives", async () => {
    const sheet = await build();
    assert.equal(sheet.getCell("A2").numFmt, "@");
    assert.equal(sheet.getCell("B2").numFmt, "@");
    assert.equal(sheet.getCell("A2").value, "0108899");
  });

  it("writes Efficiency as a real percent value, never as a ratio", async () => {
    const sheet = await build();
    const eff = sheet.getCell("L2");
    // SOP §14: stored 50, shown 50.0% — never 0.5 and never text.
    assert.equal(eff.numFmt, '0.0"%"');
    assert.equal(typeof eff.value, "number");
    assert.equal(eff.value, 50);
    assert.equal(sheet.getCell("J2").value, 12);
    assert.equal(sheet.getCell("J2").numFmt, "0.0");
    assert.equal(sheet.getCell("K2").value, 6);
    assert.equal(sheet.getCell("K2").numFmt, "0.00");
  });

  it("fills a day cell from the shared palette", async () => {
    const sheet = await build();
    const worked = sheet.getCell("G2");
    assert.equal(worked.value, 12);
    assert.equal(worked.numFmt, "0.0");
    const off = sheet.getCell("H2");
    assert.equal(off.value, "OFF");
    const offFill = off.fill as ExcelJS.FillPattern;
    assert.equal(offFill.fgColor?.argb, "FFC9EEC4");
  });

  it("prints an en dash on a day after today", async () => {
    const sheet = await build();
    assert.equal(sheet.getCell("I2").value, "–");
  });

  it("bands the Zone Category cell like the pill", async () => {
    const sheet = await build();
    const cell = sheet.getCell("E2");
    assert.equal(cell.value, "Good");
    const fill = cell.fill as ExcelJS.FillPattern;
    assert.equal(fill.fgColor?.argb, "FF10B981");
  });

  it("freezes the pinned trio and the header row", async () => {
    const sheet = await build();
    assert.equal(sheet.views[0]?.state, "frozen");
    assert.equal(sheet.views[0]?.xSplit, 3);
    assert.equal(sheet.views[0]?.ySplit, 1);
  });
});

