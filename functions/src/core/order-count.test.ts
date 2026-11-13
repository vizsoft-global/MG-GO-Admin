import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  RECORDED_ORDER_STATUSES,
  isRecordedOrderStatus,
  recordedOrdersOf,
  verifiedOrdersOf,
} from "./order-count";

describe("verifiedOrdersOf", () => {
  it("reads either counter, because both writers exist", () => {
    assert.equal(verifiedOrdersOf({ verified: 7 }), 7);
    assert.equal(verifiedOrdersOf({ orders: 7 }), 7);
    assert.equal(verifiedOrdersOf({ verified: 7, orders: 7 }), 7);
  });

  it("never sums the two aliases", () => {
    // A row written by both paths carries the same count twice; summing would
    // double a rider's day.
    assert.equal(verifiedOrdersOf({ verified: 12, orders: 12 }), 12);
  });

  it("takes the larger when the aliases disagree, which is a partial write", () => {
    assert.equal(verifiedOrdersOf({ verified: 9, orders: 12 }), 12);
    assert.equal(verifiedOrdersOf({ verified: 12, orders: 9 }), 12);
  });

  it("treats missing, negative and non-finite as zero", () => {
    assert.equal(verifiedOrdersOf({}), 0);
    assert.equal(verifiedOrdersOf({ verified: -3 }), 0);
    assert.equal(verifiedOrdersOf({ verified: Number.NaN }), 0);
    assert.equal(verifiedOrdersOf({ verified: null, orders: undefined }), 0);
  });
});

describe("recordedOrdersOf", () => {
  it("counts a waiting order as recorded", () => {
    // Delivered but not yet verified: the rider did the work, the office has not
    // stamped it. Payroll prints it; Earnings does not pay it.
    assert.equal(recordedOrdersOf({ verified: 0, pending: 4 }), 4);
  });

  it("counts under_review, which the payroll cell used to drop", () => {
    // The regression behind "orders are not reflected in Payroll": a day whose
    // deliveries were all in review read 0.
    assert.equal(recordedOrdersOf({ verified: 0, pending: 0, under_review: 5 }), 5);
  });

  it("adds the three completed states", () => {
    assert.equal(recordedOrdersOf({ verified: 6, pending: 2, under_review: 3 }), 11);
  });

  it("is never below the verified count", () => {
    for (const row of [
      { verified: 9 },
      { verified: 9, pending: 0, under_review: 0 },
      { orders: 9, pending: 1 },
    ]) {
      assert.ok(recordedOrdersOf(row) >= verifiedOrdersOf(row));
    }
  });

  it("reads a legacy row with no pending counters", () => {
    assert.equal(recordedOrdersOf({ orders: 8 }), 8);
  });
});

describe("status vocabulary", () => {
  it("includes exactly the three completed states", () => {
    assert.deepEqual([...RECORDED_ORDER_STATUSES], ["pending", "under_review", "verified"]);
  });

  it("excludes work in progress and dead orders", () => {
    for (const status of ["in_transit", "rejected", "cancelled", "", "verified "]) {
      assert.equal(isRecordedOrderStatus(status), false, status);
    }
  });
});
