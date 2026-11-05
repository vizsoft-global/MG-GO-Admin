import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildProgramRows,
  DEFAULT_MAINTENANCE_SETTINGS,
  type MaintenanceDoneRecord,
  type MaintenanceVehicle,
} from "./service-maintenance-model";
import {
  approvedRulesAsSchedules,
  maintenanceProgramsFromCatalog,
  type MaintenanceProgram,
} from "./service-programs";
import type { MaintenanceOverride, MaintenanceScheduleRow } from "./types";

/**
 * Two client asks in one contract: any maintenance service can be scheduled from
 * the catalog, and a due point can be set by hand per vehicle without rewriting
 * the interval for the rest of the fleet.
 */

const TODAY = "2026-03-01";
const RULES = approvedRulesAsSchedules();
const SETTINGS = { ...DEFAULT_MAINTENANCE_SETTINGS, provisional: false };

const CAR: MaintenanceVehicle = {
  id: "car-1",
  plate: "23/21208",
  chassisNo: null,
  make: "Toyota",
  model: "Yaris",
  condition: "running",
  vehicleTypeKey: "car",
  zoneName: null,
  driverName: null,
  currentKm: 74500,
};

function oilDone(): MaintenanceDoneRecord {
  return {
    id: "svc-oil",
    vehicleId: CAR.id,
    serviceTypeKey: "oil_change",
    doneDay: "2026-02-20",
    odometerKm: 74000,
  };
}

function rows(options: {
  records?: MaintenanceDoneRecord[];
  schedules?: MaintenanceScheduleRow[];
  overrides?: MaintenanceOverride[];
  programs?: MaintenanceProgram[];
}) {
  return buildProgramRows({
    vehicles: [CAR],
    doneRecords: options.records ?? [oilDone()],
    schedules: options.schedules ?? RULES,
    settings: SETTINGS,
    overrides: options.overrides,
    programs: options.programs,
    today: TODAY,
  });
}

function row(programKey: string, options: Parameters<typeof rows>[0] = {}) {
  const found = rows(options).find((entry) => entry.programKey === programKey);
  assert.ok(found, `${programKey} row missing`);
  return found;
}

/** A catalog service type the fleet team marked as tracked. */
const CUSTOM_TYPE = {
  key: "cabin_filter",
  label_en: "Cabin filter",
  label_ar: "فلتر المكيف",
  category: "ac",
  sort_order: 15,
  tracks_maintenance: true,
};

function customRule(overrides: Partial<MaintenanceScheduleRow> = {}): MaintenanceScheduleRow {
  return {
    id: "rule_cabin_car",
    scope: "vehicle_type",
    vehicle_id: null,
    make_model_key: null,
    make_key: null,
    vehicle_type_key: "car",
    service_type_key: "cabin_filter",
    service_type_label: "Cabin filter",
    km_interval: 20000,
    day_interval: 0,
    alert_km: 500,
    alert_days: 5,
    is_active: true,
    created_at: null,
    updated_at: null,
    ...overrides,
  };
}

