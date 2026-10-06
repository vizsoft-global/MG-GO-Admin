import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dayGridLabel } from "./payroll-formulas";
import {
  EDITOR_ADJUSTMENT_STATUSES,
  particularForAdjustment,
  sortParticularValues,
} from "./payroll-particulars";
import { ADJUSTMENT_STATUSES, ADJUSTMENT_STATUS_TO_DAY } from "./payroll-rules-engine";
import { fillTargetCells, parseAdjustmentCellText } from "./payroll-snapshot";

describe("payroll particulars catalog", () => {
  it("keeps every existing adjustment status, including half as 6 Hours / Half Day", () => {
    assert.deepEqual([...EDITOR_ADJUSTMENT_STATUSES], [...ADJUSTMENT_STATUSES]);
    assert.equal(ADJUSTMENT_STATUS_TO_DAY.half, "half");
    assert.equal(particularForAdjustment("half"), "Half");
    assert.equal(dayGridLabel("half", 6), "Half");
    assert.equal(parseAdjustmentCellText("6 Hours", 0)?.status, "half");
    assert.equal(parseAdjustmentCellText("6h", 0)?.status, "half");
    assert.equal(parseAdjustmentCellText("Half", 0)?.status, "half");
    assert.equal(parseAdjustmentCellText("half day", 0)?.status, "half");
  });

  it("prints the same token the cell uses for every selectable particular", () => {
    assert.equal(particularForAdjustment("12"), "12");
    assert.equal(particularForAdjustment("3h"), "3h");
    assert.equal(particularForAdjustment("half"), "Half");
    assert.equal(particularForAdjustment("actual", 7.6), "7.6h");
    assert.equal(particularForAdjustment("off"), "OFF");
    assert.equal(particularForAdjustment("sick"), "Sick");
    assert.equal(particularForAdjustment("accident"), "Acc");
    assert.equal(particularForAdjustment("vehicle"), "Veh");
    assert.equal(particularForAdjustment("absent"), "Absent");
    assert.equal(particularForAdjustment("abs_lh"), "Abs·LH");
    assert.equal(particularForAdjustment("abs_lo"), "Abs·LO");
    assert.equal(particularForAdjustment("custom", 4), "4h");
    assert.equal(particularForAdjustment("custom", 0), "0h");
    assert.equal(particularForAdjustment("custom", 24), "24h");
  });

  it("parses cell tokens and the named particulars back to the same statuses", () => {
    assert.equal(parseAdjustmentCellText("12 Hours", 0)?.status, "12");
    assert.equal(parseAdjustmentCellText("3 Hours", 0)?.status, "3h");
    assert.equal(parseAdjustmentCellText("Acc", 0)?.status, "accident");
    assert.equal(parseAdjustmentCellText("Veh", 0)?.status, "vehicle");
    assert.equal(parseAdjustmentCellText("Abs·LH", 0)?.status, "abs_lh");
    assert.equal(parseAdjustmentCellText("Abs·LO", 0)?.status, "abs_lo");
    assert.equal(parseAdjustmentCellText("Absent Less Hours", 0)?.status, "abs_lh");
    assert.equal(parseAdjustmentCellText("Absent Less Orders", 0)?.status, "abs_lo");
    assert.equal(parseAdjustmentCellText("Actual Hours", 0)?.status, "actual");
    assert.equal(parseAdjustmentCellText("9.5h", 0)?.status, "custom");
    assert.equal(parseAdjustmentCellText("9.5h", 0)?.hours, 9.5);
    assert.equal(parseAdjustmentCellText("0h", 0)?.status, "custom");
    assert.equal(parseAdjustmentCellText("24h", 0)?.hours, 24);
    assert.equal(parseAdjustmentCellText("25h", 0), null);
  });

  it("sorts numeric particulars before words", () => {
    assert.deepEqual(sortParticularValues(["Sick", "7.6h", "Absent", "12", "3h", "OFF"]), [
      "3h",
      "7.6h",
      "12",
      "Absent",
      "OFF",
      "Sick",
    ]);
  });
});

describe("fillTargetCells", () => {
  it("fills horizontally to the right from a single cell", () => {
    assert.deepEqual(fillTargetCells({ r0: 2, c0: 3, r1: 2, c1: 3 }, 2, 6), [
      { r: 2, c: 4, srcR: 2, srcC: 3 },
      { r: 2, c: 5, srcR: 2, srcC: 3 },
      { r: 2, c: 6, srcR: 2, srcC: 3 },
    ]);
  });

  it("fills vertically downward from a single cell", () => {
    assert.deepEqual(fillTargetCells({ r0: 1, c0: 4, r1: 1, c1: 4 }, 4, 4), [
      { r: 2, c: 4, srcR: 1, srcC: 4 },
      { r: 3, c: 4, srcR: 1, srcC: 4 },
      { r: 4, c: 4, srcR: 1, srcC: 4 },
    ]);
  });
});
