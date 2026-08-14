import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BATTERY_RECOVERY_MARGIN_PCT,
  OVERSPEED_CONFIRM_SAMPLES,
  evaluateRules,
  initialRuleState,
  type RuleInput,
  type RuleState,
} from "./fleet-rules";
import type {
  FleetEntitySignals,
  FleetTrackingStatus,
} from "../../../../src/features/live-tracking-v2/fleet-status";

const T0 = Date.UTC(2026, 7, 14, 9, 0, 0);

function signals(overrides: Partial<FleetEntitySignals> = {}): FleetEntitySignals {
  return {
    isBlocked: false,
    accountStatus: "active",
    isOnDuty: true,
    isOnline: true,
    lastFixAtMs: T0,
    trackingStatus: "idle" as FleetTrackingStatus,
    speedMps: 0,
    ...overrides,
  };
}

type StepOptions = {
  nowMs?: number;
  assignedZoneId?: string | null;
};

/** Drives one evaluation and returns the emitted event keys plus the new state. */
function step(
  state: RuleState,
  overrides: Partial<FleetEntitySignals>,
  options: StepOptions = {},
): { state: RuleState; keys: string[]; events: RuleInput extends never ? never : ReturnType<typeof evaluateRules>["events"] } {
  const nowMs = options.nowMs ?? T0;
  const outcome = evaluateRules(state, {
    signals: signals({ lastFixAtMs: nowMs, ...overrides }),
    assignedZoneId: options.assignedZoneId ?? "zone-a",
    latitude: 29.37,
    longitude: 47.98,
    nowMs,
  });
  return {
    state: outcome.state,
    keys: outcome.events.map((event) => event.eventKey),
    events: outcome.events,
  };
}

/** Baseline pass: the first observation never emits. */
function baseline(overrides: Partial<FleetEntitySignals> = {}, nowMs = T0): RuleState {
  const result = step(initialRuleState(), overrides, { nowMs });
  assert.deepEqual(result.keys, []);
  return result.state;
}

/**
 * Held moving for tests about something other than movement. A stationary driver
 * starts the idle clock, and any test that jumps more than five minutes forward
 * would otherwise collect a perfectly correct `idle.sustained` it was not asking
 * about.
 */
const MOVING: Partial<FleetEntitySignals> = {
  speedMps: 8,
  trackingStatus: "moving" as FleetTrackingStatus,
};

describe("first observation", () => {
  it("emits nothing, whatever the driver is doing", () => {
    const result = step(initialRuleState(), {
      speedMps: 30,
      batteryPct: 4,
      isMocked: true,
      lastFixAtMs: T0 - 600_000,
    });
    assert.deepEqual(result.keys, []);
  });

  it("latches the current condition so the next pass is a real comparison", () => {
    const state = baseline({ speedMps: 30 });
    assert.equal(state.overspeeding, true);
    // Already speeding at boot, so slowing down is the transition that gets reported.
    const slower = step(state, { speedMps: 0 });
    assert.deepEqual(slower.keys, ["movement.stopped"]);
  });
});

describe("movement", () => {
  it("reports start and stop once each", () => {
    let state = baseline({ speedMps: 0 });

    const moving = step(state, { speedMps: 8 }, { nowMs: T0 + 5_000 });
    assert.deepEqual(moving.keys, ["movement.started"]);
    state = moving.state;

    const stillMoving = step(state, { speedMps: 9 }, { nowMs: T0 + 10_000 });
    assert.deepEqual(stillMoving.keys, []);
    state = stillMoving.state;

    // 30s cooldown on movement.stopped, so the stop is reported at +45s not +15s.
    const stopped = step(state, { speedMps: 0 }, { nowMs: T0 + 45_000 });
    assert.deepEqual(stopped.keys, ["movement.stopped"]);
  });

  it("treats on_delivery as moving, so a pickup does not read as a stop", () => {
    const state = baseline({ speedMps: 8, trackingStatus: "moving" });
    const onDelivery = step(
      state,
      {
        speedMps: 0,
        trackingStatus: "delivery_submit",
        activeDeliveryId: "d-1",
      },
      { nowMs: T0 + 5_000 },
    );
    assert.deepEqual(onDelivery.keys, []);
  });
});

