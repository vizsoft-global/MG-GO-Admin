import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { visitHoursInvalid } from "./visit-hours";

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
