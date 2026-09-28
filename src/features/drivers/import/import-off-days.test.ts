import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  importOffNeedsApprovedDriver,
  kuwaitCalendarMonthDays,
  offDaysForRpc,
  parseImportOffDays,
} from "./import-off-days";

describe("kuwaitCalendarMonthDays", () => {
  it("returns the calendar length of a Kuwait YMD", () => {
    assert.equal(kuwaitCalendarMonthDays("2026-09-28"), 30);
    assert.equal(kuwaitCalendarMonthDays("2026-02-01"), 28);
  });
});

describe("parseImportOffDays", () => {
  it("treats blank as do-not-write", () => {
    assert.deepEqual(parseImportOffDays("", 30), { offDays: null, error: null });
    assert.deepEqual(parseImportOffDays("  ", 30), { offDays: null, error: null });
    assert.deepEqual(parseImportOffDays(null, 30), { offDays: null, error: null });
  });

  it("accepts a whole number inside the month", () => {
    assert.deepEqual(parseImportOffDays("3", 30), { offDays: 3, error: null });
    assert.deepEqual(parseImportOffDays("0", 30), { offDays: 0, error: null });
  });

  it("refuses junk and a count past the month", () => {
    assert.equal(parseImportOffDays("1.5", 30).error, "invalid_off_days");
    assert.equal(parseImportOffDays("abc", 30).error, "invalid_off_days");
    assert.deepEqual(parseImportOffDays("31", 30), {
      offDays: 31,
      error: "off_days_exceeds_month",
    });
  });
});

describe("importOffNeedsApprovedDriver", () => {
  it("allows a blank OFF on a draft intake", () => {
    assert.equal(importOffNeedsApprovedDriver(null, false, false), false);
  });

  it("blocks a filled OFF unless the rider is live or will be approved", () => {
    assert.equal(importOffNeedsApprovedDriver(3, false, false), true);
    assert.equal(importOffNeedsApprovedDriver(3, true, false), false);
    assert.equal(importOffNeedsApprovedDriver(3, false, true), false);
  });
});

describe("offDaysForRpc", () => {
  it("sends null for the implicit default of 2", () => {
    assert.equal(offDaysForRpc(2), null);
    assert.equal(offDaysForRpc(3), 3);
  });
});
