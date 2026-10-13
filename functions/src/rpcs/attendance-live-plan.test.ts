import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ATTENDANCE_KEYSET_PAGE,
  ATTENDANCE_MATERIALIZE_CAP,
  ATTENDANCE_PROJECTION,
  attendanceNeedsLocation,
  attendanceNeedsSessions,
  attendanceQueryCanPage,
  dutyIsOn,
  minutesLateOf,
} from "./attendance-live-plan";

describe("attendance live plan", () => {
  it("asks for a location only after leave, shift, absence and lateness are decided", () => {
    const open = { storedStatus: null, hasScheduledStart: true, hasCheckIn: true, minutesLate: 0 };
    assert.equal(attendanceNeedsLocation(open), true);
    assert.equal(attendanceNeedsLocation({ ...open, storedStatus: "on_leave" }), false);
    assert.equal(attendanceNeedsLocation({ ...open, hasScheduledStart: false }), false);
    assert.equal(attendanceNeedsLocation({ ...open, hasCheckIn: false }), false);
    assert.equal(attendanceNeedsLocation({ ...open, minutesLate: 4 }), false);
  });

  it("pages a date sort with no live filter and keeps problems_first on the full window", () => {
    const open = { sort: "date_desc", status: null, search: "", liveOnly: false };
    assert.equal(attendanceQueryCanPage(open), true);
    assert.equal(attendanceQueryCanPage({ ...open, sort: "date_asc" }), true);
    assert.equal(attendanceQueryCanPage({ ...open, sort: "problems_first" }), false);
    assert.equal(attendanceQueryCanPage({ ...open, status: "problems" }), false);
    assert.equal(attendanceQueryCanPage({ ...open, status: "late" }), false);
    assert.equal(attendanceQueryCanPage({ ...open, status: "scheduled" }), false);
    assert.equal(attendanceQueryCanPage({ ...open, status: "checked_in" }), false);
    assert.equal(ATTENDANCE_MATERIALIZE_CAP > 5000, true);
    assert.equal(ATTENDANCE_KEYSET_PAGE < ATTENDANCE_MATERIALIZE_CAP, true);
    assert.equal(attendanceQueryCanPage({ ...open, search: "ali" }), false);
    assert.equal(attendanceQueryCanPage({ ...open, liveOnly: true }), false);
    assert.equal(attendanceNeedsSessions(false), false);
    assert.equal(attendanceNeedsSessions(true), true);
  });

  it("shares the late and on-duty rules the row composer uses", () => {
    const start = new Date("2026-10-13T05:00:00.000Z");
    const checkIn = new Date("2026-10-13T05:20:00.000Z");
    assert.equal(minutesLateOf(checkIn, start, 10), 10);
    assert.equal(minutesLateOf(checkIn, start, 30), 0);
    assert.equal(dutyIsOn(true, checkIn, null, "2026-10-13", "2026-10-13"), true);
    assert.equal(dutyIsOn(true, checkIn, new Date(), "2026-10-13", "2026-10-13"), false);
    assert.equal(ATTENDANCE_PROJECTION.includes("check_in_at"), true);
    assert.equal(ATTENDANCE_PROJECTION.includes("is_on_duty"), true);
  });
});
