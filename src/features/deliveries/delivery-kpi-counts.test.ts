import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readExactCount } from "./delivery-kpi-counts";

describe("readExactCount", () => {
  it("returns the exact count when the query succeeded", () => {
    assert.equal(readExactCount({ count: 61718, error: null }), 61718);
  });

  it("treats a successful null count as 0", () => {
    assert.equal(readExactCount({ count: null, error: null }), 0);
  });

  it("throws when the count query failed", () => {
    assert.throws(
      () => readExactCount({ count: null, error: { message: "statement timeout" } }),
      /statement timeout/,
    );
  });
});
