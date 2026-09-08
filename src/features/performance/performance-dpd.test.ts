import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  dpdEfficiency,
  dpdRiderRate,
  formatUncappedPct,
  rankByDpdRider,
  rankByEfficiency,
} from "./performance-dpd-formulas";
import type { DpdEfficiencyRider } from "./performance-types";

function rider(
  overrides: Partial<DpdEfficiencyRider> = {},
): DpdEfficiencyRider {
  return {
    driver_id: "d1",
    driver_name: "A",
    employee_id: "4001",
    driver_code: "10001",
    restaurant_id: null,
    restaurant_name: null,
    zone_id: null,
    zone_name: null,
    actual: 0,
    target: null,
    efficiency: null,
    dpd_rider: null,
    worked_days: 0,
    ...overrides,
  };
}

describe("dpd efficiency", () => {
  it("is uncapped actual / target", () => {
    const ratio = dpdEfficiency(124.3, 100);
    assert.ok(ratio != null && Math.abs(ratio - 1.243) < 1e-12);
    assert.equal(formatUncappedPct(1.243), "124.3%");
  });

  it("returns null for a missing or zero target", () => {
    assert.equal(dpdEfficiency(10, null), null);
    assert.equal(dpdEfficiency(10, 0), null);
    assert.equal(dpdEfficiency(10, -2), null);
  });
});

describe("dpd rider", () => {
  it("is actual / worked days when the rider worked", () => {
    assert.equal(dpdRiderRate(30, 5), 6);
  });

  it("is null when worked days is zero", () => {
    assert.equal(dpdRiderRate(12, 0), null);
    assert.equal(dpdRiderRate(12, null), null);
  });
});

describe("ranking", () => {
  const rows = [
    rider({
      driver_id: "over",
      actual: 124,
      target: 100,
      efficiency: 1.24,
      worked_days: 5,
      dpd_rider: 24.8,
    }),
    rider({
      driver_id: "mid",
      actual: 80,
      target: 100,
      efficiency: 0.8,
      worked_days: 4,
      dpd_rider: 20,
    }),
    rider({
      driver_id: "tie-more",
      actual: 90,
      target: 100,
      efficiency: 0.9,
      worked_days: 5,
      dpd_rider: 18,
    }),
    rider({
      driver_id: "tie-less",
      actual: 45,
      target: 50,
      efficiency: 0.9,
      worked_days: 5,
      dpd_rider: 9,
    }),
    rider({
      driver_id: "no-target",
      actual: 200,
      target: null,
      efficiency: null,
      worked_days: 6,
      dpd_rider: 200 / 6,
    }),
    rider({
      driver_id: "zero-days",
      actual: 8,
      target: 10,
      efficiency: 0.8,
      worked_days: 0,
      dpd_rider: null,
    }),
  ];

  it("excludes null targets from efficiency ranking and breaks ties on actuals", () => {
    const top = rankByEfficiency(rows, "desc", 10);
    assert.deepEqual(
      top.map((r) => r.driver_id),
      ["over", "tie-more", "tie-less", "mid", "zero-days"],
    );
  });

  it("excludes zero worked days from DPD Rider ranking", () => {
    const top = rankByDpdRider(rows, "desc", 10);
    assert.ok(top.every((r) => r.driver_id !== "zero-days"));
    assert.equal(top[0]?.driver_id, "no-target");
  });
});
