import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  attendanceCounterDelta,
  countsFromRollup,
  driverDayId,
  monthOfDay,
  singleCalendarMonth,
  statusDelta,
  verifiedDriverDayDelta,
  zoneMonthId,
} from "./rollups";

describe("rollup increment", () => {
  it("names driver-day and zone-month documents", () => {
    assert.equal(driverDayId("driver-1", "2026-10-10"), "driver-1_2026-10-10");
    assert.equal(zoneMonthId("zone-1", "2026-10"), "zone-1_2026-10");
    assert.equal(monthOfDay("2026-10-10"), "2026-10");
  });

  it("increments once and ignores a repeated status", () => {
    assert.deepEqual(statusDelta(null, "pending"), { pending: 1 });
    assert.deepEqual(statusDelta("pending", "verified"), { pending: -1, verified: 1, orders: 1 });
    assert.deepEqual(statusDelta("verified", "verified"), {});
    assert.deepEqual(statusDelta("verified", "rejected"), { verified: -1, orders: -1, rejected: 1 });
  });

  it("counts a verified driver-day once", () => {
    assert.equal(verifiedDriverDayDelta(0, 1), 1);
    assert.equal(verifiedDriverDayDelta(1, 2), 0);
    assert.equal(verifiedDriverDayDelta(1, 0), -1);
    assert.equal(attendanceCounterDelta(false, true), 1);
    assert.equal(attendanceCounterDelta(true, true), 0);
    assert.equal(attendanceCounterDelta(true, false), -1);
  });

  it("reads a rollup doc into the status-count shape", () => {
    const counts = countsFromRollup({
      verified: 4,
      pending: 1,
      in_transit: 2,
      under_review: 0,
      rejected: 1,
      cancelled: 0,
      orders: 4,
    });
    assert.equal(counts?.verified, 4);
    assert.equal(counts?.active, 2);
    assert.equal(counts?.in_progress, 3);
    assert.equal(counts?.total, 8);
    assert.equal(countsFromRollup(undefined), null);
  });

  it("recognises one calendar month", () => {
    assert.equal(singleCalendarMonth("2026-10-01", "2026-10-31"), "2026-10");
    assert.equal(singleCalendarMonth("2026-10-01", "2026-10-10"), null);
    assert.equal(singleCalendarMonth("2026-02-01", "2026-02-28"), "2026-02");
  });
});
