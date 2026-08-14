import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  FLEET_MAX_EXTRAPOLATE_MS,
  FLEET_RENDER_DELAY_MS,
  FleetInterpolator,
} from "./fleet-interpolator";

const T0 = 1_000_000;

function sample(overrides: Partial<Parameters<FleetInterpolator["push"]>[1]> = {}) {
  return {
    lat: 29.37,
    lng: 47.98,
    headingDeg: 0,
    speedMps: 0,
    tMs: T0,
    ...overrides,
  };
}

describe("FleetInterpolator", () => {
  it("returns null for an unknown driver", () => {
    assert.equal(new FleetInterpolator().sample("nobody", T0), null);
  });

  it("holds the only known fix instead of guessing", () => {
    const interpolator = new FleetInterpolator();
    interpolator.push("d1", sample({ lat: 29.37, speedMps: 10, headingDeg: 90 }));
    const result = interpolator.sample("d1", T0 + 2_000);
    assert.equal(result?.lat, 29.37);
    assert.equal(result?.extrapolated, false);
  });

  it("interpolates halfway between two fixes", () => {
    const interpolator = new FleetInterpolator();
    interpolator.push("d1", sample({ lat: 29.0, tMs: T0 }));
    interpolator.push("d1", sample({ lat: 29.1, tMs: T0 + 5_000 }));

    // Render delay means the drawn time is 300ms behind the clock.
    const midpointClock = T0 + 2_500 + FLEET_RENDER_DELAY_MS;
    const result = interpolator.sample("d1", midpointClock);
    assert.ok(result);
    assert.ok(Math.abs(result.lat - 29.05) < 1e-9, `got ${result.lat}`);
    assert.equal(result.extrapolated, false);
  });

  it("takes the shortest arc across 0 degrees", () => {
    const interpolator = new FleetInterpolator();
    interpolator.push("d1", sample({ headingDeg: 350, tMs: T0 }));
    interpolator.push("d1", sample({ headingDeg: 10, tMs: T0 + 1_000, lat: 29.371 }));

    const result = interpolator.sample("d1", T0 + 500 + FLEET_RENDER_DELAY_MS);
    // Halfway from 350 to 10 the short way is 0, not 180.
    assert.ok(result);
    const heading = result.headingDeg;
    assert.ok(heading > 359.9 || heading < 0.1, `expected ~0/360, got ${heading}`);
  });

  it("dead reckons past the last fix while the driver is moving", () => {
    const interpolator = new FleetInterpolator();
    interpolator.push("d1", sample({ tMs: T0, speedMps: 10, headingDeg: 0 }));
    interpolator.push("d1", sample({ tMs: T0 + 1_000, speedMps: 10, headingDeg: 0, lat: 29.371 }));

    const result = interpolator.sample("d1", T0 + 3_000 + FLEET_RENDER_DELAY_MS);
    assert.ok(result);
    assert.equal(result.extrapolated, true);
    // Heading 0 is due north: latitude increases, longitude does not.
    assert.ok(result.lat > 29.371);
    assert.ok(Math.abs(result.lng - 47.98) < 1e-9);
  });

  it("does not creep a stationary driver", () => {
    const interpolator = new FleetInterpolator();
    interpolator.push("d1", sample({ tMs: T0, speedMps: 0 }));
    interpolator.push("d1", sample({ tMs: T0 + 1_000, speedMps: 0.4, lat: 29.3701 }));

    const result = interpolator.sample("d1", T0 + 60_000);
    assert.ok(result);
    assert.equal(result.extrapolated, false);
    assert.equal(result.lat, 29.3701);
  });

  it("stops extrapolating rather than inventing unbounded travel", () => {
    const interpolator = new FleetInterpolator();
    interpolator.push("d1", sample({ tMs: T0, speedMps: 20, headingDeg: 0 }));
    interpolator.push("d1", sample({ tMs: T0 + 1_000, speedMps: 20, headingDeg: 0, lat: 29.371 }));

    const capped = interpolator.sample("d1", T0 + 1_000 + FLEET_MAX_EXTRAPOLATE_MS + FLEET_RENDER_DELAY_MS);
    const wayLater = interpolator.sample("d1", T0 + 600_000);
    assert.ok(capped && wayLater);
    assert.equal(capped.lat, wayLater.lat, "extrapolation must be clamped, not open-ended");
  });

  it("ignores an out-of-order fix instead of dragging the marker backwards", () => {
    const interpolator = new FleetInterpolator();
    interpolator.push("d1", sample({ tMs: T0, lat: 29.0 }));
    interpolator.push("d1", sample({ tMs: T0 + 5_000, lat: 29.1 }));
    interpolator.push("d1", sample({ tMs: T0 + 2_000, lat: 28.0 }));

    assert.equal(interpolator.latest("d1")?.lat, 29.1);
  });

  it("snaps on reset, so a re-appearing driver does not fly across the map", () => {
    const interpolator = new FleetInterpolator();
    interpolator.push("d1", sample({ lat: 29.0, tMs: T0 }));
    interpolator.reset("d1", sample({ lat: 30.0, tMs: T0 + 60_000 }));

    const result = interpolator.sample("d1", T0 + 60_000);
    assert.equal(result?.lat, 30.0);
  });
});
