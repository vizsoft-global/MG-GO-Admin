import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mergeProofKeys, MAX_DELIVERY_PROOFS } from "./delivery-proof-keys";

describe("mergeProofKeys", () => {
  it("keeps a scalar-only row", () => {
    assert.deepEqual(mergeProofKeys("drivers/a/order_proof/x.jpg"), [
      "drivers/a/order_proof/x.jpg",
    ]);
  });

  it("does not duplicate the scalar when it is also first in the array", () => {
    assert.deepEqual(
      mergeProofKeys("a.jpg", ["a.jpg", "b.jpg"]),
      ["a.jpg", "b.jpg"],
    );
  });

  it("appends array extras after the scalar", () => {
    assert.deepEqual(mergeProofKeys("a.jpg", ["b.jpg", "c.jpg"]), [
      "a.jpg",
      "b.jpg",
      "c.jpg",
    ]);
  });

  it("caps at five keys", () => {
    const urls = ["1", "2", "3", "4", "5", "6"];
    assert.equal(mergeProofKeys("0", urls).length, MAX_DELIVERY_PROOFS);
  });
});
