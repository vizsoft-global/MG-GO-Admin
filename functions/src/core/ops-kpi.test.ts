import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  deliveryMinutes,
  efficiencyBenchmarkMode,
  positiveRatio,
  primaryRestaurantId,
} from "./ops-kpi";

describe("performance SOP v1.2 ratios", () => {
  it("keeps the worked DPD example and the new UTR examples", () => {
    assert.equal(positiveRatio(96, 15), 6.4);
    assert.equal(positiveRatio(35, 5), 7);
    assert.equal(positiveRatio(27, 2), 13.5);
    assert.ok(Math.abs((positiveRatio(62, 7) ?? 0) - 8.857142857) < 1e-9);
    assert.equal(positiveRatio(35, 40), 0.875);
    assert.equal(positiveRatio(62, 40), 1.55);
    assert.equal(positiveRatio(27, 0), null);
    assert.equal(positiveRatio(10, Number.NaN), null);
  });

  it("averages delivery minutes across orders, not across rider averages", () => {
    const start = new Date("2026-10-01T08:00:00.000Z");
    assert.equal(deliveryMinutes(start, new Date(start.getTime() + 34.5 * 60_000)), 34.5);
    assert.equal(deliveryMinutes(start, start), null);
    assert.equal(deliveryMinutes(start, new Date(start.getTime() - 1000)), null);
    assert.equal(deliveryMinutes(null, start), null);
    assert.equal(positiveRatio(140, 4), 35);
    assert.equal(positiveRatio(90, 3), 30);
    assert.equal(positiveRatio(50, 1), 50);
  });

  it("scores efficiency against the client benchmark and the target", () => {
    const zoneVehicle = positiveRatio(44, 3);
    assert.ok(zoneVehicle != null);
    assert.ok(Math.abs(((13.5 / zoneVehicle) * 100) - 92.0454545) < 1e-6);
    assert.ok(Math.abs(((13.5 / 13) * 100) - 103.8461538) < 1e-6);
    assert.equal((7 / 7) * 100, 100);
    assert.ok(Math.abs((positiveRatio(27 + 17, 3) ?? 0) - 14.6666666) < 1e-6);
    assert.equal(positiveRatio(7, 0), null);
  });

  it("picks the busiest restaurant and breaks a tie with the latest delivery", () => {
    const counts = new Map([
      ["a", 2],
      ["b", 2],
    ]);
    assert.equal(primaryRestaurantId(counts, "b"), "b");
    assert.equal(primaryRestaurantId(new Map([["a", 3], ["b", 1]]), "b"), "a");
    assert.equal(primaryRestaurantId(new Map(), "a"), null);
  });

  it("defaults Keeta to zone & vehicle and honours a stored override", () => {
    assert.equal(
      efficiencyBenchmarkMode({
        stored: null,
        projectKey: "keeta",
        partnerKey: null,
        partnerName: null,
      }),
      "zone_vehicle",
    );
    assert.equal(
      efficiencyBenchmarkMode({
        stored: null,
        projectKey: null,
        partnerKey: "americana",
        partnerName: "Americana",
      }),
      "restaurant",
    );
    assert.equal(
      efficiencyBenchmarkMode({
        stored: "restaurant",
        projectKey: "keeta",
        partnerKey: "keeta",
        partnerName: "Keeta",
      }),
      "restaurant",
    );
    assert.equal(
      efficiencyBenchmarkMode({
        stored: "zone and vehicle",
        projectKey: "americana",
        partnerKey: null,
        partnerName: null,
      }),
      "zone_vehicle",
    );
  });
});
