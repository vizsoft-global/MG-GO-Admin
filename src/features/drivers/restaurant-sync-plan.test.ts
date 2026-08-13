import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  accountStatusToRestoreAfterRestaurantSync,
  restaurantSyncPlan,
} from "./restaurant-sync-plan";

describe("restaurantSyncPlan", () => {
  it("does nothing when the mapping is unchanged so an active driver is not emptied", () => {
    assert.deepEqual(restaurantSyncPlan(["a", "b"], ["b", "a"]), {
      toAdd: [],
      toRemove: [],
    });
  });

  it("adds the new restaurant before removing the old one when replacing", () => {
    const plan = restaurantSyncPlan(["a"], ["b"]);
    assert.deepEqual(plan.toAdd, ["b"]);
    assert.deepEqual(plan.toRemove, ["a"]);
  });

  it("only inserts when growing from empty", () => {
    assert.deepEqual(restaurantSyncPlan([], ["a"]), {
      toAdd: ["a"],
      toRemove: [],
    });
  });

  it("only deletes when clearing the mapping", () => {
    assert.deepEqual(restaurantSyncPlan(["a", "b"], []), {
      toAdd: [],
      toRemove: ["a", "b"],
    });
  });
});

describe("accountStatusToRestoreAfterRestaurantSync", () => {
  it("restores Active when the restaurant trigger dropped the driver to Pending", () => {
    assert.equal(
      accountStatusToRestoreAfterRestaurantSync({
        statusBefore: "active",
        intended: null,
        statusNow: "pending",
      }),
      "active",
    );
  });

  it("does not restore when Login Status was left as intended", () => {
    assert.equal(
      accountStatusToRestoreAfterRestaurantSync({
        statusBefore: "active",
        intended: null,
        statusNow: "active",
      }),
      null,
    );
  });

  it("re-asserts Suspended when the restaurant trigger dropped the driver to Pending during Inactive save", () => {
    assert.equal(
      accountStatusToRestoreAfterRestaurantSync({
        statusBefore: "active",
        intended: "suspended",
        statusNow: "pending",
      }),
      "suspended",
    );
  });
});
