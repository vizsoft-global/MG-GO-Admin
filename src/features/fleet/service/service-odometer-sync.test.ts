import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normaliseChassis,
  normalisePlate,
  planOdometerReadings,
  rowsOf,
  type FleetOdometerVehicle,
} from "../../../../functions/src/core/odometer-sync-plan";

/**
 * The dashcam odometer adapter's two invariants.
 *
 * The vendor's published spec cannot be read from here, so the endpoint shape is
 * configuration. What must **not** be configurable is behaviour: a reading below
 * the stored figure is never written (a rewind hides every overdue service), and
 * a row is matched on chassis before plate and never guessed by model.
 */

const CONFIG = { odometer_field: "odometer", plate_field: "plateNo", chassis_field: "vin" };

/**
 * A fresh fleet per call.
 *
 * `planOdometerReadings` deliberately advances `currentKm` as it plans, so two
 * rows for one vehicle cannot both pass the guard. That means the fixture must be
 * rebuilt per test, or one test's writes become the next test's starting point.
 */
function fleet(): FleetOdometerVehicle[] {
  return [
    { id: "v-yaris", plate: "23/21208", chassisNo: "MR0AB8CD800123456", currentKm: 74500 },
    { id: "v-archive", plate: "00/00001", chassisNo: "ARCHIVED1", currentKm: 10, archived: true },
    { id: "v-nokm", plate: "22/21543", chassisNo: "KMHXX00XXXX000001", currentKm: null },
  ];
}

describe("odometer matching", () => {
  it("normalises a plate and a chassis the same way the fleet rows did", () => {
    assert.equal(normalisePlate(" 23 / 21208 "), "23/21208");
    assert.equal(normaliseChassis("mr0ab8cd-800123456"), "MR0AB8CD800123456");
  });

  it("prefers the chassis over the plate", () => {
    const plan = planOdometerReadings(
      // The plate belongs to the Yaris, but the chassis belongs to the archive
      // car — the chassis is the stronger identity and an archived vehicle is
      // not a candidate, so the plate decides here.
      [{ plateNo: "23/21208", vin: "ARCHIVED1", odometer: 75000 }],
      fleet(),
      CONFIG,
    );
    assert.equal(plan.writes[0]?.vehicleId, "v-yaris");

    const chassisWins = planOdometerReadings(
      [{ plateNo: "99/99999", vin: "MR0AB8CD800123456", odometer: 75000 }],
      fleet(),
      CONFIG,
    );
    assert.equal(chassisWins.writes[0]?.vehicleId, "v-yaris");
  });

  it("never rewinds a reading", () => {
    const plan = planOdometerReadings(
      [{ plateNo: "23/21208", vin: "MR0AB8CD800123456", odometer: 74000 }],
      fleet(),
      CONFIG,
    );
    assert.equal(plan.writes.length, 0);
    assert.equal(plan.skipped, 1);
  });

  it("writes an equal reading nowhere as well", () => {
    const plan = planOdometerReadings(
      [{ plateNo: "23/21208", vin: "MR0AB8CD800123456", odometer: 74500 }],
      fleet(),
      CONFIG,
    );
    assert.equal(plan.writes.length, 0);
    assert.equal(plan.skipped, 1);
  });

  it("accepts the first reading for a vehicle with no stored figure", () => {
    const plan = planOdometerReadings(
      [{ plateNo: "22/21543", vin: "KMHXX00XXXX000001", odometer: 445000 }],
      fleet(),
      CONFIG,
    );
    assert.deepEqual(plan.writes, [{ vehicleId: "v-nokm", km: 445000 }]);
  });

  it("keeps the highest reading when one payload repeats a vehicle", () => {
    const plan = planOdometerReadings(
      [
        { plateNo: "23/21208", vin: "MR0AB8CD800123456", odometer: 75000 },
        { plateNo: "23/21208", vin: "MR0AB8CD800123456", odometer: 74900 },
        { plateNo: "23/21208", vin: "MR0AB8CD800123456", odometer: 76000 },
      ],
      fleet(),
      CONFIG,
    );
    assert.deepEqual(plan.writes, [
      { vehicleId: "v-yaris", km: 75000 },
      { vehicleId: "v-yaris", km: 76000 },
    ]);
    // The lower repeat is refused, not written last.
    assert.equal(plan.skipped, 1);
  });

  it("counts an unmatched row and never guesses a vehicle", () => {
    const plan = planOdometerReadings(
      [{ plateNo: "77/77777", vin: "UNKNOWNCHASSIS", odometer: 1000 }],
      fleet(),
      CONFIG,
    );
    assert.equal(plan.writes.length, 0);
    assert.equal(plan.unmatched, 1);
  });

  it("skips a row with no reading at all", () => {
    const plan = planOdometerReadings(
      [{ plateNo: "23/21208", vin: "MR0AB8CD800123456", odometer: "" }],
      fleet(),
      CONFIG,
    );
    assert.equal(plan.writes.length, 0);
    assert.equal(plan.skipped, 1);
  });

  it("ignores an archived vehicle completely", () => {
    const plan = planOdometerReadings(
      [{ plateNo: "00/00001", vin: "ARCHIVED1", odometer: 99 }],
      fleet(),
      CONFIG,
    );
    assert.equal(plan.writes.length, 0);
    assert.equal(plan.unmatched, 1);
  });
});

describe("response shapes", () => {
  it("finds the rows inside whichever envelope the vendor uses", () => {
    const row = { plateNo: "23/21208", odometer: 1 };
    assert.equal(rowsOf([row]).length, 1);
    assert.equal(rowsOf({ data: [row] }).length, 1);
    assert.equal(rowsOf({ data: { list: [row] } }).length, 1);
    assert.equal(rowsOf({ result: [row] }).length, 1);
    // A bare object is one row, not zero.
    assert.equal(rowsOf(row).length, 1);
    assert.equal(rowsOf(null).length, 0);
  });

  it("reads a figure written with thousands separators", () => {
    const plan = planOdometerReadings(
      [{ plateNo: "22/21543", vin: "KMHXX00XXXX000001", odometer: "445,120" }],
      fleet(),
      CONFIG,
    );
    assert.deepEqual(plan.writes, [{ vehicleId: "v-nokm", km: 445120 }]);
  });
});
