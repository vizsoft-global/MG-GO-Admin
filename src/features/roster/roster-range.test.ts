import assert from "node:assert/strict";
import test from "node:test";
import { clock12, formatRangeLabel, kuwaitWeekStart, rangeForPreset } from "./roster-range";

test("Kuwait week starts Saturday", () => {
  assert.equal(kuwaitWeekStart("2026-10-27"), "2026-10-24");
  assert.equal(kuwaitWeekStart("2026-10-24"), "2026-10-24");
  assert.equal(kuwaitWeekStart("2026-10-23"), "2026-10-17");
});

test("last week of 2026-10-27 is 17–23 Oct", () => {
  const range = rangeForPreset("lastWeek", "2026-10-27");
  assert.equal(range.from, "2026-10-17");
  assert.equal(range.to, "2026-10-23");
  assert.equal(formatRangeLabel(range.from, range.to, "en"), "17–23 Oct 2026");
});

test("clock12 formats H:MM AM/PM", () => {
  assert.equal(clock12("15:00:00"), "3:00 PM");
  assert.equal(clock12("00:00:00"), "12:00 AM");
  assert.equal(clock12("12:30"), "12:30 PM");
});
