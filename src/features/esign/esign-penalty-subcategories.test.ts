import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isPenaltyChild,
  PENALTY_SUBCATEGORY_KEYS,
} from "./esign-penalty-subcategories";

describe("esign penalty subcategories", () => {
  it("seeds five children under penalty", () => {
    assert.equal(PENALTY_SUBCATEGORY_KEYS.length, 5);
    assert.equal(
      isPenaltyChild({ key: "late_attendance", parent_key: "penalty" }),
      true,
    );
    assert.equal(isPenaltyChild({ key: "late_attendance", parent_key: null }), false);
    assert.equal(isPenaltyChild({ key: "loan", parent_key: "penalty" }), false);
  });
});