describe("sustained idle", () => {
  it("reports once per idle spell, not once per tick", () => {
    let state = baseline({ speedMps: 0 });
    // Default threshold is 5 minutes.
    const early = step(state, { speedMps: 0 }, { nowMs: T0 + 4 * 60_000 });
    assert.deepEqual(early.keys, []);
    state = early.state;

    const due = step(state, { speedMps: 0 }, { nowMs: T0 + 6 * 60_000 });
    assert.deepEqual(due.keys, ["idle.sustained"]);
    state = due.state;

    const later = step(state, { speedMps: 0 }, { nowMs: T0 + 40 * 60_000 });
    assert.deepEqual(later.keys, []);
  });

  it("restarts the clock after the driver moves", () => {
    let state = baseline({ speedMps: 0 });
    state = step(state, { speedMps: 0 }, { nowMs: T0 + 6 * 60_000 }).state;
    state = step(state, { speedMps: 9 }, { nowMs: T0 + 7 * 60_000 }).state;
    assert.equal(state.idleSinceMs, null);

    const stopped = step(state, { speedMps: 0 }, { nowMs: T0 + 40 * 60_000 });
    assert.ok(stopped.keys.includes("movement.stopped"));
    assert.ok(!stopped.keys.includes("idle.sustained"));

    // 15-minute cooldown has expired by now, so the second spell is reported.
    const secondSpell = step(stopped.state, { speedMps: 0 }, { nowMs: T0 + 50 * 60_000 });
    assert.deepEqual(secondSpell.keys, ["idle.sustained"]);
  });
});

describe("overspeed", () => {
  const fast = { speedMps: 20, trackingStatus: "moving" as FleetTrackingStatus };
  const legal = { speedMps: 10, trackingStatus: "moving" as FleetTrackingStatus };

  it("requires consecutive samples before starting", () => {
    let state = baseline(legal);
    let emitted: string[] = [];
    for (let i = 1; i <= OVERSPEED_CONFIRM_SAMPLES; i += 1) {
      const result = step(state, fast, { nowMs: T0 + i * 5_000 });
      state = result.state;
      emitted = emitted.concat(result.keys);
    }
    assert.deepEqual(
      emitted.filter((key) => key === "overspeed.start"),
      ["overspeed.start"],
    );
    assert.equal(state.overspeeding, true);
  });

  it("does not start on a single GPS spike", () => {
    let state = baseline(legal);
    state = step(state, fast, { nowMs: T0 + 5_000 }).state;
    const back = step(state, legal, { nowMs: T0 + 10_000 });
    assert.deepEqual(back.keys, []);
    assert.equal(back.state.overspeeding, false);
  });

  it("clears only after the same number of samples below the limit", () => {
    let state = baseline(legal);
    for (let i = 1; i <= OVERSPEED_CONFIRM_SAMPLES; i += 1) {
      state = step(state, fast, { nowMs: T0 + i * 5_000 }).state;
    }

    let cleared = false;
    for (let i = 1; i <= OVERSPEED_CONFIRM_SAMPLES; i += 1) {
      const result = step(state, legal, { nowMs: T0 + 60_000 + i * 5_000 });
      state = result.state;
      if (result.keys.includes("overspeed.end")) cleared = true;
      if (i < OVERSPEED_CONFIRM_SAMPLES) {
        assert.equal(cleared, false, `cleared too early at sample ${i}`);
      }
    }
    assert.equal(cleared, true);
    assert.equal(state.overspeeding, false);
  });

  it("reports the peak rather than the speed at the moment it dropped", () => {
    let state = baseline(legal);
    for (let i = 1; i <= OVERSPEED_CONFIRM_SAMPLES; i += 1) {
      state = step(state, { ...fast, speedMps: 20 }, { nowMs: T0 + i * 5_000 }).state;
    }
    state = step(state, { ...fast, speedMps: 30 }, { nowMs: T0 + 30_000 }).state;

    let end: { value: number | null } | undefined;
    for (let i = 1; i <= OVERSPEED_CONFIRM_SAMPLES; i += 1) {
      const result = step(state, legal, { nowMs: T0 + 90_000 + i * 5_000 });
      state = result.state;
      end = result.events.find((event) => event.eventKey === "overspeed.end");
      if (end) break;
    }
    assert.equal(end?.value, 108);
  });

  it("suppresses a re-start inside the cooldown", () => {
    let state = baseline(legal);
    // Start confirmed at +15s, which arms the 60s cooldown until +75s.
    for (let i = 1; i <= OVERSPEED_CONFIRM_SAMPLES; i += 1) {
      state = step(state, fast, { nowMs: T0 + i * 5_000 }).state;
    }
    for (let i = 1; i <= OVERSPEED_CONFIRM_SAMPLES; i += 1) {
      state = step(state, legal, { nowMs: T0 + 20_000 + i * 5_000 }).state;
    }

    let emitted: string[] = [];
    for (let i = 1; i <= OVERSPEED_CONFIRM_SAMPLES; i += 1) {
      const result = step(state, fast, { nowMs: T0 + 40_000 + i * 5_000 });
      state = result.state;
      emitted = emitted.concat(result.keys);
    }
    assert.equal(emitted.includes("overspeed.start"), false);
    // The latch is not set either, so a suppressed start cannot leave the driver
    // stuck as "speeding" with no matching end event ever possible.
    assert.equal(state.overspeeding, false);
  });

  it("reports a genuine re-start once the cooldown has passed", () => {
    let state = baseline(legal);
    for (let i = 1; i <= OVERSPEED_CONFIRM_SAMPLES; i += 1) {
      state = step(state, fast, { nowMs: T0 + i * 5_000 }).state;
    }
    for (let i = 1; i <= OVERSPEED_CONFIRM_SAMPLES; i += 1) {
      state = step(state, legal, { nowMs: T0 + 20_000 + i * 5_000 }).state;
    }

    let emitted: string[] = [];
    for (let i = 1; i <= OVERSPEED_CONFIRM_SAMPLES; i += 1) {
      const result = step(state, fast, { nowMs: T0 + 120_000 + i * 5_000 });
      state = result.state;
      emitted = emitted.concat(result.keys);
    }
    assert.equal(emitted.filter((key) => key === "overspeed.start").length, 1);
    assert.equal(state.overspeeding, true);
  });
});

