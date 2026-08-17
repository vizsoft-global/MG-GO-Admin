import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  FLEET_PULSE_DURATION_MS,
  FLEET_PULSE_MAX_RADIUS_PX,
  FLEET_PULSE_MIN_RADIUS_PX,
  FLEET_PULSE_STATIC_ALPHA,
  FLEET_PULSE_STATIC_RADIUS_PX,
  FleetPulseTracker,
  pulseEligible,
  pulsePhase,
  pulseRing,
  pulseStartJitterMs,
  selectPulseDrivers,
} from "./fleet-pulse";

const T0 = 1_700_000_000_000;

describe("pulseEligible", () => {
  it("pulses a reporting rider who is moving or on a delivery", () => {
    assert.equal(pulseEligible("moving", false), true);
    assert.equal(pulseEligible("on_delivery", false), true);
  });

  it("refuses to pulse a status that cannot vouch for live telemetry", () => {
    // The same gate the driver card uses before printing a speed: a ring on an Offline
    // pin claims a fix just arrived, which is the opposite of what the operator needs.
    assert.equal(pulseEligible("offline", false), false);
    assert.equal(pulseEligible("gps_offline", false), false);
    assert.equal(pulseEligible("location_off", false), false);
    assert.equal(pulseEligible("blocked", false), false);
  });

  it("keeps an offline rider dark even when selected", () => {
    assert.equal(pulseEligible("offline", true), false);
    assert.equal(pulseEligible("gps_offline", true), false);
  });

  it("pulses an idle rider only while selected", () => {
    assert.equal(pulseEligible("idle", false), false);
    assert.equal(pulseEligible("idle", true), true);
  });
});

describe("pulsePhase", () => {
  it("runs from 0 towards 1 across the duration", () => {
    assert.equal(pulsePhase(T0, T0), 0);
    assert.equal(pulsePhase(T0 + FLEET_PULSE_DURATION_MS / 2, T0), 0.5);
  });

  it("is null before the ring starts and once it has expired", () => {
    assert.equal(pulsePhase(T0 - 1, T0), null);
    assert.equal(pulsePhase(T0 + FLEET_PULSE_DURATION_MS, T0), null);
    assert.equal(pulsePhase(T0 + FLEET_PULSE_DURATION_MS + 5_000, T0), null);
  });
});

describe("pulseRing", () => {
  it("expands out of the puck and fades as it goes", () => {
    const start = pulseRing(0);
    const late = pulseRing(0.9);
    assert.equal(start.radiusPx, FLEET_PULSE_MIN_RADIUS_PX);
    assert.ok(late.radiusPx > start.radiusPx);
    assert.ok(late.radiusPx <= FLEET_PULSE_MAX_RADIUS_PX);
    assert.ok(late.alpha < start.alpha);
  });

  it("holds a static ring under reduced motion", () => {
    // Matches the interpolator, which snaps rather than animating: which riders are
    // reporting is still visible, the movement is not.
    for (const phase of [0, 0.4, 0.99]) {
      const ring = pulseRing(phase, true);
      assert.equal(ring.radiusPx, FLEET_PULSE_STATIC_RADIUS_PX);
      assert.equal(ring.alpha, FLEET_PULSE_STATIC_ALPHA);
    }
  });
});

describe("pulseStartJitterMs", () => {
  it("is stable per driver and inside a quarter of the duration", () => {
    const first = pulseStartJitterMs("driver-a");
    assert.equal(first, pulseStartJitterMs("driver-a"));
    assert.ok(first >= 0);
    assert.ok(first < FLEET_PULSE_DURATION_MS * 0.25);
  });

  it("spreads different drivers apart", () => {
    const values = new Set(
      ["a", "b", "c", "d", "e", "f", "g", "h"].map((id) => pulseStartJitterMs(id)),
    );
    // A snapshot poll stamps every driver with the same time; without spread the whole
    // map would strobe in unison and read as a UI artefact.
    assert.ok(values.size > 1);
  });
});

describe("selectPulseDrivers", () => {
  const many = Array.from({ length: 120 }, (_, index) => `d${index}`);

  it("returns every candidate below the cap", () => {
    assert.deepEqual(selectPulseDrivers(["a", "b"], null, 50), ["a", "b"]);
  });

  it("caps the ring count", () => {
    assert.equal(selectPulseDrivers(many, null, 50).length, 50);
  });

  it("keeps the selected rider even from beyond the cap", () => {
    const picked = selectPulseDrivers(many, "d119", 50);
    assert.equal(picked.length, 50);
    assert.equal(picked[0], "d119");
    assert.equal(picked.filter((id) => id === "d119").length, 1);
  });

  it("draws nothing when the cap is zero", () => {
    assert.deepEqual(selectPulseDrivers(many, "d1", 0), []);
  });
});

describe("FleetPulseTracker", () => {
  it("has nothing to draw for a driver it has never seen", () => {
    assert.equal(new FleetPulseTracker().phase("nobody", T0), null);
  });

  it("does not pulse a driver's first fix", () => {
    // Otherwise every driver in the opening snapshot rings at once, which says nothing
    // about who is reporting now.
    const tracker = new FleetPulseTracker();
    tracker.observe("d1", T0, T0);
    assert.equal(tracker.phase("d1", T0), null);
  });

  it("starts a ring on the next fix", () => {
    const tracker = new FleetPulseTracker();
    tracker.observe("d1", T0, T0);
    tracker.observe("d1", T0 + 1_000, T0 + 1_000);

    const started = T0 + 1_000 + pulseStartJitterMs("d1");
    assert.equal(tracker.phase("d1", started), 0);
    assert.ok(tracker.phase("d1", started + 100)! > 0);
  });

  it("ignores a repeated or older fix", () => {
    // The room re-sends a rider's last position when they enter a socket's viewport, so
    // a ring per pan would make a parked fleet look busy.
    const tracker = new FleetPulseTracker();
    tracker.observe("d1", T0, T0);
    tracker.observe("d1", T0 + 1_000, T0 + 1_000);

    const settled = T0 + 1_000 + pulseStartJitterMs("d1") + FLEET_PULSE_DURATION_MS;
    assert.equal(tracker.phase("d1", settled), null);

    tracker.observe("d1", T0 + 1_000, settled);
    tracker.observe("d1", T0 + 500, settled);
    assert.equal(tracker.phase("d1", settled + pulseStartJitterMs("d1")), null);
  });

  it("expires a ring after its duration", () => {
    const tracker = new FleetPulseTracker();
    tracker.observe("d1", T0, T0);
    tracker.observe("d1", T0 + 1_000, T0 + 1_000);

    const started = T0 + 1_000 + pulseStartJitterMs("d1");
    assert.equal(tracker.phase("d1", started + FLEET_PULSE_DURATION_MS), null);
  });

  it("forgets a driver who left the roster", () => {
    const tracker = new FleetPulseTracker();
    tracker.observe("d1", T0, T0);
    tracker.observe("d1", T0 + 1_000, T0 + 1_000);
    tracker.forget("d1");

    // A re-added driver starts over: their next fix is a first sighting again, not a ring.
    tracker.observe("d1", T0 + 2_000, T0 + 2_000);
    assert.equal(tracker.phase("d1", T0 + 2_000 + pulseStartJitterMs("d1")), null);
  });

  it("rejects a fix with no usable timestamp", () => {
    const tracker = new FleetPulseTracker();
    tracker.observe("d1", 0, T0);
    tracker.observe("d1", Number.NaN, T0);
    tracker.observe("d1", T0, T0);
    // The first two were not fixes, so this one is still the first sighting.
    assert.equal(tracker.phase("d1", T0), null);
  });
});
