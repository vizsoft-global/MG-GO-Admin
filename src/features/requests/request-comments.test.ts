import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canRiderReadComments, commentBodyValid } from "./request-comments";

describe("staff comments", () => {
  it("refuses a blank body and never exposes comments to a rider", () => {
    assert.equal(commentBodyValid("  note  "), true);
    assert.equal(commentBodyValid("   "), false);
    assert.equal(canRiderReadComments(), false);
  });
});
