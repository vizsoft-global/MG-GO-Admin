import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deliveryDecisionNotice } from "./delivery-decision-notice";

describe("deliveryDecisionNotice", () => {
  it("names a verified order and routes to deliveries", () => {
    const notice = deliveryDecisionNotice({
      status: "verified",
      deliveryId: "abc12345-uuid",
      orderId: "998877",
    });
    assert.equal(notice.title, "Delivery verified — 998877");
    assert.equal(notice.actionParams.record_type, "delivery");
  });

  it("uses the rejection reason as the body", () => {
    const notice = deliveryDecisionNotice({
      status: "rejected",
      deliveryId: "abc12345-uuid",
      orderId: "998877",
      reason: "Blurry proof",
    });
    assert.equal(notice.body, "Blurry proof");
  });
});
