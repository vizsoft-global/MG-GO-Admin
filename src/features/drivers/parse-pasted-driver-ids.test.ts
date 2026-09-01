import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeDriverLookupIds, parsePastedDriverLookupIds } from "./parse-pasted-driver-ids";

describe("parsePastedDriverLookupIds", () => {
  it("splits commas, spaces, and newlines", () => {
    assert.deepEqual(parsePastedDriverLookupIds("12345, 67890\n11223"), [
      "12345",
      "67890",
      "11223",
    ]);
  });

  it("splits Arabic comma / semicolon", () => {
    assert.deepEqual(parsePastedDriverLookupIds("12345،67890؛11223"), [
      "12345",
      "67890",
      "11223",
    ]);
  });

  it("strips zero-width and quote characters", () => {
    assert.deepEqual(parsePastedDriverLookupIds("'\u200B12345'\n\"67890\""), [
      "12345",
      "67890",
    ]);
  });

  it("coerces Excel decimal and scientific forms", () => {
    assert.deepEqual(parsePastedDriverLookupIds("12345.0\n1.0000035e7"), [
      "12345",
      "10000035",
    ]);
  });

  it("keeps alphanumeric employee IDs and splits a label from a number", () => {
    assert.deepEqual(parsePastedDriverLookupIds("EMP2048, Emp 26063"), [
      "EMP2048",
      "Emp",
      "26063",
    ]);
  });

  it("rejects a 101-character token", () => {
    assert.deepEqual(parsePastedDriverLookupIds("A".repeat(101)), []);
  });
});

describe("normalizeDriverLookupIds", () => {
  it("re-parses an array of messy tokens", () => {
    assert.deepEqual(normalizeDriverLookupIds([" 12345 ", "67890.0", ""]), [
      "12345",
      "67890",
    ]);
  });
});
