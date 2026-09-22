import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compareScalars, percent, rankByCount } from "./assistant-analytics";
import { lastMonthRange, lastWeekRange } from "./assistant-dates";

describe("analytics helpers", () => {
  it("computes percentages from numerators only", () => {
    assert.equal(percent(1, 4), 25);
    assert.equal(percent(1, 3), 33.3);
    assert.equal(percent(0, 0), null);
    assert.equal(percent(2, 0), null);
  });

  it("compares two windows without inventing missing sides", () => {
    const delta = compareScalars(
      { orders: 10, riders: 4, overall_dpd: 22.5 },
      { orders: 8, riders: 4, overall_dpd: null },
    );
    assert.deepEqual(delta.orders, { current: 10, previous: 8, delta: 2 });
    assert.deepEqual(delta.riders, { current: 4, previous: 4, delta: 0 });
    assert.equal(delta.overall_dpd?.delta, null);
  });

  it("ranks complaint counts and caps the list", () => {
    const top = rankByCount(
      [
        { id: "z1", label: "Jahra", count: 2 },
        { id: "z2", label: "Hawally", count: 9 },
        { id: "z3", label: "Salmiya", count: 4 },
      ],
      2,
    );
    assert.deepEqual(
      top.map((row) => row.label),
      ["Hawally", "Salmiya"],
    );
  });

  it("keeps last_week / last_month as previous windows for compare", () => {
    assert.deepEqual(lastWeekRange("2026-09-21"), { from: "2026-09-12", to: "2026-09-18" });
    assert.deepEqual(lastMonthRange("2026-09-21"), { from: "2026-08-01", to: "2026-08-31" });
    assert.deepEqual(lastMonthRange("2026-01-05"), { from: "2025-12-01", to: "2025-12-31" });
  });
});
