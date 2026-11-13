import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { masterFilterValues } from "./hr-inline-cells";

describe("masterFilterValues", () => {
  it("puts what the sheet holds first, then the rest of the master", () => {
    assert.deepEqual(masterFilterValues(["KFC", "Pizza Hut"], ["Pizza Hut", "Burger King"]), [
      "KFC",
      "Pizza Hut",
      "Burger King",
    ]);
  });

  it("offers a value added to the master before anyone carries it", () => {
    // The sync requirement: a new restaurant is pickable on the filter at once.
    assert.deepEqual(masterFilterValues([], ["New Place"]), ["New Place"]);
  });

  it("drops the dashes the sheet prints for an empty cell", () => {
    assert.deepEqual(masterFilterValues(["—", "KFC"], ["—"]), ["KFC"]);
  });

  it("trims, dedupes case-sensitively and keeps order stable", () => {
    assert.deepEqual(masterFilterValues([" KFC ", "KFC"], ["KFC", "kfc"]), ["KFC", "kfc"]);
  });

  it("returns nothing when both sides are empty", () => {
    assert.deepEqual(masterFilterValues([], []), []);
  });
});
