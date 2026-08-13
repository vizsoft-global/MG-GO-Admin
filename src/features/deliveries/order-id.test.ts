import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  displayExternalOrderId,
  isValidExternalOrderId,
  normalizeExternalOrderId,
} from "./order-id";

describe("normalizeExternalOrderId", () => {
  it("trims and strips a leading #", () => {
    assert.equal(normalizeExternalOrderId("  #100056  "), "100056");
  });

  it("returns empty for blank input", () => {
    assert.equal(normalizeExternalOrderId("   "), "");
  });
});

describe("isValidExternalOrderId", () => {
  it("accepts 1–32 ASCII digits", () => {
    assert.equal(isValidExternalOrderId("1"), true);
    assert.equal(isValidExternalOrderId("100056"), true);
    assert.equal(isValidExternalOrderId("1".repeat(32)), true);
  });

  it("rejects empty, too long, letters, symbols, emoji, and unicode digits", () => {
    assert.equal(isValidExternalOrderId(""), false);
    assert.equal(isValidExternalOrderId("1".repeat(33)), false);
    assert.equal(isValidExternalOrderId("gsshshsjsjsnnss*\":;!?"), false);
    assert.equal(isValidExternalOrderId("5573&38"), false);
    assert.equal(isValidExternalOrderId("🙄🤔🧐😅😆"), false);
    assert.equal(isValidExternalOrderId("12 345"), false);
    assert.equal(isValidExternalOrderId("000000⁰00000000000000080442"), false);
  });
});

describe("displayExternalOrderId", () => {
  it("shows a valid id in full", () => {
    assert.equal(displayExternalOrderId("100056"), "100056");
  });

  it("truncates invalid stored values so the table cannot overflow", () => {
    const junk = "v vhfhctcivkctduvlbvctducivlbobivyxtxuvkbkvyxuvvjyfyfuvidyfuvogufufghl";
    const shown = displayExternalOrderId(junk);
    assert.ok(shown.length <= 17);
    assert.ok(shown.endsWith("…"));
    assert.notEqual(shown, junk);
  });

  it("shows an em dash when missing", () => {
    assert.equal(displayExternalOrderId(null), "—");
    assert.equal(displayExternalOrderId(""), "—");
  });
});
