import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatFieldValue } from "./request-typed-fields";

describe("formatFieldValue", () => {
  it("formats a date-only value as a Kuwait calendar day", () => {
    assert.equal(formatFieldValue("2026-09-17"), "17 Sep 2026");
  });
});
