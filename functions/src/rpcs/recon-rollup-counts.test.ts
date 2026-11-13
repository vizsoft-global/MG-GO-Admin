import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { statusDelta } from "../core/rollups";
import {
  loggedCountsFromDeliveries,
  loggedCountsFromRollups,
  splitRollupWindow,
} from "./recon-reports";

/**
 * Order Comparison may read `rollups_driver_day` instead of scanning
 * `deliveries`. That is only acceptable if both give the same number for every
 * rider-day, so the rollup rows here are built the way production builds them —
 * by replaying each delivery's status history through `statusDelta` — and the
 * two readers are compared on the result.
 */

type Delivery = {
  id: string;
  driverId: string;
  /** The booked shift day the rollup is keyed on. */
  shiftDate: string;
  /** Kuwait wall-clock completion, or null while still in transit. */
  deliveredAt: string | null;
  /** Status history, oldest first. The last entry is the stored status. */
  history: string[];
};

const kuwait = (wallClock: string) => new Date(`${wallClock}+03:00`);

const DELIVERIES: Delivery[] = [
  // An ordinary verified day.
  { id: "a1", driverId: "d1", shiftDate: "2026-11-10", deliveredAt: "2026-11-10T14:00:00", history: ["in_transit", "pending", "verified"] },
  { id: "a2", driverId: "d1", shiftDate: "2026-11-10", deliveredAt: "2026-11-10T15:00:00", history: ["in_transit", "pending"] },
  // Finished at 01:00 on the 11th, but it belongs to the shift that began on the 10th.
  { id: "a3", driverId: "d1", shiftDate: "2026-11-10", deliveredAt: "2026-11-11T01:00:00", history: ["in_transit", "pending", "verified"] },
  // Rejected and cancelled orders are not logged orders.
  { id: "a4", driverId: "d1", shiftDate: "2026-11-10", deliveredAt: "2026-11-10T16:00:00", history: ["in_transit", "pending", "rejected"] },
  { id: "a5", driverId: "d1", shiftDate: "2026-11-10", deliveredAt: null, history: ["in_transit", "cancelled"] },
  // Under review is deliberately not a logged status on this report.
  { id: "a6", driverId: "d1", shiftDate: "2026-11-10", deliveredAt: "2026-11-10T17:00:00", history: ["in_transit", "pending", "under_review"] },
  // Still on the road: no delivered_at, so the scan never sees it.
  { id: "a7", driverId: "d1", shiftDate: "2026-11-11", deliveredAt: null, history: ["in_transit"] },
  // A verified order sent back to pending and verified again counts once.
  { id: "b1", driverId: "d2", shiftDate: "2026-11-11", deliveredAt: "2026-11-11T12:00:00", history: ["in_transit", "pending", "verified", "pending", "verified"] },
  { id: "b2", driverId: "d2", shiftDate: "2026-11-12", deliveredAt: "2026-11-12T09:30:00", history: ["in_transit", "pending"] },
  // Outside the window on both sides.
  { id: "c1", driverId: "d3", shiftDate: "2026-11-09", deliveredAt: "2026-11-09T20:00:00", history: ["in_transit", "pending", "verified"] },
  { id: "c2", driverId: "d3", shiftDate: "2026-11-13", deliveredAt: "2026-11-13T08:00:00", history: ["in_transit", "pending", "verified"] },
];

function scanRows(deliveries: readonly Delivery[]) {
  return deliveries.map((delivery) => ({
    id: delivery.id,
    data: {
      driver_id: delivery.driverId,
      status: delivery.history[delivery.history.length - 1],
      delivered_at: delivery.deliveredAt ? kuwait(delivery.deliveredAt) : null,
      shift_date: delivery.shiftDate,
    },
  }));
}

/** What `applyDeliveryRollup` leaves behind after every status change has run. */
function rollupRows(deliveries: readonly Delivery[]) {
  const rows = new Map<string, Record<string, unknown>>();
  for (const delivery of deliveries) {
    const key = `${delivery.driverId}_${delivery.shiftDate}`;
    const row = rows.get(key) ?? { driver_id: delivery.driverId, day: delivery.shiftDate };
    let previous: string | null = null;
    for (const status of delivery.history) {
      for (const [counter, amount] of Object.entries(statusDelta(previous, status))) {
        row[counter] = (Number(row[counter]) || 0) + amount;
      }
      previous = status;
    }
    rows.set(key, row);
  }
  return [...rows.values()];
}

const sorted = (counts: Map<string, number>) => [...counts.entries()].sort();

