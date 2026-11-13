import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EMPLOYEE_SETTINGS_TILES,
  visibleEmployeeSettingsTiles,
} from "./employee-settings-tiles";

/**
 * Employee Settings is the header door to every employee catalog. The list is
 * permission-filtered, so a tile can never send an operator to a page that
 * answers /unauthorized.
 *
 * The client's review removed three doors and asked for eleven. Three of those
 * eleven configured a module rather than an employee (Employee fields, Service
 * types, Attendance settings), so they are gone; seven arrived as doors; the
 * remaining four are values on one rider's record and are edited on that
 * rider's profile, not in a catalog.
 */

describe("employee settings tiles", () => {
  const keys = EMPLOYEE_SETTINGS_TILES.map((tile) => tile.key);

  it("drops the three module doors the review named", () => {
    for (const gone of ["driverFields", "serviceTypes", "attendanceSettings"]) {
      assert.ok(!keys.includes(gone), `${gone} should no longer be a door`);
    }
  });

  it("offers the four catalogs that used to be compiled in code", () => {
    for (const added of [
      "nationalities",
      "hiringTypes",
      "jobEndDescriptions",
      "paymentCurrencies",
    ]) {
      assert.ok(keys.includes(added), `${added} should be a door`);
    }
    // Each one is a real catalog panel, not a link out.
    for (const tile of EMPLOYEE_SETTINGS_TILES) {
      if (["nationalities", "hiringTypes", "jobEndDescriptions", "paymentCurrencies"].includes(tile.key)) {
        assert.equal(tile.view.kind, "catalog");
      }
    }
  });

  it("offers Company, Zone and Restaurant, and keeps the seven that remain", () => {
    for (const kept of [
      "companies",
      "zones",
      "restaurants",
      "vehicleTypes",
      "employeeStatuses",
      "employeeSections",
      "nationalityCategories",
      "bankCodes",
      "jobPositions",
      "sponsorships",
      "clients",
    ]) {
      assert.ok(keys.includes(kept), `${kept} should be a door`);
    }
  });

  it("has one entry per key and per href", () => {
    assert.equal(new Set(keys).size, keys.length);
    const hrefs = EMPLOYEE_SETTINGS_TILES.map((tile) => tile.href);
    assert.equal(new Set(hrefs).size, hrefs.length);
    assert.ok(hrefs.includes("/settings/payroll-clients"));
    assert.ok(hrefs.includes("/settings/hiring-types"));
    assert.ok(hrefs.includes("/settings/job-end-descriptions"));
    assert.ok(hrefs.includes("/settings/nationalities"));
    assert.ok(hrefs.includes("/settings/payment-currencies"));
  });

  it("hides what the operator cannot open", () => {
    assert.deepEqual(visibleEmployeeSettingsTiles([], false), []);

    const driversOnly = visibleEmployeeSettingsTiles(["drivers.manage"], false);
    assert.ok(driversOnly.length > 0);
    assert.ok(driversOnly.some((tile) => tile.key === "clients"));
    assert.ok(driversOnly.some((tile) => tile.key === "hiringTypes"));
    // A tile gated on another module stays hidden.
    assert.ok(!driversOnly.some((tile) => tile.key === "vehicleTypes"));
    assert.ok(!driversOnly.some((tile) => tile.key === "zones"));
    assert.ok(!driversOnly.some((tile) => tile.key === "restaurants"));
  });

  it("gives a super admin every tile", () => {
    assert.equal(visibleEmployeeSettingsTiles([], true).length, EMPLOYEE_SETTINGS_TILES.length);
  });
});
