import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { VehicleListRow } from "./types";
import {
  applyVehicleKpi,
  assignedDriverProjectWrite,
  parseVehicleListTab,
  parseVehicleProjectFilter,
  vehicleKpiSelected,
  vehicleListKpis,
  vehicleMatchesCarType,
  vehicleMatchesKind,
  vehicleMatchesProject,
  vehicleMatchesSearch,
  vehicleMatchesStatus,
  vehicleMatchesTab,
  vehicleMatchesTypeOfUse,
  type VehicleListFilterState,
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
    const americana = row({ id: "3", bike_id: "C", assigned_project_key: "americana" });
    assert.equal(parseVehicleProjectFilter("keeta"), "keeta");
    assert.equal(parseVehicleProjectFilter("americana"), "americana");
    assert.equal(vehicleMatchesProject(blank, "all"), true);
    assert.equal(vehicleMatchesProject(blank, "keeta"), false);
    assert.equal(vehicleMatchesProject(keeta, "keeta"), true);
    assert.equal(vehicleMatchesProject(keeta, "americana"), false);
    assert.equal(vehicleMatchesProject(americana, "americana"), true);
    assert.equal(vehicleMatchesProject(americana, "keeta"), false);
  });
});

describe("assignedDriverProjectWrite", () => {
  it("writes the assigned rider project_key and skips unassigned vehicles", () => {
    assert.deepEqual(assignedDriverProjectWrite("drv-1", "keeta"), {
      driverId: "drv-1",
      project_key: "keeta",
    });
    assert.deepEqual(assignedDriverProjectWrite("drv-1", "americana"), {
      driverId: "drv-1",
      project_key: "americana",
    });
    assert.deepEqual(assignedDriverProjectWrite("drv-1", ""), {
      driverId: "drv-1",
      project_key: null,
    });
    assert.equal(assignedDriverProjectWrite(null, "keeta"), null);
    assert.equal(assignedDriverProjectWrite("", "keeta"), null);
  });
});

describe("vehicle list dimension filters", () => {
  it("matches status, car type, type of use, and kind independently", () => {
    const live = row({
      id: "1",
      bike_id: "A",
      status: "active",
      car_type: "company",
      type_of_use: "standby",
      vehicle_type_key: "bike",
    });
    assert.equal(vehicleMatchesStatus(live, "all"), true);
    assert.equal(vehicleMatchesStatus(live, "active"), true);
    assert.equal(vehicleMatchesStatus(live, "maintenance"), false);
    assert.equal(vehicleMatchesCarType(live, "company"), true);
    assert.equal(vehicleMatchesCarType(live, "rent"), false);
    assert.equal(vehicleMatchesTypeOfUse(live, "standby"), true);
    assert.equal(vehicleMatchesTypeOfUse(live, "operational"), false);
    assert.equal(vehicleMatchesKind(live, "bike"), true);
    assert.equal(vehicleMatchesKind(live, "car"), false);
  });
});

describe("applyVehicleKpi", () => {
  const base: VehicleListFilterState = {
    tab: "on-duty",
    status: "all",
    carType: "all",
    typeOfUse: "trainer",
    kind: "car",
    search: "kwt",
    project: "keeta",
  };

  it("resets extras on Total and leaves On Duty when Company is clicked", () => {
    const company = applyVehicleKpi("company", base);
    assert.equal(company.tab, "on-duty");
    assert.equal(company.carType, "company");
    assert.equal(company.typeOfUse, "trainer");
    assert.equal(company.search, "kwt");

    const total = applyVehicleKpi("total", company);
    assert.deepEqual(total, {
      tab: "all",
      status: "all",
      carType: "all",
      typeOfUse: "all",
      kind: "all",
      search: "",
      project: "all",
    });
  });

  it("puts Suspended and Under Repair on the status dropdown, not each other", () => {
    const suspended = applyVehicleKpi("suspended", base);
    assert.equal(suspended.tab, "all");
    assert.equal(suspended.status, "suspended");
    const repair = applyVehicleKpi("underRepair", suspended);
    assert.equal(repair.status, "maintenance");
    assert.equal(repair.tab, "all");
  });

  it("selects Total only when tab and dropdowns are clear", () => {
    assert.equal(
      vehicleKpiSelected("total", {
        tab: "all",
        status: "all",
        carType: "all",
        typeOfUse: "all",
        kind: "all",
      }),
      true,
    );
    assert.equal(
      vehicleKpiSelected("onDuty", { ...base, tab: "on-duty" }),
      true,
    );
    assert.equal(
      vehicleKpiSelected("company", { ...base, carType: "company" }),
      true,
    );
    assert.equal(
      vehicleKpiSelected("total", { ...base, tab: "on-duty" }),
      false,
    );
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
