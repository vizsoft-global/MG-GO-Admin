import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { liveOrderDisplayId, liveOrderTimestamp } from "./live-recent-orders";

describe("live recent orders", () => {
  it("prefers the partner Order ID over a sliced uuid", () => {
    assert.equal(
      liveOrderDisplayId({
        id: "7493b738-02e3-49c8-9152-e07ac7ae3335",
        external_order_id: "1234500",
      }),
      "1234500",
    );
  });

  it("uses created_at when the latest order is still in transit", () => {
    assert.equal(
      liveOrderTimestamp({
        delivered_at: null,
        created_at: "2026-08-13T07:08:07.861Z",
      }),
      "2026-08-13T07:08:07.861Z",
    );
  });
});
