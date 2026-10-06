import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { maskedListSender, shouldLogConfidentialView } from "./request-confidential";

describe("confidential complaint", () => {
  it("masks the sender on the list and logs the reveal", () => {
    assert.equal(maskedListSender(true, "Ali", "Confidential"), "Confidential");
    assert.equal(maskedListSender(false, "Ali", "Confidential"), "Ali");
    assert.equal(shouldLogConfidentialView(true), true);
    assert.equal(shouldLogConfidentialView(false), false);
  });
});
