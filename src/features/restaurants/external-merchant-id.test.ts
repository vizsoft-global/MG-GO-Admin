import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizeExternalMerchantId,
  validateExternalMerchantId,
} from "./external-merchant-id";

describe("normalizeExternalMerchantId", () => {
  it("strips letters and special characters", () => {
    assert.equal(normalizeExternalMerchantId("KFC-119!"), "119");
    assert.equal(normalizeExternalMerchantId("abc"), "");
  });

  it("caps at 32 digits", () => {
    assert.equal(normalizeExternalMerchantId("1".repeat(40)).length, 32);
  });
});

describe("validateExternalMerchantId", () => {
  it("allows empty (optional field)", () => {
    assert.equal(validateExternalMerchantId(""), null);
    assert.equal(validateExternalMerchantId("   "), null);
  });

  it("allows production-style numeric IDs", () => {
    assert.equal(validateExternalMerchantId("119"), null);
    assert.equal(validateExternalMerchantId("50012"), null);
  });

  it("rejects letters and special characters", () => {
    assert.equal(
      validateExternalMerchantId("KFC-119"),
      "invalid_external_merchant_id",
    );
    assert.equal(
      validateExternalMerchantId("119@talabat"),
      "invalid_external_merchant_id",
    );
  });
});