describe("programs come from the catalog, not a hardcoded list", () => {
  it("adds a tracked service type as a schedulable program", () => {
    const programs = maintenanceProgramsFromCatalog([
      { key: "oil_change", label_en: "Oil change", tracks_maintenance: true },
      CUSTOM_TYPE,
      { key: "oil_filter", label_en: "Oil filter", tracks_maintenance: false },
    ]);
    const keys = programs.map((program) => program.key);
    assert.ok(keys.includes("cabin_filter"));
    assert.ok(keys.includes("oil_change"));
    // A cost-only part is not a program, and a catalog row that reuses a curated
    // key does not produce a second entry.
    assert.equal(keys.includes("oil_filter"), false);
    assert.equal(keys.filter((key) => key === "oil_change").length, 1);
  });

  it("schedules the catalog program where its rule applies, and nowhere else", () => {
    const programs = maintenanceProgramsFromCatalog([CUSTOM_TYPE]);
    const withRule = row("cabin_filter", {
      schedules: [...RULES, customRule()],
      programs,
      records: [],
    });
    assert.equal(withRule.kmInterval, 20000);
    assert.equal(withRule.status, "needs_baseline");

    // The same program without a rule produces no row at all — an unruled catalog
    // program is not a gap, it is simply not scheduled here.
    const withoutRule = rows({ schedules: RULES, programs });
    assert.equal(withoutRule.some((entry) => entry.programKey === "cabin_filter"), false);
  });

  it("keeps the curated vehicle gating for the five approved programs", () => {
    const programs = maintenanceProgramsFromCatalog([CUSTOM_TYPE]);
    const bikeRule = customRule({
      id: "rule_cabin_bike",
      vehicle_type_key: "bike",
      km_interval: 0,
      day_interval: 90,
    });
    const bike: MaintenanceVehicle = { ...CAR, id: "bike-1", vehicleTypeKey: "bike" };
    const bikeRows = buildProgramRows({
      vehicles: [bike],
      doneRecords: [],
      schedules: [...RULES, bikeRule],
      settings: SETTINGS,
      programs,
      today: TODAY,
    });
    // A catalog program follows its rule onto a bike…
    assert.ok(bikeRows.some((entry) => entry.programKey === "cabin_filter"));
    // …while front tyres and the chain keep the client's own decisions.
    assert.equal(bikeRows.some((entry) => entry.programKey === "tire_front"), false);
    assert.ok(bikeRows.some((entry) => entry.programKey === "chain"));
  });
});

describe("a next-service point set by hand", () => {
  function override(patch: Partial<MaintenanceOverride> = {}): MaintenanceOverride {
    return {
      id: `${CAR.id}_oil_change`,
      vehicleId: CAR.id,
      programKey: "oil_change",
      nextDueKm: null,
      nextDueDate: null,
      previousKm: null,
      previousDate: null,
      reason: null,
      by: null,
      at: null,
      ...patch,
    };
  }

  it("wins over the interval for the dimension it sets", () => {
    const derived = row("oil_change");
    assert.equal(derived.nextDueKm, 84000); // 74,000 + 10,000
    assert.equal(derived.nextKmOverridden, false);

    const overridden = row("oil_change", { overrides: [override({ nextDueKm: 92000 })] });
    assert.equal(overridden.nextDueKm, 92000);
    assert.equal(overridden.nextKmOverridden, true);
    assert.equal(overridden.remainingKm, 74500 - 92000);
  });

  it("leaves the other dimension on the rule", () => {
    const overridden = row("oil_change", { overrides: [override({ nextDueDate: "2026-03-20" })] });
    // Toyota oil carries 10,000 km / 180 days, so the kilometre point is derived.
    assert.equal(overridden.nextDueKm, 84000);
    assert.equal(overridden.nextDueDate, "2026-03-20");
    assert.equal(overridden.nextDateOverridden, true);
    assert.equal(overridden.nextKmOverridden, false);
  });

  it("makes a dimension tracked when the rule left it at zero", () => {
    // Hyundai oil has no day interval; a hand-set date is a real instruction, so
    // the row has to judge it instead of printing "not tracked".
    const hyundai: MaintenanceVehicle = { ...CAR, make: "Hyundai", model: "H1" };
    const dateOnly = override({ nextDueDate: "2026-03-10" });
    const built = buildProgramRows({
      vehicles: [hyundai],
      doneRecords: [oilDone()],
      schedules: RULES,
      settings: SETTINGS,
      overrides: [dateOnly],
      today: TODAY,
    }).find((entry) => entry.programKey === "oil_change");
    assert.ok(built);
    assert.equal(built.nextDueDate, "2026-03-10");
    assert.notEqual(built.byTime, "not_tracked");
    assert.equal(built.remainingDays, 9);
  });

  it("reports overdue when the hand-set point has already passed", () => {
    const past = row("oil_change", { overrides: [override({ nextDueDate: "2026-02-25" })] });
    assert.equal(past.status, "overdue");
    assert.equal(past.remainingDays, -4);
  });
});
