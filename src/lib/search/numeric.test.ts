import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { matchesColumnFilter } from "@/features/payroll/payroll-column-filter-match";
import { numericInRange, parseNumericText } from "./numeric";

describe("reading a printed figure", () => {
  it("reads a bare number", () => {
    assert.equal(parseNumericText("156.462"), 156.462);
    assert.equal(parseNumericText("0"), 0);
    assert.equal(parseNumericText(42), 42);
  });

  it("drops a currency label", () => {
    assert.equal(parseNumericText("30 KWD"), 30);
    assert.equal(parseNumericText("1,234.50 KWD"), 1234.5);
  });

  it("drops a percent sign without dividing", () => {
    // The panel prints 22.4%, not 0.224 — the Range bound the operator types is
    // the number on the screen.
    assert.equal(parseNumericText("22.4%"), 22.4);
    assert.equal(parseNumericText("87.1 %"), 87.1);
  });

  it("drops an hours suffix", () => {
    assert.equal(parseNumericText("12 h"), 12);
    assert.equal(parseNumericText("8.25h"), 8.25);
  });

  it("handles thousands separators", () => {
    assert.equal(parseNumericText("1,234"), 1234);
    assert.equal(parseNumericText("12,345.67"), 12345.67);
  });

  it("keeps a sign", () => {
    assert.equal(parseNumericText("-5 h"), -5);
    assert.equal(parseNumericText("-0.75"), -0.75);
  });

  it("answers null for a placeholder, not zero", () => {
    for (const blank of ["", "   ", "—", "–", "-", "_", "...", null, undefined]) {
      assert.equal(parseNumericText(blank), null, `${String(blank)} must not read as 0`);
    }
  });

  it("answers null for text with no figure in it", () => {
    assert.equal(parseNumericText("OFF"), null);
    assert.equal(parseNumericText("Awaiting approval"), null);
    assert.equal(parseNumericText("NaN"), null);
  });
});

describe("inclusive range", () => {
  it("includes both bounds", () => {
    assert.equal(numericInRange("10", 10, 20), true);
    assert.equal(numericInRange("20", 10, 20), true);
    assert.equal(numericInRange("15", 10, 20), true);
    assert.equal(numericInRange("9.99", 10, 20), false);
    assert.equal(numericInRange("20.01", 10, 20), false);
  });

  it("leaves an absent bound open", () => {
    assert.equal(numericInRange("999", 10, null), true);
    assert.equal(numericInRange("1", null, 20), true);
    assert.equal(numericInRange("1", 10, null), false);
  });

  it("accepts a formatted cell", () => {
    assert.equal(numericInRange("30 KWD", 25, 35), true);
    assert.equal(numericInRange("22.4%", 20, 25), true);
    assert.equal(numericInRange("12 h", null, 8), false);
  });

  it("excludes an unreadable cell rather than scoring it zero", () => {
    assert.equal(numericInRange("—", 0, 100), false);
    assert.equal(numericInRange("OFF", 0, 100), false);
  });
});

describe("range filters reach formatted payroll columns", () => {
  it("narrows a money column on the printed figure", () => {
    const filter = { kind: "range" as const, min: 100, max: 500 };
    assert.equal(matchesColumnFilter("30 KWD", filter), false);
    assert.equal(matchesColumnFilter("250 KWD", filter), true);
    assert.equal(matchesColumnFilter("500 KWD", filter), true);
    assert.equal(matchesColumnFilter("501 KWD", filter), false);
  });

  it("narrows an hours column and a percentage column", () => {
    assert.equal(matchesColumnFilter("12 h", { kind: "range", min: 10, max: null }), true);
    assert.equal(matchesColumnFilter("8 h", { kind: "range", min: 10, max: null }), false);
    assert.equal(matchesColumnFilter("22.4%", { kind: "range", min: null, max: 25 }), true);
    assert.equal(matchesColumnFilter("87.1%", { kind: "range", min: null, max: 25 }), false);
  });

  it("keeps working on a raw number", () => {
    assert.equal(matchesColumnFilter(13, { kind: "range", min: 10, max: 20 }), true);
    assert.equal(matchesColumnFilter(9, { kind: "range", min: 10, max: 20 }), false);
  });

  it("restores the full column when the range is cleared", () => {
    assert.equal(matchesColumnFilter("30 KWD", null), true);
    assert.equal(matchesColumnFilter("—", null), true);
  });
});
