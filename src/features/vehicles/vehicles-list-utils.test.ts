import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { VehicleListRow } from "./types";
import {
  parseVehicleListTab,
  parseVehicleProjectFilter,
  vehicleListKpis,
  vehicleMatchesProject,
  vehicleMatchesSearch,
  vehicleMatchesTab,
} from "./vehicles-list-utils";

function row(
  overrides: Partial<VehicleListRow> & Pick<VehicleListRow, "id" | "bike_id">,
): VehicleListRow {
  return {
    reg_number: null,
    chassis_no: null,
    make: null,
    model: null,
    model_year: null,
    project_type: "group",
    status: "active",
    vehicle_type_key: "bike",
    vehicle_type_label: "Bike",
    location_text: null,
    condition: "running",
    car_type: "company",
    type_of_use: "operational",
    fuel_type: "chip",
    fuel_company: "mus",
    chip_no: null,
    fuel_monthly_limit_kwd: 30,
    owner_partner_id: null,
    owner_partner_name: null,
    replaces_vehicle_id: null,
    replacement_started_at: null,
    replaces_plate: null,
    assigned_driver_id: null,
    assigned_driver_name: null,
    assigned_driver_code: null,
    assigned_employee_id: null,
    assigned_driver_phone: null,
    assigned_project_key: null,
    assigned_accommodation: null,
    assigned_partner_name: null,
    assigned_zone_name: null,
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
  it("matches plate, chassis, bike id, company, and assigned driver", () => {
    const assigned = row({
      id: "1",
      bike_id: "TEST-FLEET-10422",
      reg_number: "KWT-88",
      chassis_no: "LSSA2ASEXRD918399",
      owner_partner_name: "Talabat",
      assigned_driver_name: "Ali Hassan",
      assigned_driver_code: "10088",
      assigned_employee_id: "55221",
    });
    assert.equal(vehicleMatchesSearch(assigned, "104"), true);
    assert.equal(vehicleMatchesSearch(assigned, "kwt"), true);
    assert.equal(vehicleMatchesSearch(assigned, "lssa"), true);
    assert.equal(vehicleMatchesSearch(assigned, "talabat"), true);
    assert.equal(vehicleMatchesSearch(assigned, "10088"), true);
    assert.equal(vehicleMatchesSearch(assigned, "55221"), true);
    assert.equal(vehicleMatchesSearch(assigned, "hassan"), true);
    assert.equal(vehicleMatchesSearch(assigned, "zzz"), false);
  });
});

describe("vehicleMatchesProject", () => {
  it("keeps blank project_key out of Keeta and Americana", () => {
    const blank = row({ id: "1", bike_id: "A", assigned_project_key: null });
    const keeta = row({ id: "2", bike_id: "B", assigned_project_key: "keeta" });
    assert.equal(parseVehicleProjectFilter("keeta"), "keeta");
    assert.equal(vehicleMatchesProject(blank, "all"), true);
    assert.equal(vehicleMatchesProject(blank, "keeta"), false);
    assert.equal(vehicleMatchesProject(keeta, "keeta"), true);
    assert.equal(vehicleMatchesProject(keeta, "americana"), false);
  });
});

describe("vehicleListKpis", () => {
  it("counts company/rent from car_type and under-repair from status", () => {
    const kpis = vehicleListKpis([
      row({ id: "1", bike_id: "A", assigned_on_duty: true, car_type: "company" }),
      row({ id: "2", bike_id: "B", status: "suspended", car_type: "rent" }),
      row({ id: "3", bike_id: "C", status: "maintenance", car_type: "maintenance" }),
    ]);
    assert.deepEqual(kpis, {
      total: 3,
      onDuty: 1,
      suspended: 1,
      company: 1,
      rent: 1,
      underRepair: 1,
    });
  });
});
