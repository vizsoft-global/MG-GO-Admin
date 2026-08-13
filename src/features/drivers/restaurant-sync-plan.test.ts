import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { restaurantSyncPlan } from "./restaurant-sync-plan";

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
