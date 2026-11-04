import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_MAINTENANCE_SETTINGS,
  buildProgramRows,
  needsSetupRows,
  type MaintenanceDoneRecord,
  type MaintenanceVehicle,
} from "./service-maintenance-model";
import { approvedRulesAsSchedules } from "./service-programs";

/**
 * Partial baselines are legal, and they must stay partial.
 *
 * The client's sheet has 17 rows with no last-service date and 14 with no
 * last-service kilometres. A km-only baseline counts the kilometre dimension and
 * leaves the day dimension at `needs_baseline`; it must **not** invent a date, and
 * it must not pretend the program is Unknown either — those are three different
 * states and the operator acts differently on each.
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
  currentKm: 74721,
};

function oilRow(records: MaintenanceDoneRecord[]) {
  const row = buildProgramRows({
    vehicles: [CAR],
    doneRecords: records,
    schedules: RULES,
    settings: SETTINGS,
    today: TODAY,
  }).find((entry) => entry.programKey === "oil_change");
  assert.ok(row, "oil row missing");
  return row;
}

describe("partial baselines", () => {
  it("a kilometre-only baseline counts kilometres and leaves days waiting", () => {
    const row = oilRow([
      {
        id: "km-only",
        vehicleId: CAR.id,
        serviceTypeKey: "oil_change",
        doneDay: "2026-02-01",
        odometerKm: 70000,
      },
    ]);
    // The record always carries a day (a service has a date), so this is the
    // normal case: both dimensions are countable.
    assert.equal(row.lastServiceKm, 70000);
    assert.equal(row.lastServiceDate, "2026-02-01");
    assert.equal(row.nextDueKm, 80000);
    assert.equal(row.byTime === "needs_baseline", false);
  });

  it("a baseline with no kilometre reading leaves the km dimension waiting", () => {
    const row = oilRow([
      {
        id: "date-only",
        vehicleId: CAR.id,
        serviceTypeKey: "oil_change",
        doneDay: "2026-02-20",
        odometerKm: null,
      },
    ]);
    assert.equal(row.lastServiceKm, null);
    assert.equal(row.lastServiceDate, "2026-02-20");
    // No kilometres to count from — a baseline is owed, not "Unknown".
    assert.equal(row.byKm, "needs_baseline");
    assert.equal(row.nextDueKm, null);
    assert.equal(row.remainingKm, null);
    // The days still count, so that dimension is a real countdown…
    assert.equal(row.nextDueDate, "2026-08-19");
    assert.equal(row.byTime, "normal");
    // …but the row still says "needs setup", because the kilometre side owes a
    // reading and printing "Normal" would hide that.
    assert.equal(row.status, "needs_baseline");
    assert.equal(row.needsSetup, true);
    assert.equal(needsSetupRows([row]).length, 1);
  });

  it("no baseline at all is needs_baseline on both dimensions", () => {
    const row = oilRow([]);
    assert.equal(row.lastServiceKm, null);
    assert.equal(row.lastServiceDate, null);
    assert.equal(row.nextDueKm, null);
    assert.equal(row.nextDueDate, null);
    assert.equal(row.byKm, "needs_baseline");
    assert.equal(row.byTime, "needs_baseline");
    assert.equal(row.status, "needs_baseline");
    assert.equal(row.needsSetup, true);
  });

  it("an untracked dimension is never mistaken for a missing baseline", () => {
    const front = buildProgramRows({
      vehicles: [CAR],
      doneRecords: [],
      schedules: RULES,
      settings: SETTINGS,
      today: TODAY,
    }).find((entry) => entry.programKey === "tire_front");
    assert.ok(front);
    // Front tyres carry no day interval, so the day dimension is not_tracked —
    // the operator owes nothing there.
    assert.equal(front.byTime, "not_tracked");
    assert.equal(front.byKm, "needs_baseline");
    assert.equal(front.status, "needs_baseline");
    // Only the kilometre side is needed, and the worklist still lists it once.
    assert.equal(needsSetupRows([front]).length, 1);
  });

  it("the latest Done record wins when a program has several", () => {
    const row = oilRow([
      {
        id: "old",
        vehicleId: CAR.id,
        serviceTypeKey: "oil_change",
        doneDay: "2025-01-05",
        odometerKm: 10000,
      },
      {
        id: "new",
        vehicleId: CAR.id,
        serviceTypeKey: "oil_change",
        doneDay: "2026-02-20",
        odometerKm: 74000,
      },
    ]);
    assert.equal(row.lastServiceKm, 74000);
    assert.equal(row.lastServiceDate, "2026-02-20");
    assert.equal(row.nextDueKm, 84000);
  });

  it("a baseline on another vehicle is never borrowed", () => {
    const row = oilRow([
      {
        id: "other",
        vehicleId: "car-2",
        serviceTypeKey: "oil_change",
        doneDay: "2026-02-20",
        odometerKm: 74000,
      },
    ]);
    assert.equal(row.lastServiceKm, null);
    assert.equal(row.status, "needs_baseline");
  });
});
