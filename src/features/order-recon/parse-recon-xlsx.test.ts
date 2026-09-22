import assert from "node:assert/strict";
import { describe, it } from "node:test";
import ExcelJS from "exceljs";
import { parseReconWorksheet, parseReconXlsx } from "./parse-recon-xlsx";

async function sheetFrom(headers: string[], rows: (string | number)[][]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  ws.addRow(headers);
  for (const row of rows) ws.addRow(row);
  return ws;
}

describe("parseReconWorksheet", () => {
  it("melts a wide fixture and treats blank cells as 0", async () => {
    const ws = await sheetFrom(
      ["ID", "Driver Name", "Store Name", "Position", "2026-09-01", "2026-09-02"],
      [
        ["10001", "Ada Test", "Crystal Tower", "Rider", 4, ""],
        ["10002", "Bea Test", "Crystal Tower", "Rider", 0, 2],
      ],
    );
    const parsed = parseReconWorksheet(ws);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.from, "2026-09-01");
    assert.equal(parsed.to, "2026-09-02");
    assert.equal(parsed.rows.length, 4);
    assert.deepEqual(
      parsed.rows.find((r) => r.employee_id === "10001" && r.work_date === "2026-09-02"),
      {
        employee_id: "10001",
        employee_name: "Ada Test",
        store_name: "Crystal Tower",
        work_date: "2026-09-02",
        excel_orders: 0,
      },
    );
  });

  it("accepts header aliases", async () => {
    const ws = await sheetFrom(
      ["Employee ID", "Name", "Restaurant", "Position", "2026-09-01"],
      [["A1", "Ada", "Store A", "x", 1]],
    );
    const parsed = parseReconWorksheet(ws);
    assert.equal(parsed.ok, true);
  });

  it("rejects a missing date column and a span over 93 days", async () => {
    const noDates = await sheetFrom(["ID", "Driver Name", "Store Name", "Position"], [["1", "A", "S", "P"]]);
    assert.deepEqual(parseReconWorksheet(noDates), { ok: false, error: "no_date_columns" });

    const wide = await sheetFrom(
      ["ID", "Driver Name", "Store Name", "Position", "2026-01-01", "2026-05-01"],
      [["1", "A", "S", "P", 1, 1]],
    );
    assert.deepEqual(parseReconWorksheet(wide), { ok: false, error: "range_too_large" });
  });

  it("round-trips through an xlsx buffer", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Data");
    ws.addRow(["ID", "Driver Name", "Store Name", "Position", "2026-09-01"]);
    ws.addRow(["9", "Fake Name", "Fake Store", "Rider", 3]);
    const buf = await wb.xlsx.writeBuffer();
    const parsed = await parseReconXlsx(buf);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.rows[0]?.excel_orders, 3);
    assert.equal(parsed.rows[0]?.store_name, "Fake Store");
  });
});
