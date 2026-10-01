import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  averageDpd,
  categoryForZone,
  computeZoneMetric,
  computeZoneMetrics,
  formatDpd,
  formatZonePct,
  resolveCategory,
  type ZoneMetricInput,
} from "./payroll-zone-metrics";

const zone = (zoneId: string, orders: number, riderDays: number, zoneName = zoneId) => ({
  zoneId,
  zoneName,
  orders,
  riderDays,
});

describe("DPD and target DPD", () => {
  it("is orders divided by rider days", () => {
    const metric = computeZoneMetric(zone("salmiya", 300, 30), 10);
    assert.equal(metric.dpd, 10);
    assert.equal(metric.riderDays, 30);
    assert.equal(metric.orders, 300);
  });

  it("rounds to four decimals so a stored value round-trips", () => {
    const metric = computeZoneMetric(zone("salmiya", 100, 3), null);
    assert.equal(metric.dpd, 33.3333);
  });

  it("is null when the zone had no rider days, never a division by zero", () => {
    const metric = computeZoneMetric(zone("jahra", 0, 0), 10);
    assert.equal(metric.dpd, null);
    assert.equal(metric.efficiency, null);
  });

  it("averages only the zones that actually had rider days", () => {
    // Including an empty zone as 0 would drag the target down and band every
    // working zone Good. This is the rule the whole banding rests on.
    const target = averageDpd([zone("salmiya", 200, 20), zone("jahra", 0, 0), zone("farwaniya", 100, 10)]);
    assert.equal(target, 10);
  });

  it("returns null when nothing was worked", () => {
    assert.equal(averageDpd([zone("jahra", 0, 0)]), null);
    assert.equal(averageDpd([]), null);
  });
});

describe("zone efficiency banding", () => {
  it("is DPD over target DPD as a percentage", () => {
    // target 10, this zone at 12 → 120%
    const rows = [zone("salmiya", 120, 10), zone("jahra", 80, 10)];
    const metrics = computeZoneMetrics(rows);
    const salmiya = metrics.find((m) => m.zoneId === "salmiya");
    const jahra = metrics.find((m) => m.zoneId === "jahra");
    assert.equal(salmiya?.targetDpd, 10);
    assert.equal(salmiya?.efficiency, 120);
    assert.equal(salmiya?.categoryAuto, "good");
    assert.equal(jahra?.efficiency, 80);
    assert.equal(jahra?.categoryAuto, "average");
  });

  it("bands at exactly 110 and 70, per the SOP", () => {
    const rows = [zone("a", 110, 10), zone("b", 70, 10), zone("c", 60, 10), zone("d", 100, 10)];
    const metrics = computeZoneMetrics(rows);
    const byId = new Map(metrics.map((m) => [m.zoneId, m]));
    // Target is the average of 11, 7, 6 and 10 DPD = 8.5
    assert.equal(byId.get("d")?.targetDpd, 8.5);
    assert.equal(byId.get("d")?.efficiency, 117.6471); // 10 / 8.5
    assert.equal(byId.get("d")?.categoryAuto, "good");
    // 6 DPD against 8.5 is 70.588% — at or above 70, so Average, not Low.
    assert.equal(byId.get("c")?.efficiency, 70.5882);
    assert.equal(byId.get("c")?.categoryAuto, "average");

    // Both thresholds are inclusive: exactly 110 is Good, exactly 70 is
    // Average, and anything under 70 is Low.
    assert.equal(computeZoneMetric(zone("e", 110, 10), 10).categoryAuto, "good");
    assert.equal(computeZoneMetric(zone("f", 70, 10), 10).categoryAuto, "average");
    assert.equal(computeZoneMetric(zone("g", 69, 10), 10).categoryAuto, "low");
  });

  it("never divides by a zero or negative target", () => {
    assert.equal(computeZoneMetric(zone("a", 50, 10), 0).efficiency, null);
    assert.equal(computeZoneMetric(zone("a", 50, 10), -3).efficiency, null);
    assert.equal(computeZoneMetric(zone("a", 50, 10), null).efficiency, null);
  });
});

describe("overrides beat the automatic band", () => {
  const rows = [zone("salmiya", 120, 10), zone("jahra", 80, 10)];

  it("uses an overridden DPD and target for the efficiency", () => {
    const overrides = new Map<string, Partial<ZoneMetricInput>>([
      ["jahra", { dpdUsed: 9, targetDpdUsed: 9 }],
    ]);
    const metrics = computeZoneMetrics(rows, overrides);
    const jahra = metrics.find((m) => m.zoneId === "jahra");
    assert.equal(jahra?.dpd, 8);
    assert.equal(jahra?.dpdValue, 9);
    assert.equal(jahra?.efficiency, 100);
  });

  it("lets Ops force a category and keeps the automatic one visible", () => {
    const overrides = new Map<string, Partial<ZoneMetricInput>>([
      ["jahra", { categoryOverride: "good" }],
    ]);
    const metrics = computeZoneMetrics(rows, overrides);
    const jahra = metrics.find((m) => m.zoneId === "jahra");
    assert.equal(jahra?.categoryAuto, "average");
    assert.equal(jahra?.categoryOverride, "good");
    assert.equal(jahra?.category, "good");
    assert.equal(resolveCategory(jahra!), "good");
  });

  it("honours a client's own thresholds when banding", () => {
    const rows = [zone("a", 100, 10)];
    const metrics = computeZoneMetrics(rows, new Map([["a", { goodThreshold: 100, averageThreshold: 50 }]]));
    assert.equal(metrics[0].efficiency, 100);
    assert.equal(metrics[0].categoryAuto, "good");
  });

  it("resets an override by passing null", () => {
    const overrides = new Map<string, Partial<ZoneMetricInput>>([
      ["jahra", { categoryOverride: null, dpdUsed: null, targetDpdUsed: null }],
    ]);
    const metrics = computeZoneMetrics(rows, overrides);
    const jahra = metrics.find((m) => m.zoneId === "jahra");
    assert.equal(jahra?.category, "average");
    assert.equal(jahra?.dpdValue, 8);
  });
});

describe("category for a rider's day", () => {
  const metrics = computeZoneMetrics([zone("salmiya", 120, 10), zone("jahra", 80, 10)]);

  it("resolves a measured zone to its band", () => {
    assert.equal(categoryForZone(metrics, "salmiya"), "good");
    assert.equal(categoryForZone(metrics, "jahra"), "average");
  });

  it("is not_set for an unmeasured zone or no zone at all", () => {
    // Absence must not read as Low: an unmeasured zone has not been judged, and
    // the seeded rules only match low / good / average.
    assert.equal(categoryForZone(metrics, "nowhere"), "not_set");
    assert.equal(categoryForZone(metrics, null), "not_set");
    assert.equal(categoryForZone(metrics, undefined), "not_set");
    assert.equal(categoryForZone([], "salmiya"), "not_set");
  });

  it("prefers an Ops category override", () => {
    const overridden = computeZoneMetrics(
      [zone("jahra", 80, 10)],
      new Map([["jahra", { categoryOverride: "low" as const }]]),
    );
    assert.equal(categoryForZone(overridden, "jahra"), "low");
  });
});

describe("formatting", () => {
  it("prints an em dash rather than a zero for a missing figure", () => {
    assert.equal(formatDpd(null), "—");
    assert.equal(formatDpd(9.6), "9.60");
    assert.equal(formatDpd(9.6123, 1), "9.6");
    assert.equal(formatZonePct(null), "—");
    assert.equal(formatZonePct(117.6471), "117.6%");
  });
});
