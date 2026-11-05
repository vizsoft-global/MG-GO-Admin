import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildProgramRows, type MaintenanceDoneRecord, type MaintenanceVehicle } from "./service-maintenance-model";
import { approvedRulesAsSchedules } from "./service-programs";
import { DEFAULT_MAINTENANCE_SETTINGS } from "./service-maintenance-model";

/**
 * The client's four independence examples, verbatim.
 *
 * The old model resolved **one** schedule per vehicle, so a service recorded as
 * "full service" moved oil, tyres and brakes at once. These four cases are the
 * contract that says it cannot happen again.
 */

const TODAY = "2026-03-01";
const RULES = approvedRulesAsSchedules();
const SETTINGS = { ...DEFAULT_MAINTENANCE_SETTINGS, provisional: false };

const CAR: MaintenanceVehicle = {
  id: "car-1",
  plate: "23/21208",
  chassisNo: "MR0AB8CD800123456",
  make: "Toyota",
  model: "Yaris",
  condition: "running",
  vehicleTypeKey: "car",
  zoneName: "Hawalli",
  driverName: "Rider One",
  currentKm: 74500,
};

function doneOil(): MaintenanceDoneRecord {
  return {
    id: "svc-oil",
    vehicleId: CAR.id,
    serviceTypeKey: "oil_change",
    doneDay: "2026-02-20",
    odometerKm: 74000,
  };
}

function doneFront(): MaintenanceDoneRecord {
  return {
    id: "svc-front",
    vehicleId: CAR.id,
    serviceTypeKey: "tire_front",
    doneDay: "2026-02-25",
    odometerKm: 74400,
  };
}

function doneRear(): MaintenanceDoneRecord {
  return {
    id: "svc-rear",
    vehicleId: CAR.id,
    serviceTypeKey: "tire_rear",
    doneDay: "2026-02-26",
    odometerKm: 74450,
  };
}

function doneBrake(): MaintenanceDoneRecord {
  return {
    id: "svc-brake",
    vehicleId: CAR.id,
    serviceTypeKey: "brake",
    doneDay: "2026-02-27",
    odometerKm: 74480,
  };
}

function rowsFor(records: MaintenanceDoneRecord[]) {
  return buildProgramRows({
    vehicles: [CAR],
    doneRecords: records,
    schedules: RULES,
    settings: SETTINGS,
    today: TODAY,
  });
}

function pick(records: MaintenanceDoneRecord[], programKey: string) {
  const row = rowsFor(records).find((entry) => entry.programKey === programKey);
  assert.ok(row, `${programKey} row missing`);
  return row;
}

describe("programs are independent of each other", () => {
  it("an oil change does not move the tyres", () => {
    const before = { front: pick([], "tire_front"), rear: pick([], "tire_rear") };
    const after = { front: pick([doneOil()], "tire_front"), rear: pick([doneOil()], "tire_rear") };
    assert.equal(after.front.lastServiceKm, before.front.lastServiceKm);
    assert.equal(after.front.nextDueKm, before.front.nextDueKm);
    assert.equal(after.front.status, before.front.status);
    assert.equal(after.rear.lastServiceKm, before.rear.lastServiceKm);
    assert.equal(after.rear.nextDueKm, before.rear.nextDueKm);
    // And the oil baseline did move oil, so the fixture is not inert.
    assert.equal(pick([doneOil()], "oil_change").lastServiceKm, 74000);
  });

  it("front tyres do not move rear tyres or brakes", () => {
    const front = pick([doneFront()], "tire_front");
    const rear = pick([doneFront()], "tire_rear");
    const brake = pick([doneFront()], "brake");
    assert.equal(front.lastServiceKm, 74400);
    assert.equal(rear.lastServiceKm, null);
    assert.equal(brake.lastServiceKm, null);
  });

  it("rear tyres do not move front tyres", () => {
    const front = pick([doneFront(), doneRear()], "tire_front");
    const rear = pick([doneFront(), doneRear()], "tire_rear");
    assert.equal(front.lastServiceKm, 74400);
    assert.equal(rear.lastServiceKm, 74450);
    assert.notEqual(front.nextDueKm, rear.nextDueKm);
  });

  it("brakes do not move oil or tyres", () => {
    const brake = pick([doneBrake()], "brake");
    const oil = pick([doneBrake()], "oil_change");
    const front = pick([doneBrake()], "tire_front");
    assert.equal(brake.lastServiceKm, 74480);
    assert.equal(oil.lastServiceKm, null);
    assert.equal(front.lastServiceKm, null);
  });

  it("keeps all four baselines at once and gives each its own due point", () => {
    const rows = rowsFor([doneOil(), doneFront(), doneRear(), doneBrake()]);
    const byProgram = new Map(rows.map((row) => [row.programKey, row]));
    assert.equal(byProgram.get("oil_change")?.nextDueKm, 84000); // 74,000 + 10,000
    assert.equal(byProgram.get("tire_front")?.nextDueKm, 124400); // 74,400 + 50,000
    assert.equal(byProgram.get("tire_rear")?.nextDueKm, 134450); // 74,450 + 60,000
    assert.equal(byProgram.get("brake")?.nextDueKm, 104480); // 74,480 + 30,000
    assert.equal(new Set(rows.map((row) => row.nextDueKm)).size, 4);
  });

  it("a record filed under a part code moves nothing", () => {
    const partRecord: MaintenanceDoneRecord = {
      id: "svc-part",
      vehicleId: CAR.id,
      serviceTypeKey: "oil_filter",
      doneDay: "2026-02-28",
      odometerKm: 74490,
    };
    for (const row of rowsFor([partRecord])) {
      assert.equal(row.lastServiceKm, null, row.programKey);
    }
  });
});
