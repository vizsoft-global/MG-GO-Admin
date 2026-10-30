import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ADJUSTMENT_STATUSES,
  adjustmentStatusCode,
  normalizeAdjustmentStatus,
} from "./payroll-adjustment-status";

describe("normalizeAdjustmentStatus", () => {
  it("accepts every day type the payroll picker offers", () => {
    // Mirrors src/features/payroll/payroll-rules-engine.ts ADJUSTMENT_STATUSES.
    for (const status of [
      "auto",
      "12",
      "3h",
      "half",
      "actual",
      "off",
      "absent",
      "abs_lh",
      "abs_lo",
      "sick",
      "accident",
      "vehicle",
      "custom",
      "cancelled",
      "leave",
      "terminated",
      "phone_issue",
      "id_suspended",
      "new_hire",
      "training",
    ]) {
      assert.equal(normalizeAdjustmentStatus(status), status);
    }
  });

  it("keeps the SOP short codes readable as the word the grid prints", () => {
    assert.equal(normalizeAdjustmentStatus("abs"), "absent");
    assert.equal(normalizeAdjustmentStatus("alh"), "abs_lh");
    assert.equal(normalizeAdjustmentStatus("alo"), "abs_lo");
    assert.equal(normalizeAdjustmentStatus("act"), "actual");
    assert.equal(normalizeAdjustmentStatus("cus"), "custom");
    assert.equal(normalizeAdjustmentStatus("vehicle_issue"), "vehicle");
  });

  it("trims and lowercases what a cell carries", () => {
    assert.equal(normalizeAdjustmentStatus("  ABSent "), "absent");
    assert.equal(normalizeAdjustmentStatus("OFF"), "off");
  });

  it("refuses a day type nobody offers", () => {
    assert.equal(normalizeAdjustmentStatus("holiday"), null);
    assert.equal(normalizeAdjustmentStatus(""), null);
    assert.equal(normalizeAdjustmentStatus(undefined), null);
    assert.equal(normalizeAdjustmentStatus(7), null);
  });

  it("prints the refused code in the refusal", () => {
    assert.equal(adjustmentStatusCode(" HOLIDAY "), "holiday");
    assert.equal(adjustmentStatusCode(null), "");
  });

  it("lists each day type once", () => {
    assert.equal(new Set(ADJUSTMENT_STATUSES).size, ADJUSTMENT_STATUSES.length);
  });
});
