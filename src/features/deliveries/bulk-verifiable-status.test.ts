import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isBulkVerifiableDeliveryStatus } from "./bulk-verifiable-status";

describe("isBulkVerifiableDeliveryStatus", () => {
  it("allows pending and under_review", () => {
    assert.equal(isBulkVerifiableDeliveryStatus("pending"), true);
    assert.equal(isBulkVerifiableDeliveryStatus("under_review"), true);
  });

  it("skips live, already-decided, and cancelled rows", () => {
    assert.equal(isBulkVerifiableDeliveryStatus("in_transit"), false);
    assert.equal(isBulkVerifiableDeliveryStatus("verified"), false);
    assert.equal(isBulkVerifiableDeliveryStatus("rejected"), false);
    assert.equal(isBulkVerifiableDeliveryStatus("cancelled"), false);
  });
});
