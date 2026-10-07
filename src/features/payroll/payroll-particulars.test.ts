import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dayDisplayHours, dayGridLabel } from "./payroll-formulas";
import {
  EDITOR_ADJUSTMENT_STATUSES,
  particularForAdjustment,
  sortParticularValues,
} from "./payroll-particulars";
import { ADJUSTMENT_STATUSES, ADJUSTMENT_STATUS_TO_DAY } from "./payroll-rules-engine";
import {
  fillTargetCells,
  hoursForAdjustmentChoice,
  parseAdjustmentCellText,
  visibleFillTargets,
} from "./payroll-snapshot";

describe("payroll particulars catalog", () => {
  it("keeps every existing adjustment status, including half as 6 Hours / Half Day", () => {
    assert.deepEqual([...EDITOR_ADJUSTMENT_STATUSES], [...ADJUSTMENT_STATUSES]);
    assert.equal(ADJUSTMENT_STATUS_TO_DAY.half, "half");
    assert.equal(particularForAdjustment("half"), "6h");
    assert.equal(dayGridLabel("half", 6), "6h");
    assert.equal(parseAdjustmentCellText("6 Hours", 0)?.status, "half");
    assert.equal(parseAdjustmentCellText("6h", 0)?.status, "half");
    assert.equal(parseAdjustmentCellText("Half", 0)?.status, "half");
    assert.equal(parseAdjustmentCellText("half day", 0)?.status, "half");
  });

  it("prints the same token the cell uses for every selectable particular", () => {
    assert.equal(particularForAdjustment("12"), "12h");
    assert.equal(particularForAdjustment("3h"), "3h");
    assert.equal(particularForAdjustment("half"), "6h");
    assert.equal(particularForAdjustment("actual", 7.6), "7.6h");
    assert.equal(particularForAdjustment("off"), "OFF");
    assert.equal(particularForAdjustment("sick"), "Sick");
    assert.equal(particularForAdjustment("accident"), "Acc");
    assert.equal(particularForAdjustment("vehicle"), "Veh");
    assert.equal(particularForAdjustment("absent"), "ABS");
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
    assert.deepEqual(sortParticularValues(["Sick", "7.6h", "ABS", "12h", "3h", "OFF"]), [
      "3h",
      "7.6h",
      "12h",
      "ABS",
      "OFF",
      "Sick",
    ]);
  });

  it("prints the rule credit on PAYROLL and leaves logged hours off that token", () => {
    const hours = dayDisplayHours("work", { loggedHours: 23.8, elapsedHours: 23.8, creditedHours: 12 });
    assert.equal(hours, 12);
    assert.equal(dayGridLabel("work", hours), "12h");
    assert.equal(dayGridLabel("reduced3", 3), "3h");
    assert.equal(dayGridLabel("absent", 0), "ABS");
    assert.equal(dayGridLabel("off", 0), "OFF");
  });

  it("rounds a custom credit to one decimal so cell, filter and Excel agree", () => {
    assert.equal(dayGridLabel("custom", 4.25), "4.3h");
    assert.equal(dayGridLabel("custom", 9), "9h");
    assert.equal(dayGridLabel("actual", 7.75), "7.8h");
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

  it("fills left and up without rewriting the source cell", () => {
    assert.deepEqual(fillTargetCells({ r0: 2, c0: 3, r1: 2, c1: 3 }, 2, 1), [
      { r: 2, c: 1, srcR: 2, srcC: 3 },
      { r: 2, c: 2, srcR: 2, srcC: 3 },
    ]);
    assert.deepEqual(fillTargetCells({ r0: 3, c0: 2, r1: 3, c1: 2 }, 1, 2), [
      { r: 1, c: 2, srcR: 3, srcC: 2 },
      { r: 2, c: 2, srcR: 3, srcC: 2 },
    ]);
  });

  it("drops fill targets whose row left the visible set", () => {
    const targets = fillTargetCells({ r0: 0, c0: 0, r1: 0, c1: 0 }, 2, 0);
    const kept = visibleFillTargets(targets, ["a", "b", "c"], new Set(["a", "c"]));
    assert.deepEqual(
      kept.map((cell) => cell.r),
      [2],
    );
  });
});

describe("hoursForAdjustmentChoice", () => {
  it("stores null hours for a fixed status even when the cell text parsed as hours", () => {
    assert.equal(hoursForAdjustmentChoice("12", 7.2, 0), null);
    assert.equal(hoursForAdjustmentChoice("half", 7.2, 0), null);
    assert.equal(hoursForAdjustmentChoice("absent", 7.2, 0), null);
    assert.equal(hoursForAdjustmentChoice("custom", null, 4.5), 4.5);
    assert.equal(hoursForAdjustmentChoice("actual", 7.2, 0), 7.2);
    // A cell whose hours key was never written reads as "unknown", which is the
    // same fact as null: the actual-hours choice must not invent a number.
    assert.equal(hoursForAdjustmentChoice("actual", undefined, 0), null);
  });
});
