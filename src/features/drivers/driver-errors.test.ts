import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isValidEmployeeId, normalizeEmployeeId } from "./driver-errors";

describe("employee ID format (matches app login 4–8 digits)", () => {
  it("rejects 3 digits so admin cannot create an ID the app will not accept", () => {
    assert.equal(isValidEmployeeId("123"), false);
    assert.equal(normalizeEmployeeId("123"), null);
  });

  it("accepts 4 and 8 digits", () => {
    assert.equal(normalizeEmployeeId("1234"), "1234");
    assert.equal(normalizeEmployeeId("12345678"), "12345678");
  });

  it("rejects 9 digits and non-digits", () => {
    assert.equal(normalizeEmployeeId("123456789"), null);
    assert.equal(normalizeEmployeeId("12ab"), null);
  });
});
