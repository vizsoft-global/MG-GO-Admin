import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeSecuritySeverity } from "./driver-security";

describe("normalizeSecuritySeverity", () => {
  it("accepts Flutter and SQL spellings", () => {
    assert.equal(normalizeSecuritySeverity("info"), "info");
    assert.equal(normalizeSecuritySeverity("WARNING"), "warning");
    assert.equal(normalizeSecuritySeverity("blocked"), "blocked");
    assert.equal(normalizeSecuritySeverity("high"), "high");
    assert.equal(normalizeSecuritySeverity("nope"), null);
    assert.equal(normalizeSecuritySeverity(1), null);
  });
});
