import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  activeFleetFlags,
  decayedFleetStatus,
  FLEET_DEFAULT_THRESHOLDS,
  FLEET_STATUSES,
  fleetDistributionBucket,
  hasLiveTelemetry,
  fleetEventSeverity,
  fleetFlags,
  fleetStatus,
  fleetStatusTone,
  isFleetAlert,
  isLowBattery,
  isOverspeeding,
  isReservedFleetStatus,
  normalizeBatteryPct,
  resolveFleetThresholds,
  type FleetEntitySignals,
} from "./fleet-status";

const NOW = Date.parse("2026-08-14T12:00:00.000Z");
const freshFix = NOW - 4_000;

function signals(overrides: Partial<FleetEntitySignals> = {}): FleetEntitySignals {
  return {
    isOnDuty: true,
    isOnline: true,
    lastFixAtMs: freshFix,
    trackingStatus: "idle",
    speedMps: 0,
    accountStatus: "active",
    ...overrides,
  };
}

describe("fleetStatus", () => {
  it("puts blocked ahead of every other signal", () => {
    assert.equal(
      fleetStatus(
        signals({ isBlocked: true, trackingStatus: "moving", speedMps: 9 }),
        NOW,
      ),
      "blocked",
    );
  });

  it("reads a suspended account as inactive even while on duty", () => {
    assert.equal(
      fleetStatus(signals({ accountStatus: "suspended", speedMps: 9 }), NOW),
      "inactive",
    );
  });

  it("reads a clocked-out driver as offline even with a fresh moving fix", () => {
    assert.equal(
      fleetStatus(signals({ isOnDuty: false, trackingStatus: "moving", speedMps: 9 }), NOW),
      "offline",
    );
  });

  it("prefers offline over location_off when the driver is clocked out", () => {
    assert.equal(
      fleetStatus(signals({ isOnDuty: false, locationOff: true }), NOW),
      "offline",
    );
  });

  it("reads location_off for an on-duty driver whose pin was cleared", () => {
    assert.equal(fleetStatus(signals({ locationOff: true }), NOW), "location_off");
  });

  it("goes gps_offline once the fix is older than the threshold", () => {
    const stale = NOW - (FLEET_DEFAULT_THRESHOLDS.gpsOfflineSeconds + 1) * 1000;
    assert.equal(fleetStatus(signals({ lastFixAtMs: stale }), NOW), "gps_offline");
  });

  it("stays live at exactly the gps offline boundary", () => {
    const edge = NOW - FLEET_DEFAULT_THRESHOLDS.gpsOfflineSeconds * 1000;
    assert.equal(fleetStatus(signals({ lastFixAtMs: edge }), NOW), "idle");
  });

  it("treats a missing fix as gps_offline rather than idle", () => {
    assert.equal(fleetStatus(signals({ lastFixAtMs: null }), NOW), "gps_offline");
  });

  it("reads on_delivery from the open delivery alone, whatever the stamp says", () => {
    assert.equal(
      fleetStatus(
        signals({ trackingStatus: "delivery_submit", activeDeliveryId: "d1" }),
        NOW,
      ),
      "on_delivery",
    );
    // The stamp is `delivery_submit` for one sample at most — the next position
    // overwrites it — so requiring it made the status practically unreachable.
    assert.equal(
      fleetStatus(
        signals({ trackingStatus: "moving", activeDeliveryId: "d1", speedMps: 9 }),
        NOW,
      ),
      "on_delivery",
    );
    assert.equal(
      fleetStatus(
        signals({ trackingStatus: "idle", activeDeliveryId: "d1", speedMps: 0 }),
        NOW,
      ),
      "on_delivery",
    );
  });

  it("falls through a leftover delivery_submit with no open pickup", () => {
    assert.equal(
      fleetStatus(
        signals({ trackingStatus: "delivery_submit", activeDeliveryId: null, speedMps: 0 }),
        NOW,
      ),
      "idle",
    );
    assert.equal(
      fleetStatus(
        signals({ trackingStatus: "delivery_submit", activeDeliveryId: null, speedMps: 9 }),
        NOW,
      ),
      "moving",
    );
  });

  it("derives moving from live speed when the stamp still says idle", () => {
    assert.equal(fleetStatus(signals({ speedMps: 5 }), NOW), "moving");
  });

  it("keeps a walking-pace driver idle", () => {
    assert.equal(fleetStatus(signals({ speedMps: 1.2 }), NOW), "idle");
  });

  it("honours a raised overspeed threshold from settings", () => {
    assert.equal(
      fleetStatus(signals({ speedMps: 2 }), NOW, { movingSpeedMps: 4 }),
      "idle",
    );
  });

  it("keeps on_break reserved but representable", () => {
    assert.equal(fleetStatus(signals({ onBreak: true }), NOW), "on_break");
    assert.equal(isReservedFleetStatus("on_break"), true);
    assert.equal(isReservedFleetStatus("moving"), false);
  });

  it("covers every status in the exported list", () => {
    assert.equal(FLEET_STATUSES.length, 9);
    for (const status of FLEET_STATUSES) {
      assert.ok(fleetStatusTone(status));
    }
  });

  it("paints Offline and GPS Offline as danger so they read as down, not idle", () => {
    assert.equal(fleetStatusTone("offline"), "danger");
    assert.equal(fleetStatusTone("gps_offline"), "danger");
    assert.equal(fleetStatusTone("blocked"), "danger");
  });
});

