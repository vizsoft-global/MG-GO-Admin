import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nationalityLabel } from "./nationality-label";

const labels = new Map<string, string>([
  ["indian", "Indian"],
  ["filipino", "Filipino"],
]);

describe("nationalityLabel", () => {
  it("prints the catalog label and keeps the stored country when the catalog is empty", () => {
    assert.equal(nationalityLabel(["indian"], labels, "IN"), "Indian");
    assert.equal(nationalityLabel(["indian", "filipino"], labels, "IN"), "Indian, Filipino");
    assert.equal(nationalityLabel(["unknown"], labels, "IN"), "unknown");
    assert.equal(nationalityLabel([], labels, "IN"), "IN");
    assert.equal(nationalityLabel(null, labels, "  "), null);
  });
});
