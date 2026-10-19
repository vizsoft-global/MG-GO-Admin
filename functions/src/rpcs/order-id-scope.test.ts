import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Timestamp } from "../core/fs";
import { deliveryPickupDay, isScopedDuplicate } from "./driver-deliveries";

const TODAY = "2026-10-17";
const STORE = "restaurant-1";

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    external_order_id: "80083",
    restaurant_id: STORE,
    pickup_day: TODAY,
    created_day: TODAY,
    status: "in_transit",
    ...overrides,
  };
}

function duplicate(overrides: Record<string, unknown> = {}, args: { restaurantId?: string | null; day?: string } = {}) {
  return isScopedDuplicate(row(overrides), {
    normalized: "80083",
    restaurantId: args.restaurantId === undefined ? STORE : args.restaurantId,
    day: args.day ?? TODAY,
  });
}

describe("isScopedDuplicate", () => {
  it("refuses the same order id at the same store on the same Kuwait day", () => {
    assert.equal(duplicate(), true);
  });

  it("allows the same id at a different store on the same day", () => {
    assert.equal(duplicate({ restaurant_id: "restaurant-2" }), false);
  });

  it("allows the same id at the same store on a later day", () => {
    assert.equal(duplicate({ pickup_day: "2026-10-16" }), false);
  });

  it("allows the id again once the blocking row is cancelled", () => {
    assert.equal(duplicate({ status: "cancelled" }), false);
  });

  it("treats a legacy ORDBTS spelling as the same order", () => {
    assert.equal(duplicate({ external_order_id: "ORDBTS80083" }), true);
  });

  it("ignores a different order id", () => {
    assert.equal(duplicate({ external_order_id: "80084" }), false);
  });

  it("refuses a rejected row, so a rejected proof still needs ops help", () => {
    assert.equal(duplicate({ status: "rejected" }), true);
  });

  it("does not compare an unresolved pickup with a store-scoped row", () => {
    assert.equal(duplicate({}, { restaurantId: null }), false);
  });

  it("still refuses an unresolved pickup when the old row has no store either", () => {
    assert.equal(duplicate({ restaurant_id: null }, { restaurantId: null }), true);
  });

  it("never blocks on a row whose day cannot be read", () => {
    assert.equal(
      duplicate({ pickup_day: undefined, created_day: undefined, shift_date: undefined }),
      false,
    );
  });
});

describe("deliveryPickupDay", () => {
  it("prefers the stamped pickup day", () => {
    assert.equal(deliveryPickupDay({ pickup_day: TODAY, created_day: "2026-10-10" }), TODAY);
  });

  it("falls back to created_day, then the Kuwait day of pickup_at", () => {
    assert.equal(deliveryPickupDay({ created_day: TODAY }), TODAY);
    assert.equal(
      deliveryPickupDay({ pickup_at: Timestamp.fromDate(new Date("2026-10-17T21:30:00.000Z")) }),
      "2026-10-18",
    );
  });

  it("returns null when nothing readable is stored", () => {
    assert.equal(deliveryPickupDay({}), null);
  });
});
