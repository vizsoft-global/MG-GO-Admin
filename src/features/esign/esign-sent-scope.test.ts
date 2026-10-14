import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseSentScope } from "./esign-sent-scope";

describe("parseSentScope", () => {
  it("keeps the three tracker doors", () => {
    assert.equal(parseSentScope("all"), "all");
    assert.equal(parseSentScope("batch"), "batch");
    assert.equal(parseSentScope("individual"), "individual");
  });

  it("falls back to All when the query is missing or unknown", () => {
    assert.equal(parseSentScope(null), "all");
    assert.equal(parseSentScope(undefined), "all");
    assert.equal(parseSentScope("sent"), "all");
  });
});
