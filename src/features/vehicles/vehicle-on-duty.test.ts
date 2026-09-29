import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { vehicleAssignedOnDuty, vehicleIsUnderRepair } from "./vehicle-on-duty";

const shift = {
  shift_date: "2026-09-29",
  shift_type: "single" as const,
  session1_start: "08:00:00",
  session1_end: "17:00:00",
  session1_end_day_offset: 0,
  session2_start: null,
  session2_end: null,
  session2_start_day_offset: 0,
  session2_end_day_offset: 0,
};

describe("vehicleAssignedOnDuty", () => {
  it("needs an assigned rider and open attendance", () => {
    assert.equal(
      vehicleAssignedOnDuty({ assignedDriverId: null, hasOpenAttendance: true, shift: null }),
      false,
    );
    assert.equal(
      vehicleAssignedOnDuty({ assignedDriverId: "d1", hasOpenAttendance: false, shift: null }),
      false,
    );
    assert.equal(
      vehicleAssignedOnDuty({ assignedDriverId: "d1", hasOpenAttendance: true, shift: null }),
      true,
    );
  });

  it("requires now to sit inside today's shift when one exists", () => {
    const inside = Date.parse("2026-09-29T10:00:00+03:00");
    const outside = Date.parse("2026-09-29T20:00:00+03:00");
    assert.equal(
      vehicleAssignedOnDuty({
        assignedDriverId: "d1",
        hasOpenAttendance: true,
        shift,
        nowMs: inside,
      }),
      true,
    );
    assert.equal(
      vehicleAssignedOnDuty({
        assignedDriverId: "d1",
        hasOpenAttendance: true,
        shift,
        nowMs: outside,
      }),
      false,
    );
  });
});

describe("vehicleIsUnderRepair", () => {
  it("is true for condition or fleet status", () => {
    assert.equal(vehicleIsUnderRepair({ status: "active", condition: "repair_required" }), true);
    assert.equal(vehicleIsUnderRepair({ status: "maintenance", condition: "running" }), true);
    assert.equal(vehicleIsUnderRepair({ status: "active", condition: "running" }), false);
  });
});
