import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { describe, it } from "node:test";
import {
  INCENTIVE_DAILY_HEADERS,
  incentiveDailyReportRowCells,
  parseIncentiveDailyReport,
  type IncentiveDailyReport,
} from "./incentive-daily-report";
import { buildIncentiveDailyWorkbook } from "./incentive-daily-xlsx";

const sample: IncentiveDailyReport = {
  from: "2026-09-01",
  to: "2026-09-03",
  rows: [
    {
      id: "a",
      driver_id: "d1",
      driver_name: "Ali",
      employee_id: "E1",
      driver_code: "10001",
      earn_date: "2026-09-03",
      restaurant_name: "Crystal",
      zone_name: "Hawally",
      deliveries: 17,
      applied_rule: "DPD 5",
      daily_amount_kwd: 7,
      period_total_kwd: 7.25,
    },
  ],
};

describe("parseIncentiveDailyReport", () => {
  it("blanks a missing restaurant and rule instead of inventing a merchant", () => {
    const parsed = parseIncentiveDailyReport(
      { from: "2026-09-01", to: "2026-09-02", rows: [{ id: "1", driver_id: "d" }] },
      "2026-01-01",
      "2026-01-02",
    );
    assert.equal(parsed.rows[0]?.restaurant_name, "");
    assert.equal(parsed.rows[0]?.applied_rule, "");
    assert.equal(parsed.rows[0]?.daily_amount_kwd, 0);
  });

  it("keeps the Kuwait calendar day and drops any clock time", () => {
    const parsed = parseIncentiveDailyReport(
      {
        from: "2026-09-01",
        to: "2026-09-02",
        rows: [{ id: "1", driver_id: "d", earn_date: "2026-09-01T22:15:00+03:00" }],
      },
      "2026-01-01",
      "2026-01-02",
    );
    assert.equal(parsed.rows[0]?.earn_date, "2026-09-01");
  });
});

describe("incentive daily row", () => {
  it("has exactly one cell per SOP header", () => {
    const cells = incentiveDailyReportRowCells(sample.rows[0]!);
    assert.equal(cells.length, INCENTIVE_DAILY_HEADERS.length);
    assert.equal(cells[1], "E1");
    assert.equal(cells[6], "DPD 5");
    assert.equal(cells[8], 7.25);
  });
});

describe("incentive daily workbook", () => {
  it("writes Daily incentives and a Summary that names the Kuwait day", async () => {
    const buffer = await buildIncentiveDailyWorkbook(sample);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    assert.deepEqual(
      workbook.worksheets.map((s) => s.name),
      ["Daily incentives", "Summary"],
    );
    const sheet = workbook.getWorksheet("Daily incentives")!;
    assert.equal(sheet.getRow(1).cellCount, INCENTIVE_DAILY_HEADERS.length);
    assert.equal(sheet.getRow(1).getCell(1).value, "Name");
    assert.equal(sheet.getRow(2).getCell(2).value, "E1");
    const summary = workbook.getWorksheet("Summary")!;
    assert.equal(summary.getRow(4).getCell(2).value, "Asia/Kuwait calendar (earn_date)");
  });
});
