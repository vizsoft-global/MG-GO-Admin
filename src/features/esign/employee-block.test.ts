import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ESIGN_EMPLOYEE_CORE_ROWS,
  ESIGN_EMPLOYEE_ROWS,
  employeeRowLabel,
  employeeSampleValues,
  isEmployeeRowKey,
} from "./employee-block";
import { EMPLOYEE_PLACEHOLDER_KEYS } from "./render/esign-placeholders";

describe("esign employee block catalogue", () => {
  it("covers every reserved placeholder key, in the reserved order", () => {
    // The block and the {{token}} list are the same set. If they were allowed to
    // drift, a token would substitute into a header while the block above it
    // showed no such row — or the reverse, which is worse because the row would
    // print empty on a signed document.
    assert.deepEqual(
      ESIGN_EMPLOYEE_ROWS.map((row) => row.key),
      [...EMPLOYEE_PLACEHOLDER_KEYS],
    );
  });

  it("gives every row an English label, an Arabic label and a sample", () => {
    for (const row of ESIGN_EMPLOYEE_ROWS) {
      assert.ok(row.label_en.trim().length > 0, `${row.key} has no English label`);
      assert.ok(row.label_ar.trim().length > 0, `${row.key} has no Arabic label`);
      assert.ok(row.sample.trim().length > 0, `${row.key} has no preview sample`);
    }
  });

  it("translates the block rather than repeating the English label", () => {
    // A row left untranslated is invisible in review and reads as a bug to the
    // Arabic reader it was meant for.
    for (const row of ESIGN_EMPLOYEE_ROWS) {
      assert.notEqual(row.label_ar, row.label_en, `${row.key} Arabic label is English`);
    }
  });

  it("keeps the first three rows as the ones a document always opens with", () => {
    assert.deepEqual(
      ESIGN_EMPLOYEE_CORE_ROWS.map((row) => row.key),
      ["company_name", "employee_name", "employee_id"],
    );
  });

  it("resolves a label per locale", () => {
    const row = ESIGN_EMPLOYEE_ROWS.find((r) => r.key === "civil_id")!;
    assert.equal(employeeRowLabel(row, "en"), row.label_en);
    assert.equal(employeeRowLabel(row, "ar"), row.label_ar);
  });

  it("hands the preview the same keys the block prints", () => {
    const samples = employeeSampleValues();
    assert.deepEqual(
      Object.keys(samples),
      ESIGN_EMPLOYEE_ROWS.map((row) => row.key),
    );
    for (const value of Object.values(samples)) {
      assert.ok(value.trim().length > 0);
    }
  });

  it("recognises its own keys and nothing else", () => {
    assert.equal(isEmployeeRowKey("civil_id"), true);
    assert.equal(isEmployeeRowKey("penalty_details"), false);
    assert.equal(isEmployeeRowKey(""), false);
  });
});
