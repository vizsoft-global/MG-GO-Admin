import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  carTypeToProjectType,
  defaultFuelMonthlyLimit,
  formatReplacementSince,
  kuwaitYmdToIso,
} from "./fleet-labels";

describe("fleet labels", () => {
  it("maps car type to the legacy project_type column without using maintenance", () => {
    assert.equal(carTypeToProjectType("company"), "group");
    assert.equal(carTypeToProjectType("maintenance"), "group");
    assert.equal(carTypeToProjectType("rent"), "rent");
  });

  it("defaults the monthly fuel cap from kind", () => {
    assert.equal(defaultFuelMonthlyLimit("bike"), 30);
    assert.equal(defaultFuelMonthlyLimit("car"), 60);
  });

  it("formats replacement age in whole days", () => {
    const now = Date.parse("2026-09-11T12:00:00.000Z");
    assert.equal(formatReplacementSince("2026-09-03T00:00:00.000Z", now), "8 days");
    assert.equal(formatReplacementSince("2026-09-10T12:00:00.000Z", now), "1 day");
    assert.equal(formatReplacementSince("2026-09-11T08:00:00.000Z", now), "Today");
    assert.equal(formatReplacementSince(null, now), null);
  });

  it("stores a Kuwait calendar date as +03:00 midnight", () => {
    assert.equal(kuwaitYmdToIso("2026-09-01"), "2026-09-01T00:00:00+03:00");
    assert.equal(kuwaitYmdToIso("nope"), null);
  });
});
