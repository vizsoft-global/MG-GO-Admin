import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_MAINTENANCE_SETTINGS,
  baselineFor,
  buildProgramRows,
  kmStatus,
  makeKey,
  makeModelKey,
  needsOdometerRows,
  needsSetupRows,
  noRuleRows,
  programCounts,
  resolveProgramRule,
  timeStatus,
  worstStatus,
  type MaintenanceDoneRecord,
  type MaintenanceVehicle,
} from "./service-maintenance-model";
import { isDoneRecord } from "./service-records-model";
import {
  PROGRAM_ALERT_DAYS,
  PROGRAM_ALERT_KM,
  approvedRulesAsSchedules,
} from "./service-programs";
import type { MaintenanceScheduleRow, MaintenanceSettings, ServiceStage } from "./types";

const TODAY = "2026-03-01";
const APPROVED = approvedRulesAsSchedules();

const SETTINGS: MaintenanceSettings = {
  ...DEFAULT_MAINTENANCE_SETTINGS,
  km_interval: 10000,
  day_interval: 180,
  alert_km: PROGRAM_ALERT_KM,
  alert_days: PROGRAM_ALERT_DAYS,
  provisional: true,
};

function vehicle(overrides: Partial<MaintenanceVehicle> = {}): MaintenanceVehicle {
  return {
    id: "v1",
    plate: "PLT-1",
    chassisNo: null,
    make: "Toyota",
    model: "Yaris",
    condition: "good",
    vehicleTypeKey: "car",
    zoneName: "Hawalli",
    driverName: "Rider One",
    currentKm: 80000,
    ...overrides,
  };
}

function done(overrides: Partial<MaintenanceDoneRecord> & { id: string }): MaintenanceDoneRecord {
  return {
    vehicleId: "v1",
    serviceTypeKey: "oil_change",
    doneDay: "2025-09-05",
    odometerKm: 70000,
    ...overrides,
  };
}

function rule(overrides: Partial<MaintenanceScheduleRow> = {}): MaintenanceScheduleRow {
  return {
    id: "r1",
    scope: "vehicle_type",
    vehicle_id: null,
    make_model_key: null,
    make_key: null,
    vehicle_type_key: "car",
    service_type_key: "oil_change",
    service_type_label: "Oil change",
    km_interval: 10000,
    day_interval: 180,
    alert_km: PROGRAM_ALERT_KM,
    alert_days: PROGRAM_ALERT_DAYS,
    is_active: true,
    created_at: null,
    updated_at: null,
    ...overrides,
  };
}