describe("logged order counts: rollup against scan", () => {
  const from = "2026-11-10";
  const to = "2026-11-12";

  it("counts the same orders per rider-day from either source", () => {
    const fromScan = loggedCountsFromDeliveries(scanRows(DELIVERIES), from, to);
    const fromRollup = loggedCountsFromRollups(rollupRows(DELIVERIES), from, to);
    assert.deepEqual(sorted(fromRollup), sorted(fromScan));
  });

  it("gives the numbers the report has always printed", () => {
    const fromRollup = loggedCountsFromRollups(rollupRows(DELIVERIES), from, to);
    assert.deepEqual(sorted(fromRollup), [
      ["d1|2026-11-10", 3], // a1 + a2 + the 01:00 order; rejected, cancelled, under review left out
      ["d2|2026-11-11", 1],
      ["d2|2026-11-12", 1],
    ]);
  });

  it("files an order finished after midnight on its shift day in both", () => {
    const overnight = DELIVERIES.filter((delivery) => delivery.id === "a3");
    const fromScan = loggedCountsFromDeliveries(scanRows(overnight), from, to);
    const fromRollup = loggedCountsFromRollups(rollupRows(overnight), from, to);
    assert.deepEqual(sorted(fromScan), [["d1|2026-11-10", 1]]);
    assert.deepEqual(sorted(fromRollup), sorted(fromScan));
  });

  it("does not count an order still in transit from the rollup either", () => {
    const onTheRoad = DELIVERIES.filter((delivery) => delivery.id === "a7");
    assert.equal(loggedCountsFromRollups(rollupRows(onTheRoad), from, to).size, 0);
    assert.equal(loggedCountsFromDeliveries(scanRows(onTheRoad), from, to).size, 0);
  });

  it("reads `orders` and `verified` as one counter, never a sum", () => {
    const counts = loggedCountsFromRollups(
      [{ driver_id: "d9", day: "2026-11-10", verified: 4, orders: 4, pending: 1 }],
      from,
      to,
    );
    assert.equal(counts.get("d9|2026-11-10"), 5);
  });

  it("ignores a counter that drifted below zero", () => {
    const counts = loggedCountsFromRollups(
      [{ driver_id: "d9", day: "2026-11-10", verified: 2, pending: -1 }],
      from,
      to,
    );
    assert.equal(counts.get("d9|2026-11-10"), 2);
  });
});

describe("rollup window split", () => {
  it("scans everything while no trusted day is recorded", () => {
    assert.deepEqual(splitRollupWindow("2026-11-01", "2026-11-30", null), {
      scan: { from: "2026-11-01", to: "2026-11-30" },
      rollup: null,
    });
  });

  it("scans everything when the trusted day is after the window or malformed", () => {
    const whole = { scan: { from: "2026-11-01", to: "2026-11-30" }, rollup: null };
    assert.deepEqual(splitRollupWindow("2026-11-01", "2026-11-30", "2026-12-05"), whole);
    assert.deepEqual(splitRollupWindow("2026-11-01", "2026-11-30", "2026-02-30"), whole);
    assert.deepEqual(splitRollupWindow("2026-11-01", "2026-11-30", "soon"), whole);
  });

  it("reads the whole window from the rollup once it starts on or after the trusted day", () => {
    assert.deepEqual(splitRollupWindow("2026-11-10", "2026-11-30", "2026-11-10"), {
      scan: null,
      rollup: { from: "2026-11-10", to: "2026-11-30" },
    });
    assert.deepEqual(splitRollupWindow("2026-11-10", "2026-11-30", "2026-10-01"), {
      scan: null,
      rollup: { from: "2026-11-10", to: "2026-11-30" },
    });
  });

  it("splits a window that straddles the trusted day without overlap", () => {
    assert.deepEqual(splitRollupWindow("2026-11-01", "2026-11-30", "2026-11-12"), {
      scan: { from: "2026-11-01", to: "2026-11-11" },
      rollup: { from: "2026-11-12", to: "2026-11-30" },
    });
  });

  it("adds up to the unsplit answer when the two halves are counted separately", () => {
    const plan = splitRollupWindow("2026-11-10", "2026-11-12", "2026-11-11");
    assert.ok(plan.scan && plan.rollup);
    const scanned = loggedCountsFromDeliveries(scanRows(DELIVERIES), plan.scan.from, plan.scan.to);
    const rolled = loggedCountsFromRollups(rollupRows(DELIVERIES), plan.rollup.from, plan.rollup.to);
    const merged = new Map(scanned);
    for (const [key, count] of rolled) merged.set(key, (merged.get(key) ?? 0) + count);
    const whole = loggedCountsFromDeliveries(scanRows(DELIVERIES), "2026-11-10", "2026-11-12");
    assert.deepEqual(sorted(merged), sorted(whole));
  });
});