describe("fleetFlags", () => {
  it("keeps a moving driver moving while flagging out of zone", () => {
    const input = signals({ speedMps: 9, inAssignedZone: false });
    assert.equal(fleetStatus(input, NOW), "moving");
    assert.equal(fleetFlags(input, NOW).out_of_zone, true);
  });

  it("separates assigned-zone membership from delivery range", () => {
    const flags = fleetFlags(
      signals({ inAssignedZone: true, rangeStatus: "out_of_zone" }),
      NOW,
    );
    assert.equal(flags.out_of_zone, false);
    assert.equal(flags.out_of_range, true);
  });

  it("makes no zone claim without a live fix", () => {
    const stale = NOW - 10 * 60_000;
    const flags = fleetFlags(
      signals({ lastFixAtMs: stale, inAssignedZone: false, rangeStatus: "out_of_zone" }),
      NOW,
    );
    assert.equal(flags.out_of_zone, false);
    assert.equal(flags.out_of_range, false);
  });

  it("tracks on_duty and online independently", () => {
    const flags = fleetFlags(signals({ isOnDuty: true, isOnline: false }), NOW);
    assert.equal(flags.on_duty, true);
    assert.equal(flags.online, false);
  });

  it("flags overspeed strictly above the limit", () => {
    assert.equal(fleetFlags(signals({ speedMps: 60 / 3.6 }), NOW).overspeed, false);
    assert.equal(fleetFlags(signals({ speedMps: 61 / 3.6 }), NOW).overspeed, true);
  });

  it("flags low battery at the threshold and not above it", () => {
    assert.equal(fleetFlags(signals({ batteryPct: 20 }), NOW).low_battery, true);
    assert.equal(fleetFlags(signals({ batteryPct: 21 }), NOW).low_battery, false);
  });

  it("raises stale_gps as a warning tier before gps_offline", () => {
    const late = NOW - (FLEET_DEFAULT_THRESHOLDS.staleGpsSeconds + 5) * 1000;
    const input = signals({ lastFixAtMs: late });
    assert.equal(fleetStatus(input, NOW), "idle");
    assert.equal(fleetFlags(input, NOW).stale_gps, true);
  });

  it("drops stale_gps once the driver is fully gps_offline", () => {
    const gone = NOW - 10 * 60_000;
    const input = signals({ lastFixAtMs: gone });
    assert.equal(fleetStatus(input, NOW), "gps_offline");
    assert.equal(fleetFlags(input, NOW).stale_gps, false);
  });

  it("flags a mocked provider", () => {
    assert.equal(fleetFlags(signals({ isMocked: true }), NOW).mocked_gps, true);
  });

  it("flags shift_late when the grace window closed with no check-in", () => {
    const start = NOW - 30 * 60_000;
    assert.equal(
      fleetFlags(signals({ shiftScheduledStartMs: start, shiftCheckInAtMs: null }), NOW)
        .shift_late,
      true,
    );
  });

  it("does not flag shift_late inside the grace window", () => {
    const start = NOW - 5 * 60_000;
    assert.equal(
      fleetFlags(signals({ shiftScheduledStartMs: start, shiftCheckInAtMs: null }), NOW)
        .shift_late,
      false,
    );
  });

  it("does not flag shift_late for a punctual check-in", () => {
    const start = NOW - 60 * 60_000;
    assert.equal(
      fleetFlags(
        signals({ shiftScheduledStartMs: start, shiftCheckInAtMs: start - 120_000 }),
        NOW,
      ).shift_late,
      false,
    );
  });

  it("flags shift_overrun only while still on duty", () => {
    const end = NOW - 20 * 60_000;
    assert.equal(
      fleetFlags(signals({ shiftScheduledEndMs: end }), NOW).shift_overrun,
      true,
    );
    assert.equal(
      fleetFlags(signals({ shiftScheduledEndMs: end, isOnDuty: false }), NOW)
        .shift_overrun,
      false,
    );
  });

  it("lists active flags in declaration order", () => {
    const flags = fleetFlags(
      signals({ speedMps: 30, inAssignedZone: false, batteryPct: 5 }),
      NOW,
    );
    assert.deepEqual(activeFleetFlags(flags), [
      "on_duty",
      "online",
      "out_of_zone",
      "overspeed",
      "low_battery",
    ]);
  });
});

