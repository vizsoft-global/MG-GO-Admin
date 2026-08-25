import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { VehicleListRow } from "./types";
import {
  parseVehicleListTab,
  vehicleListKpis,
  vehicleMatchesSearch,
  vehicleMatchesTab,
} from "./vehicles-list-utils";

function row(
  overrides: Partial<VehicleListRow> & Pick<VehicleListRow, "id" | "bike_id">,
): VehicleListRow {
  return {
    reg_number: null,
    make: null,
    model: null,
    project_type: "group",
    status: "active",
    vehicle_type_key: "bike",
    vehicle_type_label: "Bike",
    assigned_driver_id: null,
    assigned_driver_name: null,
    assigned_driver_code: null,
    assigned_on_duty: false,
    created_at: "2026-08-22T00:00:00.000Z",
    ...overrides,
  };
}

describe("parseVehicleListTab", () => {
  it("keeps the two filter tabs and defaults everything else to all", () => {
    assert.equal(parseVehicleListTab("suspended"), "suspended");
    assert.equal(parseVehicleListTab("on-duty"), "on-duty");
    assert.equal(parseVehicleListTab("all"), "all");
    assert.equal(parseVehicleListTab("unknown"), "all");
    assert.equal(parseVehicleListTab(null), "all");
  });
});

describe("vehicleMatchesTab", () => {
  it("filters suspended and on-duty independently of assignment", () => {
    const parked = row({ id: "1", bike_id: "B1", assigned_on_duty: false });
    const live = row({ id: "2", bike_id: "B2", assigned_on_duty: true });
    const held = row({ id: "3", bike_id: "B3", status: "suspended", assigned_on_duty: true });

    assert.equal(vehicleMatchesTab(parked, "all"), true);
    assert.equal(vehicleMatchesTab(held, "suspended"), true);
    assert.equal(vehicleMatchesTab(live, "suspended"), false);
    assert.equal(vehicleMatchesTab(live, "on-duty"), true);
    assert.equal(vehicleMatchesTab(parked, "on-duty"), false);
    assert.equal(vehicleMatchesTab(held, "on-duty"), true);
  });
});

describe("vehicleMatchesSearch", () => {
  it("matches plate, bike id, and assigned driver", () => {
    const assigned = row({
      id: "1",
      bike_id: "10422",
      reg_number: "KWT-88",
      assigned_driver_name: "Ali Hassan",
      assigned_driver_code: "10088",
    });
    assert.equal(vehicleMatchesSearch(assigned, "104"), true);
    assert.equal(vehicleMatchesSearch(assigned, "kwt"), true);
    assert.equal(vehicleMatchesSearch(assigned, "10088"), true);
    assert.equal(vehicleMatchesSearch(assigned, "hassan"), true);
    assert.equal(vehicleMatchesSearch(assigned, "zzz"), false);
  });
});

describe("vehicleListKpis", () => {
  it("counts the six strip cards from the full fleet", () => {
    const kpis = vehicleListKpis([
      row({ id: "1", bike_id: "A", assigned_on_duty: true }),
      row({ id: "2", bike_id: "B", status: "suspended", project_type: "rent" }),
      row({ id: "3", bike_id: "C", status: "maintenance" }),
    ]);
    assert.deepEqual(kpis, {
      total: 3,
      onDuty: 1,
      suspended: 1,
      group: 2,
      rent: 1,
      maintenance: 1,
    });
  });
});
