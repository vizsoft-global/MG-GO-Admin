import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  fleetDepartmentLabel,
  fleetRequestMatchesSearch,
  formatPeriodMonth,
  mergeRequiredAttachments,
  monthlyAmountTotal,
  requestNumberThisMonth,
  resolveFleetRequestVehicleId,
} from "./fleet-request-utils";

describe("resolveFleetRequestVehicleId", () => {
  it("prefers the stamped request vehicle over live assignment and latest fill", () => {
    assert.equal(
      resolveFleetRequestVehicleId({
        requestVehicleId: "req-v",
        driverVehicleId: "drv-v",
        fillVehicleId: "fill-v",
      }),
      "req-v",
    );
    assert.equal(
      resolveFleetRequestVehicleId({
        requestVehicleId: null,
        driverVehicleId: "drv-v",
        fillVehicleId: "fill-v",
      }),
      "drv-v",
    );
    assert.equal(
      resolveFleetRequestVehicleId({
        requestVehicleId: null,
        driverVehicleId: null,
        fillVehicleId: "fill-v",
      }),
      "fill-v",
    );
  });
});

describe("fleetDepartmentLabel", () => {
  it("maps approval role keys to Fleet or Accounts", () => {
    assert.equal(fleetDepartmentLabel("system"), "Fleet");
    assert.equal(fleetDepartmentLabel("manager"), "Fleet");
    assert.equal(fleetDepartmentLabel("accounts"), "Accounts");
    assert.equal(fleetDepartmentLabel(null), null);
    assert.equal(fleetDepartmentLabel("hr"), null);
  });
});

describe("requestNumberThisMonth", () => {
  it("counts the Kuwait-month ordinal for one driver", () => {
    const siblings = [
      "2026-09-01T09:00:00+03:00",
      "2026-09-02T09:00:00+03:00",
      "2026-08-30T09:00:00+03:00",
    ];
    assert.equal(requestNumberThisMonth("2026-09-01T09:00:00+03:00", siblings), 1);
    assert.equal(requestNumberThisMonth("2026-09-02T09:00:00+03:00", siblings), 2);
    assert.equal(requestNumberThisMonth("2026-08-30T09:00:00+03:00", siblings), 1);
  });
});

describe("monthlyAmountTotal", () => {
  it("sums the same Kuwait month including the current row", () => {
    const siblings = [
      { created_at: "2026-09-03T09:00:00+03:00", amount_kwd: 0.35 },
      { created_at: "2026-09-06T09:00:00+03:00", amount_kwd: 0.5 },
      { created_at: "2026-08-31T09:00:00+03:00", amount_kwd: 9 },
    ];
    assert.equal(monthlyAmountTotal("2026-09-06T09:00:00+03:00", siblings), 0.85);
  });
});

describe("fleetRequestMatchesSearch", () => {
  it("matches request id, driver, and companies", () => {
    const row = {
      request_code: "RFR-0012",
      driver_name: "MAN BAHADUR PARIYAR",
      employee_id: "13101",
      employee_company: "Talabat",
      vehicle_company: "Talabat",
      plate: "22/21647",
    };
    assert.equal(fleetRequestMatchesSearch(row, "rfr-0012"), true);
    assert.equal(fleetRequestMatchesSearch(row, "21647"), true);
    assert.equal(fleetRequestMatchesSearch(row, "keeta"), false);
  });
});

describe("formatPeriodMonth", () => {
  it("formats a year-month as a pinned English label", () => {
    assert.equal(formatPeriodMonth("2026-09"), "Sep 2026");
    assert.equal(formatPeriodMonth(null), "—");
  });
});

describe("mergeRequiredAttachments", () => {
  it("keeps required kinds in order and falls back to filename", () => {
    const rows = mergeRequiredAttachments("fuel", [
      {
        id: "1",
        title: null,
        kind: "vehicle_plate",
        file_name: "plate.jpg",
        storage_key: "a/plate.jpg",
        captured_at: null,
        source: "mobile_camera",
        created_at: "2026-09-06T09:00:00+03:00",
      },
    ]);
    assert.equal(rows[0]?.kind, "clear_fuel_invoice");
    assert.equal(rows[0]?.storage_key, "");
    assert.equal(rows[1]?.title, "plate.jpg");
    assert.equal(rows[1]?.captured_at, "2026-09-06T09:00:00+03:00");
  });

  it("pads asset handover kinds", () => {
    const rows = mergeRequiredAttachments("asset", []);
    assert.equal(rows[0]?.kind, "handover_form");
    assert.equal(rows[1]?.kind, "signed_acknowledgment");
    assert.equal(rows[0]?.storage_key, "");
  });
});
