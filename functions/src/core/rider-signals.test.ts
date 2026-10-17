import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { riderSignalPatch, signalKeysForRecordType } from "./rider-signals";

describe("signalKeysForRecordType", () => {
  it("routes each inbox item to the screen it links to", () => {
    assert.deepEqual(signalKeysForRecordType("request"), ["inbox", "requests"]);
    assert.deepEqual(signalKeysForRecordType("esign"), ["inbox", "esign"]);
    assert.deepEqual(signalKeysForRecordType("appointment"), ["inbox", "visits"]);
    assert.deepEqual(signalKeysForRecordType("delivery"), ["inbox", "home", "earnings"]);
    assert.deepEqual(signalKeysForRecordType("compliance"), ["inbox", "home", "earnings"]);
  });

  it("falls back to the inbox for unknown or missing types", () => {
    assert.deepEqual(signalKeysForRecordType(undefined), ["inbox"]);
    assert.deepEqual(signalKeysForRecordType(42), ["inbox"]);
    assert.deepEqual(signalKeysForRecordType("campaign"), ["inbox"]);
  });
});

describe("riderSignalPatch", () => {
  it("bumps each counter once and caps the reason", () => {
    const patch = riderSignalPatch(["home", "home", "earnings"], "x".repeat(100), 123);
    assert.equal(patch.updated_at_ms, 123);
    assert.equal((patch.last_reason as string).length, 64);
    assert.ok("home_rev" in patch);
    assert.ok("earnings_rev" in patch);
    assert.equal(Object.keys(patch).length, 4);
  });
});
