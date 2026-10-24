import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatPct, formatUnitPct, roundPercent } from "./percent";

describe("roundPercent", () => {
  it("rounds a working rate to one decimal", () => {
    assert.equal(roundPercent((110 / 958) * 100), 11.5);
  });

  it("treats a missing value as 0", () => {
    assert.equal(roundPercent(undefined), 0);
    assert.equal(roundPercent(Number.NaN), 0);
  });
});

describe("formatPct", () => {
  it("prints one decimal and a percent sign", () => {
    assert.equal(formatPct((110 / 958) * 100), "11.5%");
    assert.equal(formatPct(0), "0.0%");
    assert.equal(formatPct(100), "100.0%");
  });

  it("uses an em dash when the value is missing", () => {
    assert.equal(formatPct(null), "—");
    assert.equal(formatPct(undefined), "—");
    assert.equal(formatPct(Number.NaN), "—");
  });
});

describe("formatUnitPct", () => {
  it("multiplies a 0–1 ratio then rounds to one decimal", () => {
    assert.equal(formatUnitPct(0.11482254697286013), "11.5%");
    assert.equal(formatUnitPct(1), "100.0%");
  });
});