describe("distribution and alerting", () => {
  it("routes an out-of-zone moving driver into the alert bucket", () => {
    const input = signals({ speedMps: 9, inAssignedZone: false });
    const flags = fleetFlags(input, NOW);
    assert.equal(isFleetAlert(fleetStatus(input, NOW), flags), true);
    assert.equal(fleetDistributionBucket(fleetStatus(input, NOW), flags), "alert");
  });

  it("does not treat a merely low battery as an alert bucket", () => {
    const input = signals({ speedMps: 9, batteryPct: 5, inAssignedZone: true });
    const flags = fleetFlags(input, NOW);
    assert.equal(fleetDistributionBucket(fleetStatus(input, NOW), flags), "moving");
  });

  it("buckets gps_offline drivers as offline", () => {
    const input = signals({ lastFixAtMs: NOW - 10 * 60_000 });
    const flags = fleetFlags(input, NOW);
    assert.equal(fleetDistributionBucket(fleetStatus(input, NOW), flags), "offline");
  });
});

describe("staleness rules", () => {
  const offlineMs = FLEET_DEFAULT_THRESHOLDS.gpsOfflineSeconds * 1_000;

  it("refuses to vouch for a reading behind an offline status", () => {
    assert.equal(hasLiveTelemetry("moving"), true);
    assert.equal(hasLiveTelemetry("on_delivery"), true);
    assert.equal(hasLiveTelemetry("idle"), true);
    assert.equal(hasLiveTelemetry("gps_offline"), false);
    assert.equal(hasLiveTelemetry("offline"), false);
    assert.equal(hasLiveTelemetry("location_off"), false);
    assert.equal(hasLiveTelemetry("blocked"), false);
  });

  it("decays a live status once the fix passes the offline threshold", () => {
    assert.equal(decayedFleetStatus("moving", NOW - offlineMs + 5_000, NOW), null);
    assert.equal(decayedFleetStatus("moving", NOW - offlineMs - 1_000, NOW), "gps_offline");
    assert.equal(
      decayedFleetStatus("on_delivery", NOW - offlineMs - 1_000, NOW),
      "gps_offline",
    );
    assert.equal(decayedFleetStatus("idle", null, NOW), "gps_offline");
  });

  it("does not decay statuses that are duty or account facts", () => {
    assert.equal(decayedFleetStatus("offline", NOW - offlineMs - 1_000, NOW), null);
    assert.equal(decayedFleetStatus("blocked", null, NOW), null);
    assert.equal(decayedFleetStatus("gps_offline", null, NOW), null);
  });

  it("honours a custom offline threshold", () => {
    const overrides = { gpsOfflineSeconds: 300 };
    assert.equal(
      decayedFleetStatus("moving", NOW - offlineMs - 1_000, NOW, overrides),
      null,
    );
  });
});

describe("threshold plumbing", () => {
  it("merges only finite non-negative overrides", () => {
    const merged = resolveFleetThresholds({
      overspeedKmh: 80,
      lowBatteryPct: Number.NaN,
      idleMinutes: -3,
    });
    assert.equal(merged.overspeedKmh, 80);
    assert.equal(merged.lowBatteryPct, FLEET_DEFAULT_THRESHOLDS.lowBatteryPct);
    assert.equal(merged.idleMinutes, FLEET_DEFAULT_THRESHOLDS.idleMinutes);
  });

  it("normalizes fractional battery readings", () => {
    assert.equal(normalizeBatteryPct(0.42), 42);
    assert.equal(normalizeBatteryPct(42), 42);
    assert.equal(normalizeBatteryPct(null), null);
    assert.equal(isLowBattery(0.1), true);
  });

  it("applies a custom overspeed limit", () => {
    assert.equal(isOverspeeding(20, resolveFleetThresholds({ overspeedKmh: 80 })), false);
    assert.equal(isOverspeeding(25, resolveFleetThresholds({ overspeedKmh: 80 })), true);
  });

  it("grades event severity", () => {
    assert.equal(fleetEventSeverity("overspeed.start"), "critical");
    assert.equal(fleetEventSeverity("battery.low"), "warning");
    assert.equal(fleetEventSeverity("movement.started"), "info");
  });
});
