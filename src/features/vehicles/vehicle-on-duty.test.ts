import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  vehicleAssignedOnDuty,
  vehicleIsUnderRepair,
  vehicleShiftLabel,
} from "./vehicle-on-duty";

const singleShift = {
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

const overnightShift = {
  shift_date: "2026-09-29",
  shift_type: "single" as const,
  session1_start: "22:00:00",
  session1_end: "06:00:00",
  session1_end_day_offset: 1,
  session2_start: null,
  session2_end: null,
  session2_start_day_offset: 0,
  session2_end_day_offset: 0,
};

describe("vehicleAssignedOnDuty", () => {
  it("needs an assigned rider and open attendance", () => {
    assert.equal(
      vehicleAssignedOnDuty({ assignedDriverId: null, hasOpenAttendance: true }),
      false,
    );
    assert.equal(
      vehicleAssignedOnDuty({ assignedDriverId: "d1", hasOpenAttendance: false }),
      false,
    );
    assert.equal(
      vehicleAssignedOnDuty({ assignedDriverId: "d1", hasOpenAttendance: true }),
      true,
    );
  });

  // QA #35: a clocked-in rider was reading Off Duty whenever `now` fell outside the
  // shift window — early clock-in, the gap in a split shift, or an overnight shift
  // still running from yesterday — while /attendance said On Duty. The open attendance
  // row is the whole answer now, so no shift can subtract from it.
  it("is on duty from the open attendance row even when no shift is published", () => {
    assert.equal(
      vehicleAssignedOnDuty({ assignedDriverId: "d1", hasOpenAttendance: true }),
      true,
    );
  });

  it("ignores a shift that has already ended", () => {
    // There is no `shift`/`nowMs` parameter left to narrow the decision, so a rider still
    // clocked in past the end of `singleShift` is On Duty — the case that read Off Duty
    // on the list while /attendance showed them working.
    assert.equal(vehicleAssignedOnDuty({ assignedDriverId: "d1", hasOpenAttendance: true }), true);
    assert.equal(vehicleShiftLabel(singleShift), "08:00–17:00");
  });
});

describe("vehicleShiftLabel", () => {
  it("labels a single shift without a day offset", () => {
    assert.equal(vehicleShiftLabel(singleShift), "08:00–17:00");
    assert.equal(vehicleShiftLabel(null), null);
    assert.equal(vehicleShiftLabel(undefined), null);
  });

  it("labels both sessions of a split shift", () => {
    assert.equal(
      vehicleShiftLabel({
        ...singleShift,
        shift_type: "split",
        session2_start: "19:00:00",
        session2_end: "22:00:00",
      }),
      "08:00–17:00, 19:00–22:00",
    );
  });

  it("marks an end that crosses midnight", () => {
    assert.equal(vehicleShiftLabel(overnightShift), "22:00–06:00 (+1d)");
  });

  it("ignores a second session on a non-split shift", () => {
    assert.equal(
      vehicleShiftLabel({
        ...singleShift,
        session2_start: "19:00:00",
        session2_end: "22:00:00",
      }),
      "08:00–17:00",
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
