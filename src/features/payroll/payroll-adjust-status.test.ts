import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ADJUSTMENT_STATUSES } from "./payroll-rules-engine";
import { EDITOR_ADJUSTMENT_STATUSES as picker } from "./payroll-particulars";
import { normalizeAdjustmentStatus } from "../../../functions/src/rpcs/payroll-adjustment-status";

/**
 * `adminApplyPayrollAdjustments` refused `absent` because its own list had
 * stopped at the SOP short code `abs`, so picking ABS (or Cancel, Leave, Term,
 * Phone, ID Susp, New hire, Training) toasted "Something went wrong. The
 * adjustment was not saved." This locks the two vocabularies together.
 */
describe("payroll adjustment status contract", () => {
  it("lets the write path accept every day type the grid can send", () => {
    for (const status of ADJUSTMENT_STATUSES) {
      assert.equal(
        normalizeAdjustmentStatus(status),
        status,
        `adminApplyPayrollAdjustments must accept "${status}"`,
      );
    }
  });

  it("covers the picker, which is what the dialog clicks", () => {
    for (const status of picker) {
      assert.equal(normalizeAdjustmentStatus(status), status);
    }
  });

  it("still reads a stored SOP short code", () => {
    assert.equal(normalizeAdjustmentStatus("abs"), "absent");
    assert.equal(normalizeAdjustmentStatus("alh"), "abs_lh");
    assert.equal(normalizeAdjustmentStatus("cus"), "custom");
  });

  it("keeps Automatic result writable, because it is the revert", () => {
    assert.ok((ADJUSTMENT_STATUSES as readonly string[]).includes("auto"));
    assert.equal(normalizeAdjustmentStatus("auto"), "auto");
  });

  it("refuses a day type neither side knows", () => {
    assert.equal(normalizeAdjustmentStatus("holiday"), null);
  });
});
