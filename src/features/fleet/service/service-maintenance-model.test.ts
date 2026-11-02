import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_MAINTENANCE_SETTINGS,
  addDays,
  baselineFor,
  buildMaintenanceRows,
  daysBetween,
  kmStatus,
  maintenanceCounts,
  makeModelKey,
  resolveSchedule,
  timeStatus,
  worstStatus,
  type MaintenanceDoneRecord,
  type MaintenanceVehicle,
} from "./service-maintenance-model";
import { isDoneRecord } from "./service-records-model";
import type { MaintenanceScheduleRow, MaintenanceSettings, ServiceStage } from "./types";

const TODAY = "2026-03-01";

const SETTINGS: MaintenanceSettings = {
  ...DEFAULT_MAINTENANCE_SETTINGS,
  km_interval: 10000,
  day_interval: 180,
  alert_km: 500,
  alert_days: 14,
  provisional: true,
};

function vehicle(overrides: Partial<MaintenanceVehicle> = {}): MaintenanceVehicle {
  return {
    id: "v1",
    plate: "PLT-1",
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
    serviceTypeKey: "full_service",
    doneDay: "2025-09-05",
    odometerKm: 70000,
    ...overrides,
  };
}

function schedule(overrides: Partial<MaintenanceScheduleRow> = {}): MaintenanceScheduleRow {
  return {
    id: "s1",
    scope: "vehicle",
    vehicle_id: "v1",
    make_model_key: null,
    service_type_key: "full_service",
    service_type_label: "Full service",
    km_interval: 10000,
    day_interval: 180,
    alert_km: 500,
    alert_days: 14,
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
    assert.equal(timeStatus(14, 14), "due_soon");
    assert.equal(timeStatus(0, 14), "due");
    assert.equal(timeStatus(-3, 14), "overdue");
    assert.equal(timeStatus(60, 14), "normal");
  });

  it("takes the worse of the two dimensions", () => {
    assert.equal(worstStatus(["normal", "overdue"]), "overdue");
    assert.equal(worstStatus(["due_soon", "due"]), "due");
    assert.equal(worstStatus(["normal", "normal"]), "normal");
    assert.equal(worstStatus(["unknown", "unknown"]), "unknown");
    assert.equal(worstStatus([]), "unknown");
  });

  it("is unknown with no history, never a fabricated zero", () => {
    const rows = buildMaintenanceRows({
      vehicles: [vehicle({ currentKm: null })],
      doneRecords: [],
      schedules: [],
      settings: SETTINGS,
      today: TODAY,
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.currentKm, null);
    assert.equal(rows[0]?.nextDueKm, null);
    assert.equal(rows[0]?.remainingKm, null);
    assert.equal(rows[0]?.lastServiceKm, null);
    assert.equal(rows[0]?.status, "unknown");
    assert.equal(rows[0]?.byKm, "unknown");
    assert.equal(rows[0]?.byTime, "unknown");
  });
});


describe("maintenance baselines", () => {
  it("computes the next due figures from the latest Done record", () => {
    const rows = buildMaintenanceRows({
      vehicles: [vehicle()],
      doneRecords: [done({ id: "d1" })],
      schedules: [schedule()],
      settings: { ...SETTINGS, provisional: false },
      today: TODAY,
    });
    const row = rows[0];
    assert.ok(row);
    assert.equal(row?.lastServiceKm, 70000);
    assert.equal(row?.lastServiceDate, "2025-09-05");
    assert.equal(row?.nextDueKm, 80000);
    assert.equal(row?.remainingKm, 0);
    assert.equal(row?.byKm, "due");
    assert.equal(row?.nextDueDate, addDays("2025-09-05", 180));
    assert.equal(row?.daysSinceService, daysBetween("2025-09-05", TODAY));
    assert.equal(row?.scheduleScope, "vehicle");
    assert.equal(row?.provisional, false);
  });

  it("only a Done record moves the baseline — New, Running and Cancelled never do", () => {
    const stages: ServiceStage[] = ["new", "running", "cancelled"];
    for (const stage of stages) {
      assert.equal(isDoneRecord({ stage }), false, stage);
    }
    assert.equal(isDoneRecord({ stage: "done" }), true);
    // A legacy row with no stage at all is a finished visit.
    assert.equal(isDoneRecord({}), true);

    const baseline = baselineFor([done({ id: "d1" })], "v1", "full_service");
    assert.equal(baseline?.id, "d1");
    // The caller filters on stage, so an open row never reaches the model.
    const openRows = [
      {
        id: "x",
        vehicleId: "v1",
        serviceTypeKey: "full_service",
        doneDay: "2026-02-01",
        odometerKm: 79999,
        stage: "running" as ServiceStage,
      },
    ];
    const visible = openRows.filter((row) => isDoneRecord(row));
    assert.equal(visible.length, 0);
    assert.equal(baselineFor(visible, "v1", "full_service"), null);
  });

  it("resolves vehicle scope before model scope before the defaults", () => {
    const settings = { ...SETTINGS, km_interval: 12000 };
    assert.equal(resolveSchedule(vehicle(), [], settings).scope, "default");
    assert.equal(resolveSchedule(vehicle(), [], settings).kmInterval, 12000);
    const modelRow = schedule({
      id: "s2",
      scope: "model",
      vehicle_id: null,
      make_model_key: makeModelKey("Toyota", "Yaris"),
      km_interval: 15000,
    });
    assert.equal(resolveSchedule(vehicle(), [modelRow], settings).scope, "model");
    assert.equal(resolveSchedule(vehicle(), [modelRow], settings).kmInterval, 15000);
    const own = schedule({ km_interval: 9000 });
    const resolved = resolveSchedule(vehicle(), [modelRow, own], settings);
    assert.equal(resolved.scope, "vehicle");
    assert.equal(resolved.kmInterval, 9000);
  });

  it("marks every row provisional while the intervals are unapproved", () => {
    const rows = buildMaintenanceRows({
      vehicles: [vehicle(), vehicle({ id: "v2", plate: "PLT-2" })],
      doneRecords: [done({ id: "d1" })],
      schedules: [],
      settings: { ...SETTINGS, provisional: true },
      today: TODAY,
    });
    assert.equal(rows.length, 2);
    for (const row of rows) assert.equal(row.provisional, true);
  });

  it("counts the statuses the KPI strip prints", () => {
    const rows = buildMaintenanceRows({
      vehicles: [
        vehicle({ id: "over", plate: "A", currentKm: 95000 }),
        vehicle({ id: "ok", plate: "B", currentKm: 71000 }),
        vehicle({ id: "none", plate: "C", currentKm: null }),
      ],
      doneRecords: [done({ id: "d1", vehicleId: "over" }), done({ id: "d2", vehicleId: "ok" })],
      schedules: [schedule({ vehicle_id: "over" }), schedule({ id: "s2", vehicle_id: "ok" })],
      settings: { ...SETTINGS, provisional: false },
      today: TODAY,
    });
    const counts = maintenanceCounts(rows);
    assert.equal(counts.overdue, 1);
    assert.equal(counts.unknown, 1);
    assert.equal(counts.normal + counts.due + counts.due_soon, 1);
  });
});
