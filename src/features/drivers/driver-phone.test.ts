import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  kuwaitLocalDigits,
  normalizeKuwaitPhone,
  phoneStorageToDigits,
} from "./driver-phone";

describe("kuwaitLocalDigits / normalizeKuwaitPhone", () => {
  it("accepts 8 local digits", () => {
    assert.equal(kuwaitLocalDigits("99123456"), "99123456");
    assert.equal(normalizeKuwaitPhone("99123456"), "+96599123456");
  });

  it("accepts +965 and 965 prefixes without taking the first 8 digits", () => {
    assert.equal(kuwaitLocalDigits("+96599123456"), "99123456");
    assert.equal(normalizeKuwaitPhone("+96599123456"), "+96599123456");
    assert.equal(kuwaitLocalDigits("96599123456"), "99123456");
    assert.equal(normalizeKuwaitPhone("96599123456"), "+96599123456");
  });

  it("normalizes Arabic-Indic digits via the caller’s cleaned string", () => {
    assert.equal(normalizeKuwaitPhone("٩٩١٢٣٤٥٦"), "+96599123456");
  });

  it("rejects truncated and overlong numbers", () => {
    assert.equal(normalizeKuwaitPhone("9912345"), null);
    assert.equal(normalizeKuwaitPhone("9659912345"), null);
    assert.equal(normalizeKuwaitPhone("991234567"), null);
  });

  it("round-trips stored values", () => {
    assert.equal(phoneStorageToDigits("+96599123456"), "99123456");
  });
});
