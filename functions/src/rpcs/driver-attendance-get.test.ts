import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  adherenceFromShift,
  completedAttendanceStatus,
  liveOnlineBonus,
  monthBounds,
} from "./driver-attendance-get";

describe("driverGetAttendance helpers", () => {
  it("builds inclusive Kuwait month bounds", () => {
    assert.deepEqual(monthBounds(2026, 10), { start: "2026-10-01", end: "2026-10-31" });
    assert.deepEqual(monthBounds(2026, 2), { start: "2026-02-01", end: "2026-02-28" });
  });

  it("counts a logged-on unvalidated day as completed", () => {
    assert.equal(completedAttendanceStatus("present"), true);
    assert.equal(completedAttendanceStatus("online_unvalidated"), true);
    assert.equal(completedAttendanceStatus("absent"), false);
    assert.equal(completedAttendanceStatus(null), false);
  });

  it("adds live seconds only for today's open session", () => {
    const last = new Date("2026-10-09T12:00:00.000Z");
    const now = last.getTime() + 90_000;
    assert.equal(
      liveOnlineBonus({
        day: "2026-10-09",
        today: "2026-10-09",
        lastOnlineAt: last,
        sessionOnline: true,
        nowMs: now,
      }),
      90,
    );
    assert.equal(
      liveOnlineBonus({
        day: "2026-10-08",
        today: "2026-10-09",
        lastOnlineAt: last,
        sessionOnline: true,
        nowMs: now,
      }),
      0,
    );
    assert.equal(
      liveOnlineBonus({
        day: "2026-10-09",
        today: "2026-10-09",
        lastOnlineAt: last,
        sessionOnline: false,
        nowMs: now,
      }),
      0,
    );
  });

  it("clamps early-out to the scheduled window", () => {
    const row = adherenceFromShift({
      day: "2026-10-09",
      shift: {
        shift_type: "single",
        session1_start: "11:30",
        session1_end: "16:30",
        session1_end_day_offset: 0,
      },
      actualIn: new Date("2026-10-09T08:30:00.000Z"),
      actualOut: new Date("2026-10-09T06:35:00.000Z"),
      onlineSeconds: 0,
      graceMinutes: 0,
    });
    assert.ok(row);
    assert.equal(row["scheduled_seconds"], 5 * 3600);
    assert.equal(row["minutes_early_out"], 300);
  });
});
