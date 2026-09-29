import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { VehicleListRow } from "./types";
import {
  countActiveFilters,
  DEFAULT_VEHICLES_SORT,
  nextSort,
  rowMatchesColumnFilters,
  sortVehicles,
} from "./vehicles-list-query";

function row(overrides: Partial<VehicleListRow>): VehicleListRow {
  return {
    id: "1",
    bike_id: "5-6767",
    reg_number: "5/6767",
    chassis_no: null,
    make: null,
    model: "Wave",
    model_year: 2024,
    project_type: "group",
    status: "active",
    vehicle_type_key: "bike",
    vehicle_type_label: "Bike",
    location_text: null,
    condition: "running",
    car_type: "company",
    type_of_use: "operational",
    type_of_use_label: "Operational",
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
    created_at: "2026-09-29T00:00:00.000Z",
    ...overrides,
  };
}

describe("vehicles column filters", () => {
  it("ANDs text and list filters", () => {
    const wave = row({ id: "1", model: "Wave", condition: "running" });
    const pulsar = row({ id: "2", model: "Pulsar", condition: "repair_required" });
    const filters = { model: { contains: "wa" }, condition: { in: ["running"] } };
    assert.equal(rowMatchesColumnFilters(wave, filters), true);
    assert.equal(rowMatchesColumnFilters(pulsar, filters), false);
    assert.equal(countActiveFilters(filters), 2);
  });

  it("sorts plate then year", () => {
    const a = row({ id: "a", reg_number: "9/1", model_year: 2020 });
    const b = row({ id: "b", reg_number: "5/6767", model_year: 2024 });
    assert.deepEqual(
      sortVehicles([a, b], DEFAULT_VEHICLES_SORT).map((item) => item.id),
      ["b", "a"],
    );
    assert.deepEqual(
      sortVehicles([a, b], { key: "year", dir: "desc" }).map((item) => item.model_year),
      [2024, 2020],
    );
    assert.deepEqual(nextSort({ key: "plate", dir: "asc" }, "plate"), { key: "plate", dir: "desc" });
  });
});
