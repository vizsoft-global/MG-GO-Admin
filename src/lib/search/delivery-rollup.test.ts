import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deliveryStatusDelta } from "./delivery-rollup";
import { stampedPatch } from "./prefix";

describe("delivery status rollup delta", () => {
  it("is a no-op when the status does not change", () => {
    assert.deepEqual(deliveryStatusDelta("pending", "pending"), {});
  });

  it("moves one count from pending to verified and adds an order", () => {
    assert.deepEqual(deliveryStatusDelta("pending", "verified"), {
      pending: -1,
      verified: 1,
      orders: 1,
    });
  });
});

describe("stampedPatch deliveries", () => {
  it("writes the lowercase order id onto the patch", () => {
    const patch = stampedPatch(
      "deliveries",
      { external_order_id: "ORD-42", driver_name: "Ada" },
      { status: "verified" },
    );
    assert.equal(patch.status, "verified");
    assert.equal(patch.order_id_lower, "ord-42");
    assert.equal(patch.driver_name_lower, "ada");
    assert.equal(patch.rider_name_lower, "ada");
  });
});
