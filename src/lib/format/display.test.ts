import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { displayOrDash, formatDisplayDate, formatDisplayPct, formatDisplayRange, formatDisplayTime } from "./display";

describe("formatDisplayDate", () => {
  it("prints a Kuwait calendar date", () => {
    assert.equal(formatDisplayDate("2026-11-01T12:00:00Z"), "01 Nov 2026");
  });

  it("prints an em dash for an empty value", () => {
    assert.equal(formatDisplayDate(null), "\u2014");
    assert.equal(formatDisplayDate("not-a-date"), "\u2014");
  });
});

describe("formatDisplayRange", () => {
  it("joins the two days with an en dash and drops the year", () => {
    assert.equal(formatDisplayRange("2026-10-26T12:00:00Z", "2026-11-01T12:00:00Z"), "26 Oct \u2013 01 Nov");
  });
});

describe("formatDisplayTime", () => {
  it("prints 24-hour Kuwait time", () => {
    assert.equal(formatDisplayTime("2026-11-01T09:30:00Z"), "12:30");
  });
});

describe("formatDisplayPct", () => {
  it("reuses one-decimal percent formatting", () => {
    assert.equal(formatDisplayPct(11.482), "11.5%");
    assert.equal(formatDisplayPct(null), "\u2014");
  });
});

describe("displayOrDash", () => {
  it("keeps a real value and dashes a blank", () => {
    assert.equal(displayOrDash("Keeta"), "Keeta");
    assert.equal(displayOrDash("  "), "\u2014");
    assert.equal(displayOrDash(0), "0");
  });
});
