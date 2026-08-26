import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sameCustomFieldValues } from "./custom-field-values-equal";

/**
 * The Add form's merge effect returns the previous object when this reports
 * equality, so a false positive silently drops a value the operator typed and a
 * false negative re-opens the render loop this guard exists to close. Both
 * directions are worth pinning.
 */

describe("sameCustomFieldValues", () => {
  it("treats a map as equal to itself and to a copy", () => {
    const values = { shirt: "L", zones: ["a", "b"], active: true };
    assert.equal(sameCustomFieldValues(values, values), true);
    assert.equal(sameCustomFieldValues(values, { ...values, zones: ["a", "b"] }), true);
  });

  it("separates maps that differ in value", () => {
    assert.equal(sameCustomFieldValues({ shirt: "L" }, { shirt: "M" }), false);
    assert.equal(sameCustomFieldValues({ active: true }, { active: false }), false);
  });

  it("separates maps that differ in shape", () => {
    assert.equal(sameCustomFieldValues({ a: "1" }, { a: "1", b: "2" }), false);
    assert.equal(sameCustomFieldValues({ a: "1", b: "2" }, { a: "1" }), false);
  });

  it("does not let a missing key pass as an undefined value", () => {
    // Same key count, but `b` has a different key entirely. Reading `b.shirt`
    // yields undefined, which must not compare equal to an undefined in `a`.
    assert.equal(
      sameCustomFieldValues({ shirt: undefined }, { size: undefined }),
      false,
    );
  });

  it("compares multiselect arrays element-wise, including order", () => {
    assert.equal(sameCustomFieldValues({ z: ["a", "b"] }, { z: ["a", "b"] }), true);
    assert.equal(sameCustomFieldValues({ z: ["a", "b"] }, { z: ["b", "a"] }), false);
    assert.equal(sameCustomFieldValues({ z: ["a"] }, { z: ["a", "b"] }), false);
    assert.equal(sameCustomFieldValues({ z: [] }, { z: [] }), true);
  });

  it("never calls an array equal to a scalar", () => {
    assert.equal(sameCustomFieldValues({ z: [] }, { z: "" }), false);
    assert.equal(sameCustomFieldValues({ z: "a" }, { z: ["a"] }), false);
  });

  it("reports two empty maps as equal", () => {
    assert.equal(sameCustomFieldValues({}, {}), true);
  });
});