describe("maintenance status thresholds", () => {
  it("is Due Soon inside the alert margin", () => {
    assert.equal(kmStatus(80000 - 78500, 2000), "due_soon");
    assert.equal(kmStatus(80000 - 78500, 500), "normal");
  });

  it("is Due at exactly the threshold and Overdue past it", () => {
    assert.equal(kmStatus(0, 500), "due");
    assert.equal(kmStatus(-1, 500), "overdue");
    assert.equal(kmStatus(500, 500), "due_soon");
  });

  it("applies the same rule to days", () => {
    assert.equal(timeStatus(5, 5), "due_soon");
    assert.equal(timeStatus(0, 5), "due");
    assert.equal(timeStatus(-3, 5), "overdue");
    assert.equal(timeStatus(60, 5), "normal");
  });

  it("takes the worse of the two dimensions", () => {
    assert.equal(worstStatus(["normal", "overdue"]), "overdue");
    assert.equal(worstStatus(["due_soon", "due"]), "due");
    assert.equal(worstStatus(["normal", "normal"]), "normal");
    assert.equal(worstStatus([]), "unknown");
  });

  it("never lets a missing baseline outrank a real countdown", () => {
    assert.equal(worstStatus(["due_soon", "needs_baseline"]), "due_soon");
    assert.equal(worstStatus(["normal", "needs_baseline"]), "needs_baseline");
    assert.equal(worstStatus(["not_tracked", "unknown"]), "not_tracked");
    assert.equal(worstStatus(["not_tracked", "normal"]), "normal");
  });

  it("counts a Done record as the only baseline source", () => {
    const stages: ServiceStage[] = ["new", "running", "cancelled"];
    for (const stage of stages) assert.equal(isDoneRecord({ stage }), false, stage);
    assert.equal(isDoneRecord({ stage: "done" }), true);
    assert.equal(isDoneRecord({}), true);
    assert.equal(baselineFor([done({ id: "d1" })], "v1", "oil_change")?.id, "d1");
    assert.equal(baselineFor([done({ id: "d1" })], "v1", "brake"), null);
  });

describe("rule resolution", () => {
  it("keys a make on its own so every Toyota model shares one oil rule", () => {
    assert.equal(makeKey("Toyota"), "toyota");
    assert.equal(makeKey("  Toyota "), "toyota");
    assert.equal(makeModelKey("Toyota", "Yaris"), "toyota_yaris");
    assert.equal(makeModelKey("Hyundai", "Half Lorry"), "hyundai_half_lorry");
  });

  it("resolves vehicle before make/model before make before type", () => {
    const rules = [
      rule({ id: "type", km_interval: 10000 }),
      rule({ id: "make", scope: "make", make_key: "toyota", km_interval: 12000 }),
      rule({ id: "model", scope: "make_model", make_model_key: "toyota_yaris", km_interval: 15000 }),
      rule({ id: "own", scope: "vehicle", vehicle_id: "v1", km_interval: 9000 }),
    ];
    assert.equal(resolveProgramRule(vehicle(), "oil_change", rules)?.kmInterval, 9000);
    assert.equal(
      resolveProgramRule(vehicle({ id: "v2", plate: "B" }), "oil_change", rules)
        ?.kmInterval,
      15000,
    );
    assert.equal(
      resolveProgramRule(vehicle({ id: "v3", plate: "C", model: "Coaster" }), "oil_change", rules)
        ?.kmInterval,
      12000,
    );
  });

  it("matches the approved interval for each make the client named", () => {
    const toyota = resolveProgramRule(vehicle(), "oil_change", APPROVED);
    assert.equal(toyota?.kmInterval, 10000);
    assert.equal(toyota?.dayInterval, 180);
    const hyundai = resolveProgramRule(
      vehicle({ make: "Hyundai", model: "Half Lorry" }),
      "oil_change",
      APPROVED,
    );
    assert.equal(hyundai?.kmInterval, 5000);
    assert.equal(hyundai?.dayInterval, 0);
    const bike = resolveProgramRule(
      vehicle({ vehicleTypeKey: "bike", make: null, model: null }),
      "oil_change",
      APPROVED,
    );
    assert.equal(bike?.kmInterval, 1500);
    assert.equal(bike?.dayInterval, 10);
  });

  it("does not schedule a tyre program on a bike", () => {
    const bike = vehicle({ vehicleTypeKey: "bike" });
    assert.equal(resolveProgramRule(bike, "tire_front", APPROVED), null);
    assert.equal(resolveProgramRule(bike, "chain", APPROVED)?.dayInterval, 45);
  });

  it("returns no rule for a make the client never named, never a default", () => {
    // Changan, ISUZU, Ford and Honda are in the client's sheet and have no
    // approved oil interval. Falling back to 10,000 / 180 would be a guess.
    for (const make of ["Changan", "Ford", "Honda"]) {
      assert.equal(
        resolveProgramRule(vehicle({ make, model: "Alsvin" }), "oil_change", APPROVED),
        null,
        make,
      );
    }
    // The same vehicle is still covered where a type-wide rule exists.
    assert.equal(
      resolveProgramRule(vehicle({ make: "Changan", model: "Alsvin" }), "brake", APPROVED)
        ?.kmInterval,
      30000,
    );
  });

  it("marks a rule the fleet team wrote as approved", () => {
    const resolved = resolveProgramRule(vehicle(), "oil_change", [rule()]);
    assert.equal(resolved?.provisional, false);
    assert.equal(resolved?.scope, "vehicle_type");
  });
});


describe("program rows", () => {
  it("builds one row per program for one vehicle", () => {
    const rows = buildProgramRows({
      vehicles: [vehicle()],
      doneRecords: [done({ id: "d1" })],
      schedules: APPROVED,
      settings: SETTINGS,
      today: TODAY,
    });
    // A car is scheduled on oil, front tyres, rear tyres and brakes — four rows.
    assert.deepEqual(rows.map((row) => row.programKey).sort(), [
      "brake",
      "oil_change",
      "tire_front",
      "tire_rear",
    ]);
    assert.equal(new Set(rows.map((row) => row.vehicleId)).size, 1);
  });

  it("prints an untracked dimension as not_tracked, never as Unknown", () => {
    const rows = buildProgramRows({
      vehicles: [vehicle()],
      doneRecords: [done({ id: "d1", serviceTypeKey: "tire_front" })],
      schedules: APPROVED,
      settings: SETTINGS,
      today: TODAY,
    });
    const front = rows.find((row) => row.programKey === "tire_front");
    assert.equal(front?.dayInterval, 0);
    assert.equal(front?.byTime, "not_tracked");
    assert.equal(front?.nextDueDate, null);
  });

  it("needs_baseline when a rule applies but nothing was ever recorded", () => {
    const rows = buildProgramRows({
      vehicles: [vehicle({ currentKm: null })],
      doneRecords: [],
      schedules: APPROVED,
      settings: SETTINGS,
      today: TODAY,
    });
    const oil = rows.find((row) => row.programKey === "oil_change");
    assert.equal(oil?.status, "needs_baseline");
    assert.equal(oil?.needsSetup, true);
    assert.equal(needsSetupRows(rows).length, rows.length);
  });

  it("asks for an odometer when the kilometres decide but none is stored", () => {
    const rows = buildProgramRows({
      vehicles: [vehicle({ currentKm: null })],
      doneRecords: [done({ id: "d1", odometerKm: 70000, doneDay: "2025-12-01" })],
      schedules: APPROVED,
      settings: SETTINGS,
      today: TODAY,
    });
    const oil = rows.find((row) => row.programKey === "oil_change");
    assert.equal(oil?.nextDueKm, 80000);
    assert.equal(oil?.needsOdometer, true);
    assert.equal(
      needsOdometerRows(rows, TODAY).some((row) => row.programKey === "oil_change"),
      true,
    );
  });

  it("honours an exclusion as not_tracked with no figures", () => {
    const bikeRows = buildProgramRows({
      vehicles: [vehicle({ vehicleTypeKey: "bike", make: null, model: null })],
      doneRecords: [],
      schedules: APPROVED,
      settings: SETTINGS,
      exclusions: [
        { id: "x", vehicleId: "v1", programKey: "chain", reason: "leased", by: "u1", at: null },
      ],
      today: TODAY,
    });
    const chain = bikeRows.find((row) => row.programKey === "chain");
    assert.equal(chain?.status, "not_tracked");
    assert.equal(chain?.kmInterval, 0);
    assert.equal(chain?.dayInterval, 0);
    assert.equal(chain?.needsSetup, false);
    // A bike has no tyre programs at all.
    assert.equal(bikeRows.some((row) => row.programKey === "tire_front"), false);
  });

  it("counts the KPI strip and knows how many vehicles are behind it", () => {
    const rows = buildProgramRows({
      vehicles: [
        vehicle({ id: "over", plate: "A", currentKm: 95000 }),
        vehicle({ id: "ok", plate: "B", currentKm: 71000 }),
      ],
      doneRecords: [done({ id: "d1", vehicleId: "over" }), done({ id: "d2", vehicleId: "ok" })],
      schedules: APPROVED,
      settings: SETTINGS,
      today: TODAY,
    });
    const counts = programCounts(rows);
    assert.equal(counts.total, rows.length);
    assert.equal(counts.vehicles, 2);
    assert.equal(counts.overdue >= 1, true);
    assert.equal(counts.provisional, false);
  });

  it("lists a vehicle whose reading is older than a week", () => {
    const stale = buildProgramRows({
      vehicles: [
        vehicle({ id: "old", plate: "OLD", currentKm: 80000, odometerUpdatedAt: "2026-02-01T00:00:00.000Z" }),
        vehicle({ id: "fresh", plate: "NEW", currentKm: 80000, odometerUpdatedAt: "2026-02-27T00:00:00.000Z" }),
      ],
      doneRecords: [done({ id: "d1", vehicleId: "old" }), done({ id: "d2", vehicleId: "fresh" })],
      schedules: APPROVED,
      settings: SETTINGS,
      today: TODAY,
    });
    const listed = needsOdometerRows(stale, TODAY);
    assert.equal(listed.every((row) => row.vehicleId === "old"), true);
    assert.equal(listed.length > 0, true);
    // A reading inside the window is not chased.
    assert.equal(listed.some((row) => row.vehicleId === "fresh"), false);
  });

  it("shows no_rule for a vehicle the approved rules do not cover", () => {
    const rows = buildProgramRows({
      vehicles: [vehicle({ id: "ch", plate: "CH-1", make: "Changan", model: "Alsvin" })],
      doneRecords: [],
      schedules: APPROVED,
      today: TODAY,
    });
    const oil = rows.find((row) => row.programKey === "oil_change");
    assert.ok(oil);
    // Not Unknown, not Normal: an explicit state with an operator action.
    assert.equal(oil.status, "no_rule");
    assert.equal(oil.ruleScope, "none");
    assert.equal(oil.kmInterval, 0);
    assert.equal(oil.dayInterval, 0);
    assert.equal(oil.nextDueKm, null);
    // The type-wide programs still resolve, so only the uncovered program is
    // flagged rather than the whole vehicle.
    assert.equal(rows.find((row) => row.programKey === "brake")?.status !== "no_rule", true);
    assert.equal(noRuleRows(rows).length, 1);
    assert.equal(programCounts(rows).no_rule, 1);
  });

  it("restricts the build to one vehicle type for the bike page", () => {
    const rows = buildProgramRows({
      vehicles: [vehicle(), vehicle({ id: "b1", plate: "BK-1", vehicleTypeKey: "bike" })],
      doneRecords: [],
      schedules: APPROVED,
      settings: SETTINGS,
      vehicleTypeKeys: ["bike"],
      today: TODAY,
    });
    assert.equal(rows.length > 0, true);
    assert.equal(new Set(rows.map((row) => row.vehicleId)).size, 1);
    assert.equal(rows[0]?.vehicleId, "b1");
  });
});

});
