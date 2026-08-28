import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  trendCoverageDiff,
  trendIsComparable,
  type PerformanceComponentKey,
  type PerformanceTrendTotals,
} from "./performance-types";

function totals(
  measured: PerformanceComponentKey[],
): Pick<PerformanceTrendTotals, "components_measured"> {
  return { components_measured: measured };
}

function trend(
  now: PerformanceComponentKey[],
  prev: PerformanceComponentKey[],
) {
  return { totals: totals(now), previous_totals: totals(prev) };
}

describe("trendIsComparable", () => {
  it("accepts two halves that measured the same components", () => {
    assert.equal(
      trendIsComparable(
        trend(["punctuality", "on_time"], ["punctuality", "on_time"]),
      ),
      true,
    );
  });

  it("ignores the order the server happened to list them in", () => {
    assert.equal(
      trendIsComparable(
        trend(["on_time", "punctuality"], ["punctuality", "on_time"]),
      ),
      true,
    );
  });

  it("rejects a half that gained a component", () => {
    // The production case this exists for: fleet_events retention had pruned
    // July, so August measured speed/zone/gps and July did not. The blend
    // renormalises, so the 15.8-point "drop" was three components arriving.
    assert.equal(
      trendIsComparable(
        trend(
          ["punctuality", "duty_ratio", "on_time", "speed", "zone", "gps"],
          ["punctuality", "duty_ratio", "on_time"],
        ),
      ),
      false,
    );
  });

  it("rejects a half that lost a component", () => {
    assert.equal(
      trendIsComparable(trend(["punctuality"], ["punctuality", "gps"])),
      false,
    );
  });

  it("rejects a swap that leaves the count unchanged", () => {
    // Same length, different sets. A length-only check would pass this.
    assert.equal(trendIsComparable(trend(["speed"], ["gps"])), false);
  });

  it("treats two empty halves as comparable", () => {
    assert.equal(trendIsComparable(trend([], [])), true);
  });
});

describe("trendCoverageDiff", () => {
  it("names what appeared and what went dark", () => {
    const diff = trendCoverageDiff(
      trend(["punctuality", "speed", "zone"], ["punctuality", "conduct"]),
    );
    assert.deepEqual(diff.added, ["speed", "zone"]);
    assert.deepEqual(diff.removed, ["conduct"]);
  });

  it("reports nothing when the halves agree", () => {
    const diff = trendCoverageDiff(trend(["on_time"], ["on_time"]));
    assert.deepEqual(diff.added, []);
    assert.deepEqual(diff.removed, []);
  });

  it("orders by the canonical component order, not by arrival", () => {
    // The notice lists these to an operator, so the order has to be stable
    // across renders rather than following whatever the server aggregated first.
    const diff = trendCoverageDiff(trend(["gps", "duty_ratio", "speed"], []));
    assert.deepEqual(diff.added, ["duty_ratio", "speed", "gps"]);
  });
});
