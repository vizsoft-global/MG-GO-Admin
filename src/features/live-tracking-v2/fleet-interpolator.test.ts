import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  FLEET_MAX_EXTRAPOLATE_MS,
  FLEET_RENDER_DELAY_FACTOR,
  FLEET_RENDER_DELAY_MAX_MS,
  FLEET_RENDER_DELAY_MIN_MS,
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

    // The drawn time sits one render buffer behind the clock, and that buffer is
    // derived from the cadence these two fixes just demonstrated.
    const midpointClock = T0 + 2_500 + interpolator.renderDelayMs;
    const result = interpolator.sample("d1", midpointClock);
    assert.ok(result);
    assert.ok(Math.abs(result.lat - 29.05) < 1e-9, `got ${result.lat}`);
    assert.equal(result.extrapolated, false);
  });

  it("takes the shortest arc across 0 degrees", () => {
    const interpolator = new FleetInterpolator();
    interpolator.push("d1", sample({ headingDeg: 350, tMs: T0 }));
    interpolator.push("d1", sample({ headingDeg: 10, tMs: T0 + 1_000, lat: 29.371 }));

    const result = interpolator.sample("d1", T0 + 500 + interpolator.renderDelayMs);
    // Halfway from 350 to 10 the short way is 0, not 180.
    assert.ok(result);
    const heading = result.headingDeg;
    assert.ok(heading > 359.9 || heading < 0.1, `expected ~0/360, got ${heading}`);
  });

  it("dead reckons past the last fix while the driver is moving", () => {
    const interpolator = new FleetInterpolator();
    interpolator.push("d1", sample({ tMs: T0, speedMps: 10, headingDeg: 0 }));
    interpolator.push("d1", sample({ tMs: T0 + 1_000, speedMps: 10, headingDeg: 0, lat: 29.371 }));

    const result = interpolator.sample("d1", T0 + 3_000 + interpolator.renderDelayMs);
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

    const capped = interpolator.sample(
      "d1",
      T0 + 1_000 + FLEET_MAX_EXTRAPOLATE_MS + interpolator.renderDelayMs,
    );
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

  describe("adaptive render delay", () => {
    /** Feeds `count` fixes spaced `gapMs` apart, as a steady cadence would. */
    function feed(interpolator: FleetInterpolator, gapMs: number, count = 12) {
      for (let i = 0; i < count; i += 1) {
        interpolator.push(
          "d1",
          sample({ tMs: T0 + i * gapMs, lat: 29.37 + i * 0.001, speedMps: 8 }),
        );
      }
    }

    it("starts at the floor before any cadence has been observed", () => {
      const interpolator = new FleetInterpolator();
      assert.equal(interpolator.renderDelayMs, FLEET_RENDER_DELAY_MIN_MS);
      assert.equal(interpolator.medianGapMs, 0);
    });

    it("buffers just over one measured cadence at 1Hz", () => {
      const interpolator = new FleetInterpolator();
      feed(interpolator, 1_000);
      assert.equal(interpolator.medianGapMs, 1_000);
      assert.equal(interpolator.renderDelayMs, 1_000 * FLEET_RENDER_DELAY_FACTOR);
    });

    it("clamps to the ceiling on a slow rail rather than showing stale as live", () => {
      const interpolator = new FleetInterpolator();
      feed(interpolator, 5_000);
      assert.equal(interpolator.renderDelayMs, FLEET_RENDER_DELAY_MAX_MS);
    });

    it("clamps to the floor when fixes arrive faster than frames", () => {
      const interpolator = new FleetInterpolator();
      feed(interpolator, 250);
      assert.equal(interpolator.renderDelayMs, FLEET_RENDER_DELAY_MIN_MS);
    });

    it("ignores reconnect gaps, which are not the cadence", () => {
      const interpolator = new FleetInterpolator();
      feed(interpolator, 1_000);
      // A phone out of a tunnel: one 90s gap must not drag the buffer to the ceiling.
      interpolator.push("d1", sample({ tMs: T0 + 200_000, lat: 29.5, speedMps: 8 }));
      assert.equal(interpolator.renderDelayMs, 1_000 * FLEET_RENDER_DELAY_FACTOR);
    });

    it("tracks a cadence change rather than holding the first estimate forever", () => {
      const interpolator = new FleetInterpolator();
      feed(interpolator, 250, 70);
      assert.equal(interpolator.renderDelayMs, FLEET_RENDER_DELAY_MIN_MS);

      // A rail switch changes the spacing; the ring is 64 long, so a full sweep of
      // 1Hz gaps must move the median off the old value.
      const interpolator2 = new FleetInterpolator();
      feed(interpolator2, 1_000, 70);
      assert.equal(interpolator2.medianGapMs, 1_000);
    });

    it("interpolates rather than extrapolates at 1Hz, which is the whole point", () => {
      const interpolator = new FleetInterpolator();
      feed(interpolator, 1_000);

      // Newest fix is at T0 + 11_000; the clock is a frame past it.
      const result = interpolator.sample("d1", T0 + 11_000 + 200);
      assert.ok(result);
      assert.equal(
        result.extrapolated,
        false,
        "a 1Hz stream must render between two known fixes, not past the newest one",
      );
    });
  });
});
