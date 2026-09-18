import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  carTypeToProjectType,
  defaultFuelMonthlyLimit,
  formatReplacementSince,
  isVehicleCondition,
  kuwaitYmdToIso,
  parseDriverProjectKey,
  VEHICLE_CONDITIONS,
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

  it("accepts the nine condition keys and keeps accident", () => {
    assert.deepEqual([...VEHICLE_CONDITIONS], [
      "running",
      "inventory_assembled",
      "sold",
      "deadstock",
      "stolen",
      "repair_required",
      "standby",
      "police_custody",
      "accident",
    ]);
    assert.equal(isVehicleCondition("inventory_assembled"), true);
    assert.equal(isVehicleCondition("sold"), true);
    assert.equal(isVehicleCondition("deadstock"), true);
    assert.equal(isVehicleCondition("stolen"), true);
    assert.equal(isVehicleCondition("police_custody"), true);
    assert.equal(isVehicleCondition("accident"), true);
    assert.equal(isVehicleCondition("running"), true);
    assert.equal(isVehicleCondition("unknown"), false);
  });

  it("persists only keeta or americana as project_key", () => {
    assert.equal(parseDriverProjectKey("keeta"), "keeta");
    assert.equal(parseDriverProjectKey("americana"), "americana");
    assert.equal(parseDriverProjectKey(""), null);
    assert.equal(parseDriverProjectKey("unset"), null);
    assert.equal(parseDriverProjectKey("Keeta"), null);
    assert.equal(parseDriverProjectKey(null), null);
  });
});
