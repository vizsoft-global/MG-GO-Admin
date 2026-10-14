import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deliveryDecisionNotice } from "./delivery-notify";

describe("deliveryDecisionNotice", () => {
  it("names a verified order and routes to deliveries", () => {
    const notice = deliveryDecisionNotice({
      status: "verified",
      deliveryId: "abc12345-uuid",
      orderId: "998877",
    });
    assert.equal(notice.title, "Delivery verified — 998877");
    assert.equal(notice.body, "Order 998877 has been verified.");
    assert.equal(notice.actionParams.record_type, "delivery");
    assert.equal(notice.actionParams.record_id, "abc12345-uuid");
    assert.equal(notice.deepLink, "musallam:///deliveries");
  });

  it("uses the rejection reason as the body", () => {
    const notice = deliveryDecisionNotice({
      status: "rejected",
      deliveryId: "abc12345-uuid",
      orderId: "998877",
      reason: "Blurry proof",
    });
    assert.equal(notice.title, "Delivery rejected — 998877");
    assert.equal(notice.body, "Blurry proof");
  });

  it("falls back to a short delivery id when the order id is missing", () => {
    const notice = deliveryDecisionNotice({
      status: "rejected",
      deliveryId: "deadbeef-rest",
      orderId: "  ",
      reason: null,
    });
    assert.equal(notice.title, "Delivery rejected — DEADBEEF");
    assert.equal(notice.body, "Order DEADBEEF was rejected.");
  });
});
