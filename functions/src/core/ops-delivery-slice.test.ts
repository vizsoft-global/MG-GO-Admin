import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DELIVERED_SLICE_STATUSES, deliveredSliceStatuses, openSliceStatuses } from "./ops-delivery-slice";

/**
 * The Performance page's delivered slice.
 *
 * These two functions replaced two separate inline filters in `ops.ts` — one on
 * the query, one on the documents it returned. The point of the change is that
 * the query drops the statuses the in-memory filter would have dropped, so the
 * two must agree by construction. A drift in either direction is a silent
 * mis-count on a client-facing KPI, which is why the mapping is pinned here.
 */
describe("performance delivered slice", () => {
  it("keeps the statuses the aggregation counts and nothing else", () => {
    // `countedStatuses` in ops.ts only ever produces these three.
    assert.deepEqual(deliveredSliceStatuses(["verified"]), ["verified"]);
    assert.deepEqual(deliveredSliceStatuses(["pending"]), ["pending"]);
    assert.deepEqual(deliveredSliceStatuses(["pending", "in_transit", "verified"]), [
      "pending",
      "verified",
    ]);
  });

  it("drops a status the aggregation would discard anyway", () => {
    // Rejected / cancelled / under_review reach the query only if they are
    // counted; they are not, so the narrower read cannot lose a row.
    assert.deepEqual(deliveredSliceStatuses(["verified", "rejected", "cancelled"]), ["verified"]);
    assert.deepEqual(deliveredSliceStatuses(["under_review"]), []);
  });

  it("puts an open order on its own slice", () => {
    assert.deepEqual(openSliceStatuses(["pending", "in_transit", "verified"]), ["in_transit"]);
    assert.deepEqual(openSliceStatuses(["pending", "verified"]), []);
  });

  it("asks for no delivered read when nothing counted is delivered", () => {
    // `wantsDelivered` is `length > 0`, and an empty `in []` is not a legal
    // Firestore query — it would throw instead of returning nothing.
    assert.equal(deliveredSliceStatuses(["in_transit"]).length, 0);
    assert.equal(openSliceStatuses(["verified"]).length, 0);
  });

  it("names exactly the two delivered statuses", () => {
    assert.deepEqual([...DELIVERED_SLICE_STATUSES], ["verified", "pending"]);
  });

  it("keeps the order it was handed, so the query filter reads as the caller wrote it", () => {
    assert.deepEqual(deliveredSliceStatuses(["verified", "pending"]), ["verified", "pending"]);
  });
});
