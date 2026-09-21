import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lunchBreakOutsideHours, visitHoursInvalid } from "./visit-hours";

describe("visitHoursInvalid", () => {
  it("is false when either time is empty", () => {
    assert.equal(visitHoursInvalid("", "17:00"), false);
    assert.equal(visitHoursInvalid("09:00", ""), false);
    assert.equal(visitHoursInvalid(null, "17:00"), false);
  });

  it("is true when closing is the same as or before opening", () => {
    assert.equal(visitHoursInvalid("09:00", "09:00"), true);
    assert.equal(visitHoursInvalid("17:00", "09:00"), true);
  });

  it("is false when closing is after opening", () => {
    assert.equal(visitHoursInvalid("09:00", "17:00"), false);
  });
});

describe("lunchBreakOutsideHours", () => {
  it("is false when lunch is missing or fully inside hours", () => {
    assert.equal(lunchBreakOutsideHours("09:00", "17:00", null, "12:00"), false);
    assert.equal(lunchBreakOutsideHours("09:00", "17:00", "12:00", "13:00"), false);
    assert.equal(lunchBreakOutsideHours("09:00", "17:00", "09:00", "17:00"), false);
  });

  it("is true when lunch starts before open or ends after close", () => {
    assert.equal(lunchBreakOutsideHours("09:00", "17:00", "18:00", "19:00"), true);
    assert.equal(lunchBreakOutsideHours("09:00", "17:00", "08:00", "09:00"), true);
    assert.equal(lunchBreakOutsideHours("09:00", "17:00", "16:00", "18:00"), true);
  });
});
