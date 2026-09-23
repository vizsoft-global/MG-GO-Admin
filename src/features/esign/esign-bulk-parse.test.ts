import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseEsignBulkRows } from "./esign-bulk-parse";

describe("parseEsignBulkRows", () => {
  it("maps Employee ID and category fields", () => {
    const parsed = parseEsignBulkRows(
      ["Employee ID", "Description", "penalty_amount"],
      [
        ["4001", "Late", "5"],
        ["4002", "", ""],
      ],
      ["penalty_amount"],
    );
    assert.equal(parsed.error, undefined);
    assert.equal(parsed.rows.length, 2);
    assert.equal(parsed.rows[0]?.employee_id, "4001");
    assert.equal(parsed.rows[0]?.description, "Late");
    assert.equal(parsed.rows[0]?.field_values.penalty_amount, "5");
    assert.equal(parsed.rows[1]?.employee_id, "4002");
  });

  it("rejects a sheet without Employee ID", () => {
    const parsed = parseEsignBulkRows(["Name"], [["Ada"]], []);
    assert.equal(parsed.error, "missing_employee_id");
  });

  it("accepts Arabic employee-id header", () => {
    const parsed = parseEsignBulkRows(["رقم الموظف"], [["4001"]], []);
    assert.equal(parsed.rows[0]?.employee_id, "4001");
  });
});
