import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { appendDistanceSession } from "../../../../functions/src/core/vehicle-distance";
import { resolvedBikeOdometer } from "./service-maintenance-model";
import type { VehicleDayDistance } from "./types";

/**
 * The bike's daily distance ledger.
 *
 * Two riders can share one bike in a day, and one rider can clock out twice. Both
 * are handled by the same two rules: every session is a ledger row keyed by its
 * own id, and the day's total is the sum of those rows — never the rider's
 * cumulative figure copied over the top.
 *
 * GPS distance is a fallback, not an odometer: it under-reads indoors, over-reads
 * on scatter, and drifts. A rider-entered reading always outranks it.
 */

describe("day distance ledger", () => {
  it("sums two riders on one bike into one day total", () => {
    const first = appendDistanceSession(
      {},
      { driverId: "d-1", sessionId: "s-1", distanceTodayMeters: 18000 },
    );
    assert.equal(first.totalMeters, 18000);
    assert.equal(first.deltaMeters, 18000);
    assert.deepEqual(first.byDriver, { "d-1": 18000 });

    const second = appendDistanceSession(
      { byDriver: first.byDriver, sessions: first.sessions },
      { driverId: "d-2", sessionId: "s-2", distanceTodayMeters: 7000 },
    );
    // d-2's own figure is 7,000 for the day, so that is what it contributes.
    assert.equal(second.deltaMeters, 7000);
    assert.equal(second.totalMeters, 25000);
    assert.deepEqual(second.byDriver, { "d-1": 18000, "d-2": 7000 });
  });

  it("does not double count a replayed session", () => {
    const first = appendDistanceSession(
      {},
      { driverId: "d-1", sessionId: "s-1", distanceTodayMeters: 18000 },
    );
    const replay = appendDistanceSession(
      { byDriver: first.byDriver, sessions: first.sessions },
      { driverId: "d-1", sessionId: "s-1", distanceTodayMeters: 18000 },
    );
    assert.equal(replay.deltaMeters, 0);
    assert.equal(replay.totalMeters, 18000);
    assert.equal(replay.alreadyRecorded, true);
    assert.deepEqual(replay.byDriver, { "d-1": 18000 });
  });

  it("counts only what a second session added", () => {
    const first = appendDistanceSession(
      {},
      { driverId: "d-1", sessionId: "s-1", distanceTodayMeters: 12000 },
    );
    const second = appendDistanceSession(
      { byDriver: first.byDriver, sessions: first.sessions },
      // Same rider, same bike, back out after lunch: the cumulative figure is
      // now 20,000, so this session owns 8,000.
      { driverId: "d-1", sessionId: "s-2", distanceTodayMeters: 20000 },
    );
    assert.equal(second.deltaMeters, 8000);
    assert.equal(second.totalMeters, 20000);
    assert.equal(second.byDriver["d-1"], 20000);
  });

  it("never subtracts when the GPS figure shrinks", () => {
    const first = appendDistanceSession(
      {},
      { driverId: "d-1", sessionId: "s-1", distanceTodayMeters: 12000 },
    );
    const shrunk = appendDistanceSession(
      { byDriver: first.byDriver, sessions: first.sessions },
      // A lost fix and a re-acquire reports less than we already recorded.
      { driverId: "d-1", sessionId: "s-2", distanceTodayMeters: 9000 },
    );
    assert.equal(shrunk.deltaMeters, 0);
    assert.equal(shrunk.totalMeters, 12000);
  });

  it("treats a missing location figure as zero metres", () => {
    const plan = appendDistanceSession(
      {},
      { driverId: "d-1", sessionId: "s-1", distanceTodayMeters: 0 },
    );
    assert.equal(plan.deltaMeters, 0);
    assert.equal(plan.totalMeters, 0);
    assert.deepEqual(plan.byDriver, {});
  });
});

describe("bike odometer resolution", () => {
  function distance(overrides: Partial<VehicleDayDistance> = {}): VehicleDayDistance {
    return {
      id: "b-1_2026-11-04",
      vehicleId: "b-1",
      day: "2026-11-04",
      totalMeters: 0,
      byDriver: {},
      odometerKm: null,
      gpsLedgerKm: 0,
      ...overrides,
    };
  }

  it("a rider-entered reading outranks the GPS ledger", () => {
    const resolved = resolvedBikeOdometer(
      distance({ odometerKm: 18420, totalMeters: 25000, gpsLedgerKm: 25 }),
      18000,
    );
    assert.deepEqual(resolved, { km: 18420, source: "rider" });
    // The two are not added: the ledger is a fallback, not a second meter.
    assert.notEqual(resolved.km, 43000);
  });

  it("falls back to the ledger on top of the last stored figure", () => {
    const resolved = resolvedBikeOdometer(distance({ totalMeters: 25000 }), 18000);
    assert.deepEqual(resolved, { km: 18025, source: "gps_ledger" });
  });

  it("uses the stored figure when there is no distance today", () => {
    assert.deepEqual(resolvedBikeOdometer(distance(), 18000), { km: 18000, source: "stored" });
  });

  it("reports none rather than a fabricated zero", () => {
    assert.deepEqual(resolvedBikeOdometer(null, null), { km: null, source: "none" });
    assert.deepEqual(resolvedBikeOdometer(distance(), null), { km: null, source: "none" });
  });
});
