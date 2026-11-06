import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  dropColumnInOrder,
  mergeColumnOrder,
  moveColumnInOrder,
  orderByIds,
  systemColumnPreference,
} from "./table-column-order";

describe("mergeColumnOrder", () => {
  it("keeps the saved order and appends columns added later", () => {
    const merged = mergeColumnOrder(["a", "b", "c", "d"], ["c", "a", "b"]);
    assert.deepEqual(merged, ["c", "a", "b", "d"]);
  });

  it("drops ids that no longer exist and duplicates", () => {
    const merged = mergeColumnOrder(["a", "b"], ["b", "gone", "b", "a"]);
    assert.deepEqual(merged, ["b", "a"]);
  });

  it("falls back to catalogue order with no saved preference", () => {
    assert.deepEqual(mergeColumnOrder(["a", "b"], null), ["a", "b"]);
    assert.deepEqual(mergeColumnOrder(["a", "b"], []), ["a", "b"]);
  });
});

describe("moveColumnInOrder", () => {
  it("swaps with the neighbour above and below", () => {
    assert.deepEqual(moveColumnInOrder(["a", "b", "c"], "b", -1), ["b", "a", "c"]);
    assert.deepEqual(moveColumnInOrder(["a", "b", "c"], "b", 1), ["a", "c", "b"]);
  });

  it("is a no-op off either end", () => {
    assert.deepEqual(moveColumnInOrder(["a", "b"], "a", -1), ["a", "b"]);
    assert.deepEqual(moveColumnInOrder(["a", "b"], "b", 1), ["a", "b"]);
    assert.deepEqual(moveColumnInOrder(["a", "b"], "missing", 1), ["a", "b"]);
  });
});

describe("dropColumnInOrder", () => {
  it("moves the dragged column into the dropped slot", () => {
    assert.deepEqual(dropColumnInOrder(["a", "b", "c", "d"], "d", "b"), ["a", "d", "b", "c"]);
    assert.deepEqual(dropColumnInOrder(["a", "b", "c", "d"], "a", "c"), ["b", "c", "a", "d"]);
  });

  it("is a no-op when the drag starts or ends nowhere", () => {
    assert.deepEqual(dropColumnInOrder(["a", "b"], "a", "a"), ["a", "b"]);
    assert.deepEqual(dropColumnInOrder(["a", "b"], "a", "missing"), ["a", "b"]);
  });
});

describe("systemColumnPreference", () => {
  it("shows every column in catalogue order", () => {
    assert.deepEqual(systemColumnPreference(["a", "b"]), {
      order: ["a", "b"],
      visible: ["a", "b"],
      sort: null,
    });
  });
});

describe("orderByIds", () => {
  it("resolves ids to catalogue entries and skips unknown ids", () => {
    const byId = new Map([
      ["a", { id: "a" }],
      ["b", { id: "b" }],
    ]);
    assert.deepEqual(orderByIds(["b", "gone", "a"], byId), [{ id: "b" }, { id: "a" }]);
  });
});