describe("battery", () => {
  it("reports low once and recovers only past the margin", () => {
    let state = baseline({ ...MOVING, batteryPct: 80 });

    const low = step(state, { ...MOVING, batteryPct: 18 }, { nowMs: T0 + 60_000 });
    assert.deepEqual(low.keys, ["battery.low"]);
    state = low.state;

    // Back above 20 but inside the margin: charging noise, not a recovery.
    const noisy = step(
      state,
      { ...MOVING, batteryPct: 20 + BATTERY_RECOVERY_MARGIN_PCT - 1 },
      { nowMs: T0 + 40 * 60_000 },
    );
    assert.deepEqual(noisy.keys, []);
    state = noisy.state;

    const recovered = step(
      state,
      { ...MOVING, batteryPct: 20 + BATTERY_RECOVERY_MARGIN_PCT },
      { nowMs: T0 + 41 * 60_000 },
    );
    assert.deepEqual(recovered.keys, ["battery.recovered"]);
  });

  it("does not re-report while the battery keeps falling", () => {
    let state = baseline({ ...MOVING, batteryPct: 80 });
    state = step(state, { ...MOVING, batteryPct: 19 }, { nowMs: T0 + 60_000 }).state;
    const lower = step(state, { ...MOVING, batteryPct: 5 }, { nowMs: T0 + 120_000 });
    assert.deepEqual(lower.keys, []);
  });

  it("ignores a missing reading rather than treating it as 0%", () => {
    const state = baseline({ ...MOVING, batteryPct: 80 });
    const missing = step(state, { ...MOVING, batteryPct: null }, { nowMs: T0 + 60_000 });
    assert.deepEqual(missing.keys, []);
  });
});

describe("gps liveness", () => {
  it("reports offline then restored for an on-duty driver", () => {
    let state = baseline({ speedMps: 0 });

    const offline = evaluateRules(state, {
      signals: signals({ lastFixAtMs: T0, speedMps: 0 }),
      assignedZoneId: "zone-a",
      latitude: 29.37,
      longitude: 47.98,
      nowMs: T0 + 200_000,
    });
    assert.ok(offline.events.some((event) => event.eventKey === "gps.offline"));
    state = offline.state;

    const restored = step(state, { speedMps: 0 }, { nowMs: T0 + 400_000 });
    assert.ok(restored.keys.includes("gps.restored"));
  });

  it("stays quiet for a clocked-out driver", () => {
    const state = baseline({ isOnDuty: false });
    const offline = evaluateRules(state, {
      signals: signals({ isOnDuty: false, lastFixAtMs: T0 }),
      assignedZoneId: "zone-a",
      latitude: null,
      longitude: null,
      nowMs: T0 + 600_000,
    });
    assert.deepEqual(offline.events, []);
  });
});

