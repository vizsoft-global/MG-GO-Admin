import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { liveRecentOrderDisplayStatus } from "./live-recent-orders";

describe("liveRecentOrderDisplayStatus", () => {
  it("shows On Delivery while the pickup is still in transit", () => {
    assert.equal(
      liveRecentOrderDisplayStatus({ status: "in_transit", deliveredAt: null }),
      "on_delivery",
    );
  });

  it("shows Delivered after the rider finishes, even if review is still pending", () => {
    assert.equal(
      liveRecentOrderDisplayStatus({
        status: "pending",
        deliveredAt: "2026-08-14T10:00:00.000Z",
      }),
      "delivered",
    );
    assert.equal(
      liveRecentOrderDisplayStatus({
        status: "under_review",
        deliveredAt: "2026-08-14T10:00:00.000Z",
      }),
      "delivered",
    );
  });

  it("keeps Pending when the order has not been finished yet", () => {
    assert.equal(
      liveRecentOrderDisplayStatus({ status: "pending", deliveredAt: null }),
      "pending",
    );
  });
});
