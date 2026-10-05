import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { authorizeEsignBatchDrain } from "./esign-batch-drain-auth";

describe("esign batch drain auth", () => {
  it("refuses a missing secret even with a matching bearer", () => {
    assert.equal(authorizeEsignBatchDrain("Bearer secret", ""), false);
    assert.equal(authorizeEsignBatchDrain("Bearer secret", null), false);
  });

  it("accepts only the exact bearer", () => {
    assert.equal(authorizeEsignBatchDrain("Bearer drain-secret", "drain-secret"), true);
    assert.equal(authorizeEsignBatchDrain("Bearer other", "drain-secret"), false);
    assert.equal(authorizeEsignBatchDrain("drain-secret", "drain-secret"), false);
    assert.equal(authorizeEsignBatchDrain(null, "drain-secret"), false);
  });
});