describe("zone and range", () => {
  it("reports a crossing only when membership actually flips", () => {
    let state = baseline({ ...MOVING, inAssignedZone: true });

    const same = step(state, { ...MOVING, inAssignedZone: true }, { nowMs: T0 + 5_000 });
    assert.deepEqual(same.keys, []);
    state = same.state;

    const exit = step(state, { ...MOVING, inAssignedZone: false }, { nowMs: T0 + 10_000 });
    assert.deepEqual(exit.keys, ["zone.exit"]);
    state = exit.state;

    // 2-minute cooldown: a driver weaving over the line does not write a row per fix.
    const bounce = step(state, { ...MOVING, inAssignedZone: true }, { nowMs: T0 + 20_000 });
    assert.deepEqual(bounce.keys, []);
    state = bounce.state;

    const entry = step(state, { ...MOVING, inAssignedZone: false }, { nowMs: T0 + 10 * 60_000 });
    assert.deepEqual(entry.keys, ["zone.exit"]);
  });

  it("says nothing about zones for a driver with no assigned zone", () => {
    const state = baseline({ ...MOVING, inAssignedZone: null }, T0);
    const moved = step(
      state,
      { ...MOVING, inAssignedZone: null },
      { nowMs: T0 + 5_000, assignedZoneId: null },
    );
    assert.deepEqual(moved.keys, []);
  });

  it("tracks delivery range independently of the assigned zone", () => {
    let state = baseline({ ...MOVING, rangeStatus: "in_zone" });
    const exit = step(state, { ...MOVING, rangeStatus: "out_of_zone" }, { nowMs: T0 + 5_000 });
    assert.deepEqual(exit.keys, ["range.exit"]);
    state = exit.state;

    const entry = step(state, { ...MOVING, rangeStatus: "in_zone" }, { nowMs: T0 + 5 * 60_000 });
    assert.deepEqual(entry.keys, ["range.entry"]);
  });

  it("ignores an unknown range verdict instead of calling it an exit", () => {
    const state = baseline({ ...MOVING, rangeStatus: "in_zone" });
    const unknown = step(state, { ...MOVING, rangeStatus: "unknown" }, { nowMs: T0 + 5_000 });
    assert.deepEqual(unknown.keys, []);
    assert.equal(unknown.state.rangeInside, true);
  });
});

describe("shift", () => {
  const shiftStart = T0;

  it("reports late once, after the grace window", () => {
    // Baseline before the grace window closes, so lateness is a transition.
    let state = baseline({ ...MOVING, shiftScheduledStartMs: shiftStart }, T0 + 60_000);

    const late = step(
      state,
      { ...MOVING, shiftScheduledStartMs: shiftStart, shiftCheckInAtMs: null },
      { nowMs: T0 + 11 * 60_000 },
    );
    assert.deepEqual(late.keys, ["shift.late"]);
    state = late.state;

    const again = step(
      state,
      { ...MOVING, shiftScheduledStartMs: shiftStart, shiftCheckInAtMs: null },
      { nowMs: T0 + 20 * 60_000 },
    );
    assert.deepEqual(again.keys, []);
  });

  it("does not report a driver who clocked in inside the grace window", () => {
    const state = baseline({ ...MOVING, shiftScheduledStartMs: shiftStart }, T0 + 60_000);
    const punctual = step(
      state,
      {
        ...MOVING,
        shiftScheduledStartMs: shiftStart,
        shiftCheckInAtMs: shiftStart + 60_000,
      },
      { nowMs: T0 + 30 * 60_000 },
    );
    assert.deepEqual(punctual.keys, []);
  });

  it("reports an overrun once while the driver stays on duty", () => {
    const shiftEnd = T0 + 60 * 60_000;
    let state = baseline({ ...MOVING, shiftScheduledEndMs: shiftEnd }, T0);

    const overrun = step(
      state,
      { ...MOVING, shiftScheduledEndMs: shiftEnd },
      { nowMs: shiftEnd + 60_000 },
    );
    assert.deepEqual(overrun.keys, ["shift.overrun"]);
    state = overrun.state;

    const again = step(
      state,
      { ...MOVING, shiftScheduledEndMs: shiftEnd },
      { nowMs: shiftEnd + 30 * 60_000 },
    );
    assert.deepEqual(again.keys, []);
  });
});

describe("mocked gps", () => {
  it("reports once per spell", () => {
    let state = baseline({ isMocked: false });

    const mocked = step(state, { isMocked: true }, { nowMs: T0 + 5_000 });
    assert.deepEqual(mocked.keys, ["gps.mocked"]);
    state = mocked.state;

    const again = step(state, { isMocked: true }, { nowMs: T0 + 10_000 });
    assert.deepEqual(again.keys, []);
  });
});

describe("event payload", () => {
  it("carries the status transition, position and zone", () => {
    const state = baseline({ speedMps: 0 });
    const moving = step(state, { speedMps: 8 }, { nowMs: T0 + 5_000 });
    const event = moving.events[0]!;
    assert.equal(event.eventKey, "movement.started");
    assert.equal(event.severity, "info");
    assert.equal(event.statusBefore, "idle");
    assert.equal(event.statusAfter, "moving");
    assert.equal(event.zoneId, "zone-a");
    assert.equal(event.latitude, 29.37);
    assert.equal(event.detectedAt, new Date(T0 + 5_000).toISOString());
  });
});
