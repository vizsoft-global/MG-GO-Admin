import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  attendanceDateKey,
  mergeTodayOnlineSeconds,
  pickAttendanceDayRow,
} from "./attendance-day";

describe("attendanceDateKey", () => {
  it("keeps a stored YYYY-MM-DD string", () => {
    assert.equal(attendanceDateKey("2026-10-15"), "2026-10-15");
  });

  it("maps a Timestamp-like value onto the Kuwait calendar day", () => {
    const at = {
      toDate: () => new Date("2026-10-15T21:30:00.000Z"),
    };
    assert.equal(attendanceDateKey(at), "2026-10-16");
  });

  it("maps an ISO instant onto the Kuwait calendar day", () => {
    assert.equal(attendanceDateKey("2026-10-15T21:30:00.000Z"), "2026-10-16");
  });
});

describe("pickAttendanceDayRow", () => {
  it("returns the matching row with the largest stored online_seconds", () => {
    const picked = pickAttendanceDayRow(
      [
        { id: "zero", data: { attendance_date: "2026-10-15", online_seconds: 0 } },
        { id: "kept", data: { attendance_date: "2026-10-15", online_seconds: 7200 } },
        { id: "other", data: { attendance_date: "2026-10-14", online_seconds: 9999 } },
      ],
      "2026-10-15",
    );
    assert.equal(picked?.id, "kept");
  });

  it("matches a Timestamp-dated row for the same Kuwait day", () => {
    const picked = pickAttendanceDayRow(
      [
        {
          id: "stamp",
          data: {
            attendance_date: { toDate: () => new Date("2026-10-15T08:00:00.000+03:00") },
            online_seconds: 3600,
          },
        },
      ],
      "2026-10-15",
    );
    assert.equal(picked?.id, "stamp");
  });

  it("returns null when no row is on that day", () => {
    assert.equal(
      pickAttendanceDayRow(
        [{ id: "other", data: { attendance_date: "2026-10-14", online_seconds: 10 } }],
        "2026-10-15",
      ),
      null,
    );
  });
});

describe("mergeTodayOnlineSeconds", () => {
  it("keeps the larger of stored attendance and closed sessions", () => {
    assert.equal(mergeTodayOnlineSeconds(7200, 0), 7200);
    assert.equal(mergeTodayOnlineSeconds(0, 5400), 5400);
    assert.equal(mergeTodayOnlineSeconds(3600, 4000), 4000);
    assert.equal(mergeTodayOnlineSeconds(-1, Number.NaN), 0);
  });
});
