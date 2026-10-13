import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  attendancePct,
  bandFields,
  deliveryInProgressPeriod,
  earningsDocId,
  elapsedDays,
  offerCompleted,
  offerPendingVerification,
  offerTarget,
  parseWorkPeriod,
  remainingDeliveries,
  stripDisplayName,
} from "./driver-earnings";

const tiers = [
  {
    threshold_deliveries: 15,
    reward_mode: "per_delivery" as const,
    reward_kwd: null,
    reward_per_delivery_kwd: 0.15,
  },
  {
    threshold_deliveries: 20,
    reward_mode: "per_delivery" as const,
    reward_kwd: null,
    reward_per_delivery_kwd: 0.25,
  },
];

describe("driver-earnings helpers", () => {
  it("builds the stored daily doc id", () => {
    assert.equal(earningsDocId("drv-1", "2026-10-09"), "drv-1_2026-10-09");
  });

  it("strips a trailing ISO date from a rule display name", () => {
    assert.equal(stripDisplayName("DPD 5 2026-09-28"), "DPD 5");
    assert.equal(stripDisplayName("DPD 5"), "DPD 5");
  });

  it("counts elapsed month days the same way as the SQL work summary", () => {
    assert.equal(elapsedDays("2026-10-09", 2026, 10), 9);
    assert.equal(elapsedDays("2026-11-01", 2026, 10), 31);
    assert.equal(elapsedDays("2026-09-30", 2026, 10), 0);
  });

  it("caps attendance at 100 and refuses a zero denominator", () => {
    assert.equal(attendancePct(8, 10), 80);
    assert.equal(attendancePct(12, 10), 100);
    assert.equal(attendancePct(3, 0), 0);
  });

  it("rejects an invalid work period", () => {
    assert.equal(parseWorkPeriod(2026, 10)?.month, 10);
    assert.equal(parseWorkPeriod("2026", "2")?.year, 2026);
    assert.equal(parseWorkPeriod(2026, 13), null);
    assert.equal(parseWorkPeriod("x", 1), null);
  });

  it("uses verified count for remaining / completed / pending_verification", () => {
    assert.equal(remainingDeliveries(10, 7), 3);
    assert.equal(remainingDeliveries(10, 12), 0);
    assert.equal(offerCompleted(10, 10), true);
    assert.equal(offerCompleted(10, 9), false);
    assert.equal(offerCompleted(0, 0), true);
    assert.equal(offerPendingVerification(10, 10, 8), true);
    assert.equal(offerPendingVerification(10, 9, 8), false);
    assert.equal(offerPendingVerification(10, 12, 12), false);
  });

  it("takes the highest tier as a tiered target", () => {
    assert.equal(
      offerTarget({
        targetMode: "tiered",
        targetDeliveries: 5,
        baseMinimum: 8,
        tiers,
      }),
      20,
    );
    assert.equal(
      offerTarget({
        targetMode: "single",
        targetDeliveries: 12,
        baseMinimum: 8,
        tiers,
      }),
      12,
    );
  });

  it("locks the band until eligible reaches the start", () => {
    const locked = bandFields({ bandStart: 10, eligible: 8, tiers });
    assert.equal(locked["band_start"], 10);
    assert.equal(locked["locked"], true);
    assert.equal(locked["extra_orders"], 0);
    assert.equal(locked["current_rate_kwd"], 0.15);

    const open = bandFields({ bandStart: 10, eligible: 12, tiers });
    assert.equal(open["locked"], false);
    assert.equal(open["extra_orders"], 2);
    assert.equal(open["current_rate_kwd"], 0.15);
    assert.equal(open["orders_to_next_rate"], 3);

    assert.deepEqual(bandFields({ bandStart: null, eligible: 5, tiers }), { band_start: null });
  });

  it("attributes progress to shift_date, then delivered_at, then pickup_at", () => {
    const base = {
      id: "d1",
      driver_id: "r1",
      status: "verified",
      zone_id: null,
      partner_id: null,
      restaurant_id: null,
      external_order_id: null,
    };
    assert.equal(
      deliveryInProgressPeriod(
        { ...base, shift_date: "2026-10-09", delivered_at: null, pickup_at: null },
        "2026-10-09",
        "2026-10-09",
      ),
      true,
    );
    assert.equal(
      deliveryInProgressPeriod(
        { ...base, shift_date: "2026-10-08", delivered_at: new Date("2026-10-09T12:00:00+03:00"), pickup_at: null },
        "2026-10-09",
        "2026-10-09",
      ),
      false,
    );
    assert.equal(
      deliveryInProgressPeriod(
        { ...base, shift_date: null, delivered_at: new Date("2026-10-09T01:00:00+03:00"), pickup_at: null },
        "2026-10-09",
        "2026-10-09",
      ),
      true,
    );
    assert.equal(
      deliveryInProgressPeriod(
        { ...base, shift_date: null, delivered_at: null, pickup_at: new Date("2026-10-09T22:00:00+03:00") },
        "2026-10-09",
        "2026-10-09",
      ),
      true,
    );
  });
});
