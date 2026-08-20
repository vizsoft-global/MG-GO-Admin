import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isKuwaitLand } from "./kuwait-land";

describe("kuwait-land", () => {
  it("treats city neighborhoods as land and the Gulf as water", () => {
    assert.equal(isKuwaitLand(29.3759, 47.9774), true);
    assert.equal(isKuwaitLand(29.333, 48.028), true);
    assert.equal(isKuwaitLand(29.339, 48.057), true);
    assert.equal(isKuwaitLand(29.076, 48.084), true);
    assert.equal(isKuwaitLand(29.42, 48.0), false);
    assert.equal(isKuwaitLand(29.45, 48.1), false);
    assert.equal(isKuwaitLand(29.35, 48.25), false);
  });
});
