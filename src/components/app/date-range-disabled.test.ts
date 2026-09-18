import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dateRangeDisabledAfter } from "./date-range-disabled";

describe("dateRangeDisabledAfter", () => {
  it("keeps the today cap when allowFutureDates is omitted or false", () => {
    const disabled = dateRangeDisabledAfter();
    assert.ok(disabled);
    assert.ok(disabled.after instanceof Date);
    const explicit = dateRangeDisabledAfter(false);
    assert.ok(explicit);
    assert.ok(explicit.after instanceof Date);
  });

  it("does not cap future dates when allowFutureDates is true (All Visits only)", () => {
    assert.equal(dateRangeDisabledAfter(true), undefined);
  });
});
