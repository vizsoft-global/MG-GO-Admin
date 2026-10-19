import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateDeliveryZone,
  flagLabelsFor,
  isEarlyDrop,
  normalizeOrderIdForProof,
  normalizeProofOcrMode,
  orderIdsMatch,
  proofOcrDecision,
} from "./delivery-flags";

const SQUARE = {
  id: "z1",
  zone_type: "polygon",
  geometry: {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [47.97, 29.37],
          [47.99, 29.37],
          [47.99, 29.38],
          [47.97, 29.38],
          [47.97, 29.37],
        ],
      ],
    },
  },
};

describe("delivery flags", () => {
  it("uses the 50 m boundary inclusively", () => {
    assert.equal(isEarlyDrop(50, 50), true);
    assert.equal(isEarlyDrop(50.01, 50), false);
    assert.equal(isEarlyDrop(null, 50), false);
  });

  it("labels early drop before outside zone and never invents a check", () => {
    assert.deepEqual(flagLabelsFor({ earlyDrop: true, outOfZone: false }), ["early_drop"]);
    assert.deepEqual(flagLabelsFor({ earlyDrop: false, outOfZone: true }), ["outside_zone"]);
    assert.deepEqual(flagLabelsFor({ earlyDrop: true, outOfZone: true }), [
      "early_drop",
      "outside_zone",
    ]);
    assert.deepEqual(flagLabelsFor({ earlyDrop: false, outOfZone: null }), []);
  });

  it("evaluates a delivered point against the zone", () => {
    const inside = evaluateDeliveryZone(29.375, 47.978, SQUARE);
    assert.equal(inside?.inside, true);
    assert.ok((inside?.distanceM ?? 0) > 0);
    const outside = evaluateDeliveryZone(29.5, 47.978, SQUARE);
    assert.equal(outside?.inside, false);
    assert.equal(evaluateDeliveryZone(29.375, 47.978, null), null);
  });

  it("normalizes OCR values and compares suffixes safely", () => {
    assert.equal(normalizeOrderIdForProof(" #ab-12 34 "), "AB1234");
    assert.equal(normalizeOrderIdForProof("   "), null);
    assert.equal(orderIdsMatch("AB1234", "AB-1234"), true);
    assert.equal(orderIdsMatch("123456", "3456"), true);
    assert.equal(orderIdsMatch("1234", "9999"), false);
    assert.equal(orderIdsMatch(null, "1234"), null);
  });

  it("blocks a mismatch only in block mode without an override", () => {
    assert.equal(normalizeProofOcrMode("warn"), "warn");
    assert.equal(normalizeProofOcrMode("nonsense"), "block");
    assert.equal(proofOcrDecision({ mode: "block", matched: false }), "block");
    assert.equal(proofOcrDecision({ mode: "block", matched: false, overrideReason: "blurred" }), "accept");
    assert.equal(proofOcrDecision({ mode: "warn", matched: false }), "accept");
    assert.equal(proofOcrDecision({ mode: "block", matched: true }), "accept");
    assert.equal(proofOcrDecision({ mode: "block", matched: null }), "accept");
  });
});
