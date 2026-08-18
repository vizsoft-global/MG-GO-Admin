import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deliveryDetailNav, nextSelectedDeliveryAfterRefresh } from "./delivery-detail-nav";

describe("deliveryDetailNav", () => {
  it("keeps previous available after leaving the first row", () => {
    assert.deepEqual(deliveryDetailNav(0, 5, false), {
      hasPrevious: false,
      hasNext: true,
    });
    assert.deepEqual(deliveryDetailNav(1, 5, false), {
      hasPrevious: true,
      hasNext: true,
    });
  });

  it("keeps previous on the last loaded row", () => {
    assert.deepEqual(deliveryDetailNav(4, 5, false), {
      hasPrevious: true,
      hasNext: false,
    });
  });
});

describe("nextSelectedDeliveryAfterRefresh", () => {
  const rows = [{ id: "a" }, { id: "b" }];

  it("does not reopen the sheet after it was closed", () => {
    assert.equal(nextSelectedDeliveryAfterRefresh(null, rows), null);
  });

  it("stays closed when a refetch lands after close cleared the id", () => {
    const stillOpenId: string | null = null;
    assert.equal(nextSelectedDeliveryAfterRefresh(stillOpenId, rows), null);
  });

  it("keeps the same open row when the list refreshes", () => {
    assert.deepEqual(nextSelectedDeliveryAfterRefresh("b", rows), { id: "b" });
  });
});
