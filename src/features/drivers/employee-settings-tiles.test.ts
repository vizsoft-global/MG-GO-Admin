import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EMPLOYEE_SETTINGS_TILES,
  visibleEmployeeSettingsTiles,
} from "./employee-settings-tiles";

/**
 * Employee Settings is the header door to every employee catalog. The list is
 * permission-filtered, so a tile can never send an operator to a page that
 * answers /unauthorized, and the Client catalog is one of the ten.
 */

describe("employee settings tiles", () => {
  it("lists the nine catalogs plus Clients, each once", () => {
    const keys = EMPLOYEE_SETTINGS_TILES.map((tile) => tile.key);
    assert.equal(keys.length, 10);
    assert.equal(new Set(keys).size, keys.length);
    assert.ok(keys.includes("clients"));
    const hrefs = EMPLOYEE_SETTINGS_TILES.map((tile) => tile.href);
    assert.equal(new Set(hrefs).size, hrefs.length);
    assert.ok(hrefs.includes("/settings/payroll-clients"));
  });

  it("hides what the operator cannot open", () => {
    const none = visibleEmployeeSettingsTiles([], false);
    assert.deepEqual(none, []);

    const driversOnly = visibleEmployeeSettingsTiles(["drivers.manage"], false);
    assert.ok(driversOnly.length > 0);
    assert.ok(driversOnly.every((tile) => tile.permission === "drivers.manage"));
    assert.ok(driversOnly.some((tile) => tile.key === "clients"));
    assert.ok(!driversOnly.some((tile) => tile.key === "vehicleTypes"));
    // Custom columns is shared configuration: holding `drivers.manage` is not
    // enough, because the page itself answers /unauthorized for a non-super-admin.
    assert.ok(!driversOnly.some((tile) => tile.key === "driverFields"));
  });

  it("gives a super admin every tile", () => {
    assert.equal(visibleEmployeeSettingsTiles([], true).length, EMPLOYEE_SETTINGS_TILES.length);
  });

  it("keeps custom columns for a super admin holding the tick", () => {
    const tiles = visibleEmployeeSettingsTiles(["drivers.manage"], true);
    assert.ok(tiles.some((tile) => tile.key === "driverFields"));
  });
});
