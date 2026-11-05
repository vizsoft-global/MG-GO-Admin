import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatWorkingHoursList,
  resolveWorkingSeconds,
  sessionDaySummary,
  workingSeconds,
} from "./working-hours";

/** Kuwait day 2026-10-05, in UTC milliseconds (UTC+3). */
const DAY_START = Date.parse("2026-10-05T00:00:00+03:00");
const DAY_END = Date.parse("2026-10-05T23:59:59.999+03:00");
const NOW = Date.parse("2026-10-05T20:00:00+03:00");

describe("sessionDaySummary", () => {
  it("adds two sessions in one day instead of double counting them", () => {
    const summary = sessionDaySummary(
      [
        { start: "2026-10-05T09:00:00+03:00", end: "2026-10-05T13:00:00+03:00" },
        { start: "2026-10-05T14:00:00+03:00", end: "2026-10-05T18:00:00+03:00" },
      ],
      DAY_START,
      DAY_END,
      NOW,
    );
    assert.equal(summary.workedSeconds, 8 * 3600);
    assert.equal(new Date(summary.shiftInAt ?? 0).toISOString(), "2026-10-05T06:00:00.000Z");
    assert.equal(new Date(summary.shiftOutAt ?? 0).toISOString(), "2026-10-05T15:00:00.000Z");
  });

  it("counts an overlapping session once", () => {
    const summary = sessionDaySummary(
      [
        { start: "2026-10-05T09:00:00+03:00", end: "2026-10-05T13:00:00+03:00" },
        { start: "2026-10-05T12:00:00+03:00", end: "2026-10-05T15:00:00+03:00" },
      ],
      DAY_START,
      DAY_END,
      NOW,
    );
    assert.equal(summary.workedSeconds, 6 * 3600);
  });

  it("clips an overnight session to the day being reported", () => {
    const summary = sessionDaySummary(
      [{ start: "2026-10-04T22:00:00+03:00", end: "2026-10-05T02:00:00+03:00" }],
      DAY_START,
      DAY_END,
      NOW,
    );
    assert.equal(summary.workedSeconds, 2 * 3600);
    assert.equal(new Date(summary.shiftInAt ?? 0).toISOString(), "2026-10-04T21:00:00.000Z");
  });

  it("an open session counts to now and has no shift-out yet", () => {
    const summary = sessionDaySummary(
      [{ start: "2026-10-05T18:00:00+03:00", end: null }],
      DAY_START,
      DAY_END,
      NOW,
    );
    assert.equal(summary.workedSeconds, 2 * 3600);
    assert.equal(summary.shiftOutAt, null);
  });

  it("no session is zero hours, not null", () => {
    const summary = sessionDaySummary([], DAY_START, DAY_END, NOW);
    assert.deepEqual(summary, { shiftInAt: null, shiftOutAt: null, workedSeconds: 0 });
  });
});

describe("workingSeconds", () => {
  it("same-day duration", () => {
    const s = workingSeconds(
      "2026-07-29T06:00:00.000Z",
      "2026-07-29T14:00:00.000Z",
    );
    assert.equal(s, 8 * 3600);
  });

  it("midnight-spanning overnight shift", () => {
    const s = workingSeconds(
      "2026-07-28T19:00:00.000Z",
      "2026-07-29T03:00:00.000Z",
    );
    assert.equal(s, 8 * 3600);
  });

  it("returns null when check-out missing", () => {
    assert.equal(workingSeconds("2026-07-29T06:00:00.000Z", null), null);
  });

  it("returns null when checkout before checkin", () => {
    assert.equal(
      workingSeconds("2026-07-29T14:00:00.000Z", "2026-07-29T06:00:00.000Z"),
      null,
    );
  });
});

describe("resolveWorkingSeconds", () => {
  it("prefers dutySeconds when checkout present", () => {
    assert.equal(
      resolveWorkingSeconds({
        dutySeconds: 100,
        checkInAt: "2026-07-29T06:00:00.000Z",
        checkOutAt: "2026-07-29T14:00:00.000Z",
      }),
      100,
    );
  });

  it("open shift returns null", () => {
    assert.equal(
      resolveWorkingSeconds({
        dutySeconds: 999,
        checkInAt: "2026-07-29T06:00:00.000Z",
        checkOutAt: null,
      }),
      null,
    );
  });

  it("falls back to wall clock when dutySeconds missing", () => {
    assert.equal(
      resolveWorkingSeconds({
        dutySeconds: null,
        checkInAt: "2026-07-29T06:00:00.000Z",
        checkOutAt: "2026-07-29T07:00:00.000Z",
      }),
      3600,
    );
  });
});

describe("formatWorkingHoursList", () => {
  it("formats null as dash", () => {
    assert.equal(formatWorkingHoursList(null, (n) => `${n}s`), "—");
  });
});
