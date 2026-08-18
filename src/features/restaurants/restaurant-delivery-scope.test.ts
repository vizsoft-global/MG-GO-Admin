import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  restaurantActivityDeliveryId,
  shortDeliveryId,
} from "./restaurant-delivery-scope";

describe("restaurantActivityDeliveryId", () => {
  it("uses the delivery short id, not the partner order id", () => {
    const uuid = "b5da044c-1111-2222-3333-444444444444";
    assert.equal(shortDeliveryId(uuid), "B5DA044C");
    assert.equal(
      restaurantActivityDeliveryId({
        short_id: shortDeliveryId(uuid),
        external_order_id: "ID_28",
      }),
      "B5DA044C",
    );
  });
});
