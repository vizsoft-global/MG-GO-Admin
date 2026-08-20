import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  activeFleetFlags,
  decayedFleetStatus,
  displaySpeedKmh,
  FLEET_DEFAULT_THRESHOLDS,
  FLEET_FILTER_STATUSES,
  FLEET_STATUSES,
  fleetDistributionBarSegments,
  fleetDistributionBucket,
  hasLiveTelemetry,
  fleetEventSeverity,
  fleetFlags,
  fleetStatus,
  fleetStatusTone,
  fleetMarkerTone,
  fleetThresholdsAsSettings,
  fleetThresholdsFromSettings,
  gpsGraceForStatus,
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

  it("goes gps_offline once a moving fix is older than the moving threshold", () => {
    const stale = NOW - (FLEET_DEFAULT_THRESHOLDS.gpsOfflineSeconds + 1) * 1000;
    assert.equal(
      fleetStatus(
        signals({ trackingStatus: "moving", speedMps: 9, lastFixAtMs: stale }),
        NOW,
      ),
      "gps_offline",
    );
  });

  it("stays live at exactly the gps offline boundary", () => {
    const edge = NOW - FLEET_DEFAULT_THRESHOLDS.gpsOfflineSeconds * 1000;
    assert.equal(
      fleetStatus(signals({ trackingStatus: "moving", speedMps: 9, lastFixAtMs: edge }), NOW),
      "moving",
    );
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

  it("paints Offline and GPS Offline red", () => {
    assert.equal(fleetStatusTone("offline"), "danger");
    assert.equal(fleetStatusTone("gps_offline"), "danger");
    assert.equal(fleetStatusTone("blocked"), "danger");
  });

  it("paints the map marker red when the rider is out of range or out of zone", () => {
    const moving = fleetFlags(signals({ speedMps: 9, inAssignedZone: true }), NOW);
    assert.equal(fleetMarkerTone("moving", moving), "success");
    const outOfRange = fleetFlags(
      signals({ speedMps: 9, inAssignedZone: true, rangeStatus: "out_of_zone" }),
      NOW,
    );
    assert.equal(fleetMarkerTone("moving", outOfRange), "danger");
    const outOfZone = fleetFlags(signals({ speedMps: 9, inAssignedZone: false }), NOW);
    assert.equal(fleetMarkerTone("moving", outOfZone), "danger");
  });

  it("lists Location off with the other filterable / legend statuses", () => {
    assert.ok(FLEET_FILTER_STATUSES.includes("location_off"));
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
    const input = signals({ trackingStatus: "moving", speedMps: 9, lastFixAtMs: late });
    assert.equal(fleetStatus(input, NOW), "moving");
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
  it("keeps an out-of-zone moving driver in Moving, not the Alert slice", () => {
    const input = signals({ speedMps: 9, inAssignedZone: false });
    const flags = fleetFlags(input, NOW);
    assert.equal(isFleetAlert(fleetStatus(input, NOW), flags), true);
    assert.equal(fleetDistributionBucket(fleetStatus(input, NOW), flags), "moving");
  });

  it("does not treat a merely low battery as an alert bucket", () => {
    const input = signals({ speedMps: 9, batteryPct: 5, inAssignedZone: true });
    const flags = fleetFlags(input, NOW);
    assert.equal(fleetDistributionBucket(fleetStatus(input, NOW), flags), "moving");
  });

  it("treats Out of Range as an alert so Alerts Only can list those riders", () => {
    const input = signals({ speedMps: 9, inAssignedZone: true, rangeStatus: "out_of_zone" });
    const flags = fleetFlags(input, NOW);
    assert.equal(flags.out_of_range, true);
    assert.equal(flags.out_of_zone, false);
    assert.equal(isFleetAlert(fleetStatus(input, NOW), flags), true);
  });

  it("buckets gps_offline drivers as offline", () => {
    const input = signals({ lastFixAtMs: NOW - 10 * 60_000 });
    const flags = fleetFlags(input, NOW);
    assert.equal(fleetDistributionBucket(fleetStatus(input, NOW), flags), "offline");
  });

  it("paints an Alert graph slice from the KPI without stealing Moving", () => {
    const input = signals({ speedMps: 9, inAssignedZone: false });
    const flags = fleetFlags(input, NOW);
    assert.equal(fleetDistributionBucket(fleetStatus(input, NOW), flags), "moving");
    const segments = fleetDistributionBarSegments(
      { moving: 1, on_delivery: 0, idle: 1, offline: 0, alert: 0 },
      1,
    );
    assert.deepEqual(
      segments.map((segment) => [segment.bucket, segment.count]),
      [
        ["moving", 1],
        ["on_delivery", 0],
        ["idle", 1],
        ["offline", 0],
        ["alert", 1],
      ],
    );
  });
});

describe("staleness rules", () => {
  const offlineMs = FLEET_DEFAULT_THRESHOLDS.gpsOfflineSeconds * 1_000;
  const idleOfflineMs = FLEET_DEFAULT_THRESHOLDS.gpsOfflineIdleSeconds * 1_000;

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
      decayedFleetStatus("on_delivery", NOW - idleOfflineMs - 1_000, NOW),
      "gps_offline",
    );
    assert.equal(decayedFleetStatus("idle", null, NOW), "gps_offline");
  });

  it("gives a status that may be standing still the idle grace", () => {
    // A rider waiting at a pickup is on the app's 30s beat however their delivery is
    // labelled, so 91s of silence is three missed beats and not a verdict.
    const between = NOW - offlineMs - 1_000;
    assert.equal(decayedFleetStatus("idle", between, NOW), null);
    assert.equal(decayedFleetStatus("on_delivery", between, NOW), null);
    assert.equal(decayedFleetStatus("on_break", between, NOW), null);
    assert.equal(decayedFleetStatus("moving", between, NOW), "gps_offline");
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

/*
 * The driver app reports every second while moving and every 30s otherwise
 * (`AdaptiveLocationScheduler`), so one grace period cannot serve both: 90s of silence is 90
 * missed reports for a moving rider and three for a parked one. Three is inside the noise of a
 * single doze window, which is why an alive, on-duty, stationary rider read GPS Offline.
 */
describe("idle cadence grace", () => {
  const pastMoving = NOW - (FLEET_DEFAULT_THRESHOLDS.gpsOfflineSeconds + 10) * 1_000;
  const pastIdle = NOW - (FLEET_DEFAULT_THRESHOLDS.gpsOfflineIdleSeconds + 1) * 1_000;

  it("keeps a parked rider live past the moving threshold", () => {
    assert.equal(fleetStatus(signals({ lastFixAtMs: pastMoving }), NOW), "idle");
  });

  it("still calls a parked rider offline once the idle grace runs out", () => {
    assert.equal(fleetStatus(signals({ lastFixAtMs: pastIdle }), NOW), "gps_offline");
  });

  it("keeps the decisive threshold for a rider who was moving", () => {
    assert.equal(
      fleetStatus(
        signals({ trackingStatus: "moving", speedMps: 9, lastFixAtMs: pastMoving }),
        NOW,
      ),
      "gps_offline",
    );
  });

  it("reads real speed as the moving cadence even under an idle stamp", () => {
    // The scheduler can still be in idle on the fix that first carries motion.
    assert.equal(
      fleetStatus(signals({ speedMps: 9, lastFixAtMs: pastMoving }), NOW),
      "gps_offline",
    );
  });

  it("gives a delivery_submit stamp the idle grace", () => {
    // `markSampled` resets the scheduler to idle straight after a delivery_submit report,
    // so a rider waiting at a restaurant is on the 30s beat.
    assert.equal(
      fleetStatus(
        signals({ trackingStatus: "delivery_submit", lastFixAtMs: pastMoving }),
        NOW,
      ),
      "idle",
    );
  });

  it("stops flagging every idle driver stale_gps", () => {
    // At a 30s cadence fix age oscillates 0–30s, so a 30s warning was permanently true for
    // the whole idle fleet — the same as having no warning at all.
    const oneBeat = NOW - 35_000;
    assert.equal(fleetFlags(signals({ lastFixAtMs: oneBeat }), NOW).stale_gps, false);
    const threeBeats = NOW - 80_000;
    assert.equal(fleetFlags(signals({ lastFixAtMs: threeBeats }), NOW).stale_gps, true);
  });

  it("keeps zone claims live for a parked rider inside the idle grace", () => {
    // `hasLiveFix` gates the zone flags, so a shared threshold would also have silently
    // dropped Out of Zone for every stationary rider past 90s.
    const flags = fleetFlags(
      signals({ lastFixAtMs: pastMoving, inAssignedZone: false }),
      NOW,
    );
    assert.equal(flags.out_of_zone, true);
  });

  it("maps a status to the grace the decay clock should use", () => {
    assert.deepEqual(gpsGraceForStatus("moving", FLEET_DEFAULT_THRESHOLDS), {
      offline: FLEET_DEFAULT_THRESHOLDS.gpsOfflineSeconds,
      stale: FLEET_DEFAULT_THRESHOLDS.staleGpsSeconds,
    });
    for (const status of ["idle", "on_delivery", "on_break"] as const) {
      assert.deepEqual(gpsGraceForStatus(status, FLEET_DEFAULT_THRESHOLDS), {
        offline: FLEET_DEFAULT_THRESHOLDS.gpsOfflineIdleSeconds,
        stale: FLEET_DEFAULT_THRESHOLDS.staleGpsIdleSeconds,
      });
    }
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

  it("carries every threshold across the wire, not just remembered ones", () => {
    /*
     * The guard against the bug the shared mapping replaced. The snake_case wire mapping used
     * to be hand-written in four places — the Worker's serialiser, the Worker's `app_settings`
     * read, and both of the store's — so adding a key to `FleetThresholds` did not make it
     * travel, and a list that missed one failed *silently* because `resolveFleetThresholds`
     * substitutes the default. The Worker would enforce a new value while the browser kept the
     * old one. `Record<keyof FleetThresholds, string>` now makes an omission a type error;
     * this asserts the two directions actually agree.
     */
    const custom = resolveFleetThresholds({
      movingSpeedMps: 2,
      overspeedKmh: 80,
      lowBatteryPct: 15,
      gpsOfflineSeconds: 100,
      gpsOfflineIdleSeconds: 200,
      staleGpsSeconds: 40,
      staleGpsIdleSeconds: 90,
      idleMinutes: 7,
      zoneBufferMeters: 30,
      shiftLateGraceMinutes: 12,
    });
    const settings = fleetThresholdsAsSettings(custom);
    assert.equal(
      Object.keys(settings).length,
      Object.keys(FLEET_DEFAULT_THRESHOLDS).length,
    );
    assert.deepEqual(fleetThresholdsFromSettings(settings), custom);
  });

  it("defaults the idle thresholds when the server does not send them", () => {
    // `app_settings` has columns for the moving pair only, so production sends a bag without
    // the idle keys until a migration adds them. That must be a default, not a zero.
    const thresholds = fleetThresholdsFromSettings({ gps_offline_seconds: 100 });
    assert.equal(thresholds.gpsOfflineSeconds, 100);
    assert.equal(
      thresholds.gpsOfflineIdleSeconds,
      FLEET_DEFAULT_THRESHOLDS.gpsOfflineIdleSeconds,
    );
    assert.equal(
      thresholds.staleGpsIdleSeconds,
      FLEET_DEFAULT_THRESHOLDS.staleGpsIdleSeconds,
    );
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

describe("displaySpeedKmh", () => {
  it("floors GPS rest jitter below the moving threshold to 0 km/h", () => {
    assert.equal(displaySpeedKmh(1 / 3.6), 0);
    assert.equal(displaySpeedKmh(1.2), 0);
    assert.equal(displaySpeedKmh(1.5), 5);
    assert.equal(displaySpeedKmh(20 / 3.6), 20);
  });

  it("still shows speed for a Moving rider below the idle floor", () => {
    // tracking_status can be `moving` at 1.2 m/s (~4 km/h); zeroing that reads as a stuck pin.
    assert.equal(displaySpeedKmh(1.2, undefined, "moving"), 4);
    assert.equal(displaySpeedKmh(1.2, undefined, "idle"), 0);
  });
});
