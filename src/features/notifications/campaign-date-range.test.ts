import assert from "node:assert/strict";
import test from "node:test";
import { campaignDateBounds, campaignDayBounds, kuwaitTodayString } from "./campaign-date-range";

test("a single day spans Kuwait midnight to 23:59:59.999", () => {
  const bounds = campaignDateBounds("2026-11-05", "2026-11-05");
  assert.equal(bounds.fromIso, "2026-11-04T21:00:00.000Z");
  assert.equal(bounds.toIso, "2026-11-05T20:59:59.999Z");
});

test("the last millisecond of the end day is inside the range", () => {
  const bounds = campaignDateBounds("2026-11-01", "2026-11-05");
  const lastMoment = "2026-11-05T20:59:59.999Z";
  assert.ok(bounds.toIso);
  assert.ok(lastMoment <= bounds.toIso);
  const afterEnd = "2026-11-05T21:00:00.000Z";
  assert.ok(afterEnd > bounds.toIso);
});

test("the first millisecond of the start day is inside the range", () => {
  const bounds = campaignDateBounds("2026-11-01", "2026-11-05");
  assert.ok(bounds.fromIso);
  assert.equal(bounds.fromIso, "2026-10-31T21:00:00.000Z");
  assert.ok("2026-10-31T21:00:00.000Z" >= bounds.fromIso);
  assert.ok("2026-10-31T20:59:59.999Z" < bounds.fromIso);
});

test("inverted dates are swapped instead of dropped", () => {
  const inverted = campaignDateBounds("2026-11-05", "2026-11-01");
  const ordered = campaignDateBounds("2026-11-01", "2026-11-05");
  assert.deepEqual(inverted, ordered);
});

test("blank and malformed input yield no bound", () => {
  assert.deepEqual(campaignDateBounds("", ""), {
    fromIso: undefined,
    toIso: undefined,
    fromDate: undefined,
    toDate: undefined,
  });
  assert.equal(campaignDateBounds("05/11/2026").fromIso, undefined);
  assert.equal(campaignDateBounds("   ").toIso, undefined);
});

test("one-sided ranges keep the given side only", () => {
  const fromOnly = campaignDateBounds("2026-11-01", "");
  assert.equal(fromOnly.fromIso, "2026-10-31T21:00:00.000Z");
  assert.equal(fromOnly.toIso, undefined);
  const toOnly = campaignDateBounds(undefined, "2026-11-05");
  assert.equal(toOnly.fromIso, undefined);
  assert.equal(toOnly.toIso, "2026-11-05T20:59:59.999Z");
});

test("campaignDayBounds defaults to the Kuwait day", () => {
  const at = new Date("2026-11-05T22:30:00.000Z");
  assert.equal(kuwaitTodayString(at), "2026-11-06");
  const bounds = campaignDayBounds();
  assert.deepEqual(campaignDayBounds(kuwaitTodayString()), bounds);
  assert.ok(bounds.fromIso && bounds.toIso);
  assert.ok(bounds.fromIso < bounds.toIso);
});

test("the Kuwait day rolls over at 21:00 UTC", () => {
  assert.equal(kuwaitTodayString(new Date("2026-11-05T20:59:59.999Z")), "2026-11-05");
  assert.equal(kuwaitTodayString(new Date("2026-11-05T21:00:00.000Z")), "2026-11-06");
});
