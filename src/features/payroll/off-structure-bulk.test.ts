import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  offStructureRowsToApply,
  parseOffDaysCell,
  parseOffStructureSheet,
  previewOffStructureRows,
  resolveOffStructureKey,
  type OffStructureRosterEntry,
} from "./off-structure-bulk";

const roster: OffStructureRosterEntry[] = [
  {
    driverId: "d1",
    name: "BILAL YUSSIF",
    employeeId: "3099",
    driverCode: "10840",
    offStructureDays: 2,
  },
  {
    driverId: "d2",
    name: "PHILIP KWASI",
    employeeId: "SP004",
    driverCode: "10815",
    offStructureDays: 4,
  },
];

describe("off-structure sheet parse", () => {
  it("accepts the SOP template headers and the HR employee report aliases", () => {
    const sop = parseOffStructureSheet([
      ["Driver ID", "Driver Name", "Off Days", "Month (YYYY-MM)"],
      ["10840", "BILAL", 4, "2026-09"],
    ]);
    assert.ok("rows" in sop);
    assert.equal(sop.rows[0]?.driverKey, "10840");
    assert.equal(sop.rows[0]?.offDaysRaw, "4");

    const hr = parseOffStructureSheet([
      ["Employee Number", "Employee Name", "Number of OFFs", "Nationality (Country)"],
      ["3099", "HASSAN", 3, "Egyptian"],
    ]);
    assert.ok("rows" in hr);
    assert.equal(hr.rows[0]?.driverKey, "3099");
    assert.equal(hr.rows[0]?.offDaysRaw, "3");
  });

  it("refuses a sheet without Driver ID / Off Days", () => {
    const miss = parseOffStructureSheet([["Name", "Hours"], ["A", 12]]);
    assert.deepEqual(miss, { error: "missing_columns" });
  });
});

describe("off-structure preview", () => {
  it("matches employee_id or driver_code and reports change vs no change", () => {
    const parsed = parseOffStructureSheet([
      ["Driver ID", "Driver Name", "Off Days", "Month (YYYY-MM)"],
      ["3099", "HASSAN", 4, "2026-09"],
      ["10815", "PHILIP", 4, "2026-09"],
    ]);
    assert.ok("rows" in parsed);
    const rows = previewOffStructureRows({
      rows: parsed.rows,
      roster,
      monthKey: "2026-09",
      monthDays: 30,
    });
    assert.equal(rows[0]?.verdict, "applied");
    assert.equal(rows[0]?.driverId, "d1");
    assert.equal(rows[0]?.previousOffDays, 2);
    assert.equal(rows[1]?.verdict, "no_change");
  });

  it("rejects unknown, over-month, non-integer, duplicate and month mismatch", () => {
    const parsed = parseOffStructureSheet([
      ["Driver ID", "Off Days", "Month (YYYY-MM)"],
      ["10999", "4", "2026-09"],
      ["10840", "40", "2026-09"],
      ["10815", "4.5", "2026-09"],
      ["10840", "3", "2026-09"],
      ["10815", "3", "2026-08"],
      ["", "2", "2026-09"],
    ]);
    assert.ok("rows" in parsed);
    const rows = previewOffStructureRows({
      rows: parsed.rows,
      roster,
      monthKey: "2026-09",
      monthDays: 30,
    });
    assert.equal(rows[0]?.verdict, "unknown_id");
    assert.equal(rows[1]?.verdict, "off_days_exceeds_month");
    assert.equal(rows[2]?.verdict, "invalid_off_days");
    assert.equal(rows[3]?.verdict, "duplicate");
    assert.equal(rows[4]?.verdict, "month_mismatch");
    assert.equal(rows[5]?.verdict, "missing_id");
  });

  it("flags an ambiguous key that hits two drivers", () => {
    const clash: OffStructureRosterEntry[] = [
      ...roster,
      {
        driverId: "d3",
        name: "OTHER",
        employeeId: "10840",
        driverCode: "99999",
        offStructureDays: 2,
      },
    ];
    assert.equal(resolveOffStructureKey("10840", clash).kind, "ambiguous");
    assert.equal(parseOffDaysCell("0"), 0);
    assert.equal(parseOffDaysCell("-1"), null);
  });

  it("does not send default OFF=2 no_change rows to the apply payload", () => {
    const parsed = parseOffStructureSheet([
      ["Employee Number", "Number of OFFs"],
      ["3099", 2],
      ["10815", 3],
      ["10999", 3],
    ]);
    assert.ok("rows" in parsed);
    const rows = previewOffStructureRows({
      rows: parsed.rows,
      roster,
      monthKey: "2026-09",
      monthDays: 30,
    });
    assert.equal(rows[0]?.verdict, "no_change");
    assert.equal(rows[1]?.verdict, "applied");
    assert.equal(rows[2]?.verdict, "unknown_id");
    assert.deepEqual(offStructureRowsToApply(rows), [{ driverKey: "10815", offDays: 3 }]);
  });
});
