import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatWorkingHoursList,
  resolveWorkingSeconds,
  workingSeconds,
} from "./working-hours";

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
