import assert from "node:assert/strict";
import { describe, it } from "node:test";
import ExcelJS from "exceljs";
import { buildComparisonRiders, daysInRange, type ComparisonSnapshot } from "./order-comparison-model";
import {
  buildComparisonWorkbook,
  buildFilteredCsv,
  buildUnusedWorkbook,
  comparisonWorkbookName,
  unusedWorkbookName,
} from "./order-comparison-xlsx";

function sampleRiders() {
  const days = daysInRange("2026-08-01", "2026-08-31");
  const snapshot: ComparisonSnapshot = {
    from: "2026-08-01",
    to: "2026-08-31",
    am: [
      { mg_id: "10421", work_date: "2026-08-01", orders: 10, rider_name: "Ada" },
      { mg_id: "10422", work_date: "2026-08-01", orders: 8, rider_name: "Bea" },
      { mg_id: "10423", work_date: "2026-08-02", orders: 5, rider_name: "Cara" },
    ],
    mggo: [
      { mg_id: "10421", work_date: "2026-08-01", orders: 7 },
      { mg_id: "10422", work_date: "2026-08-01", orders: 8 },
      { mg_id: "10424", work_date: "2026-08-03", orders: 4 },
    ],
    riders: [{ mg_id: "10421", rider_name: "Ada", restaurant_name: "Tower" }],
  };
  return { days, riders: buildComparisonRiders(snapshot, days) };
}

describe("order-comparison-xlsx", () => {
  it("names the two workbooks after the SOP files", () => {
    assert.equal(comparisonWorkbookName(2026, 8), "MGGO-Order-Comparison-August-2026.xlsx");
    assert.equal(unusedWorkbookName(2026, 8), "MGGO-Not-Using-the-App-August-2026.xlsx");
  });

  it("builds the 6-sheet report with frozen panes and cross-sheet formulas", async () => {
    const { days, riders } = sampleRiders();
    const buf = await buildComparisonWorkbook(riders, days, 2026, 8);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(buf));
    assert.deepEqual(
      wb.worksheets.map((ws) => ws.name),
      ["By Rider", "Daily Difference", "Not Using the App", "Daily Totals", "AM Daily", "MGGO Daily"],
    );

    const by = wb.getWorksheet("By Rider")!;
    assert.equal(by.getCell("A1").value, "By Rider — AM vs MGGO, August 2026");
    assert.equal(by.views?.[0]?.state, "frozen");
    assert.equal(by.views?.[0]?.topLeftCell, "E5");
    assert.equal((by.getCell("E5").value as { formula: string }).formula, "SUM('AM Daily'!C2:AG2)");
    assert.equal((by.getCell("G5").value as { formula: string }).formula, "E5-F5");
    assert.equal((by.getCell("H5").value as { formula: string }).formula, 'IF(E5=0,"—",G5/E5)');
    assert.match(
      String((by.getCell("I5").value as { formula: string }).formula),
      /No orders.*Match.*Not using the app.*MGGO only.*AM higher.*MGGO higher/,
    );
    assert.equal(
      (by.getCell("J5").value as { formula: string }).formula,
      "SUMPRODUCT(--('AM Daily'!C2:AG2<>'MGGO Daily'!C2:AG2))",
    );

    const totals = wb.getWorksheet("Daily Totals")!;
    assert.equal(totals.rowCount, 32);
    assert.equal(totals.views?.[0]?.topLeftCell, "A2");
    assert.equal((totals.getCell("B2").value as { formula: string }).formula, "SUM('AM Daily'!C2:C5)");
    assert.equal((totals.getCell("D2").value as { formula: string }).formula, "B2-C2");

    const unused = wb.getWorksheet("Not Using the App")!;
    assert.match(
      String((unused.getCell("E5").value as { formula: string }).formula),
      /COUNTIF\('AM Daily'!C\d+:AG\d+,">0"\)/,
    );
    assert.match(String((unused.getCell("F5").value as { formula: string }).formula), /IFERROR\(D5\/E5,0\)/);

    const am = wb.getWorksheet("AM Daily")!;
    assert.equal(am.columnCount, 33);
    assert.equal(am.views?.[0]?.topLeftCell, "C2");
  });

  it("builds the unused workbook with a total row and a filtered CSV of AM−MGGO days", async () => {
    const { days, riders } = sampleRiders();
    const buf = await buildUnusedWorkbook(riders, 2026, 8);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(buf));
    const ws = wb.getWorksheet("Not Using the App")!;
    assert.equal(ws.getCell("A1").value, "MG ID");
    assert.equal(ws.getCell("A2").value, "10423");
    assert.equal(ws.getCell("D2").value, 5);
    assert.match(String(ws.getCell("B3").value), /1 riders/);
    assert.equal(ws.getCell("D3").value, 5);

    const csv = buildFilteredCsv(riders, days);
    assert.match(csv, /AM-MGGO 2026-08-01/);
    assert.match(csv, /Not using the app/);
    assert.match(csv, /AM higher/);
  });
});
