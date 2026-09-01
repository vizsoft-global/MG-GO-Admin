import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { datePresetToBounds, parseRequestDatePreset } from "./date-presets";

describe("parseRequestDatePreset", () => {
  it("defaults to all so a hub badge is not filtered away by This month", () => {
    assert.equal(parseRequestDatePreset(undefined), "all");
    assert.equal(parseRequestDatePreset(null), "all");
    assert.equal(parseRequestDatePreset(""), "all");
    assert.equal(parseRequestDatePreset("nope"), "all");
  });

  it("keeps an explicit preset from the URL", () => {
    assert.equal(parseRequestDatePreset("this_month"), "this_month");
    assert.equal(parseRequestDatePreset("last_month"), "last_month");
    assert.equal(parseRequestDatePreset("all"), "all");
  });
});

describe("datePresetToBounds this_month", () => {
  it("excludes an Aug 31 Kuwait filing when today is 1 Sep — RCM-0074", () => {
    const now = new Date("2026-09-01T08:00:00+03:00");
    const { from, to } = datePresetToBounds("this_month", now);
    const created = new Date("2026-08-31T15:30:19+03:00");
    assert.ok(from);
    assert.ok(to);
    assert.equal(created < new Date(from), true);
    assert.equal(datePresetToBounds("all", now).from, null);
  });
});
