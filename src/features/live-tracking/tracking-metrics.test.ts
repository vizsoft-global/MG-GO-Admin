import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatBatteryLevel,
  formatSpeedKmh,
  isGpsHeartbeatStale,
  isOverspeeding,
  liveZoneStatus,
  normalizeBatteryPct,
  OVERSPEED_KMH,
} from "./tracking-metrics";

const NOW = Date.parse("2026-08-13T12:00:00.000Z");

describe("normalizeBatteryPct", () => {
  it("passes through 0–100 percents", () => {
    assert.equal(normalizeBatteryPct(15), 15);
    assert.equal(normalizeBatteryPct(3), 3);
    assert.equal(normalizeBatteryPct(100), 100);
  });

  it("treats exclusive (0, 1) fractions as a 0–100 scale", () => {
    assert.equal(normalizeBatteryPct(0.15), 15);
    assert.equal(normalizeBatteryPct(0.03), 3);
  });

  it("does not treat 1% as 100%", () => {
    assert.equal(normalizeBatteryPct(1), 1);
  });
});

describe("formatBatteryLevel", () => {
  it("renders a normalized percent", () => {
    assert.equal(formatBatteryLevel(15), "15%");
    assert.equal(formatBatteryLevel(0.15), "15%");
  });
});

describe("liveZoneStatus", () => {
  it("hides last-known In Zone when GPS is stale", () => {
    const stale = new Date(NOW - 9 * 60_000).toISOString();
    assert.equal(liveZoneStatus("in_zone", stale, NOW), "unknown");
  });

  it("keeps In Zone while GPS is live", () => {
    const fresh = new Date(NOW - 10_000).toISOString();
    assert.equal(liveZoneStatus("in_zone", fresh, NOW), "in_zone");
  });
});

describe("formatSpeedKmh", () => {
  it("treats GPS rest jitter below 1.5 m/s as 0 like the driver app", () => {
    assert.equal(formatSpeedKmh(3.8 / 3.6), "0 km/h");
    assert.equal(formatSpeedKmh(1.0 / 3.6), "0 km/h");
  });

  it("shows real riding speed", () => {
    assert.equal(formatSpeedKmh(20 / 3.6), "20 km/h");
  });
});

describe("isOverspeeding", () => {
  it("counts a rider above the fleet speed limit", () => {
    assert.equal(OVERSPEED_KMH, 60);
    assert.equal(isOverspeeding(61 / 3.6), true);
    assert.equal(isOverspeeding(40 / 3.6), false);
    assert.equal(isOverspeeding(null), false);
  });
});

describe("isGpsHeartbeatStale", () => {
  it("flags GPS Offline after heartbeats stop (~90s), not after 8 minutes", () => {
    const twoMin = new Date(NOW - 2 * 60_000).toISOString();
    const thirtySec = new Date(NOW - 30_000).toISOString();
    assert.equal(isGpsHeartbeatStale(twoMin, NOW), true);
    assert.equal(isGpsHeartbeatStale(thirtySec, NOW), false);
  });
});
