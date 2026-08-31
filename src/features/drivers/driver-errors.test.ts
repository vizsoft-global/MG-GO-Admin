import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isValidEmployeeId, normalizeEmployeeId } from "./driver-errors";

describe("employee ID format (letters and digits, 1–100)", () => {
  it("accepts short numeric IDs that already exist in the fleet", () => {
    assert.equal(isValidEmployeeId("123"), true);
    assert.equal(normalizeEmployeeId("123"), "123");
    assert.equal(normalizeEmployeeId("1234"), "1234");
    assert.equal(normalizeEmployeeId("12345678"), "12345678");
  });

  it("accepts alphanumeric values up to 100 characters", () => {
    assert.equal(normalizeEmployeeId("EMP2048"), "EMP2048");
    assert.equal(normalizeEmployeeId("12ab"), "12ab");
    assert.equal(normalizeEmployeeId("A".repeat(100)), "A".repeat(100));
  });

  it("rejects empty, punctuation, and over-long values", () => {
    assert.equal(normalizeEmployeeId(""), null);
    assert.equal(normalizeEmployeeId("EMP-123"), null);
    assert.equal(normalizeEmployeeId("12345678901".slice(0, 0)), null);
    assert.equal(normalizeEmployeeId("A".repeat(101)), null);
  });
});
