import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decideAutoCheckout,
  nextOutOfZoneSince,
} from "./auto-checkout-rules";

const NOW = Date.parse("2026-07-29T12:00:00.000Z");

describe("decideAutoCheckout", () => {
  it("does not checkout under 45 minutes offline", () => {
    const decision = decideAutoCheckout({
      isOnDuty: true,
      hasOpenAttendanceLog: true,
      wentOfflineAt: new Date(NOW - 44 * 60_000).toISOString(),
      outOfZoneSince: null,
      thresholdMinutes: 45,
      nowMs: NOW,
    });
    assert.deepEqual(decision, { shouldCheckout: false });
  });

  it("checkouts after 45 minutes offline", () => {
    const decision = decideAutoCheckout({
      isOnDuty: true,
      hasOpenAttendanceLog: true,
      wentOfflineAt: new Date(NOW - 45 * 60_000).toISOString(),
      outOfZoneSince: null,
      thresholdMinutes: 45,
      nowMs: NOW,
    });
    assert.deepEqual(decision, {
      shouldCheckout: true,
      reason: "auto_offline",
    });
  });

  it("checkouts after 45 minutes out of zone", () => {
    const decision = decideAutoCheckout({
      isOnDuty: true,
      hasOpenAttendanceLog: true,
      wentOfflineAt: null,
      outOfZoneSince: new Date(NOW - 45 * 60_000).toISOString(),
      thresholdMinutes: 45,
      nowMs: NOW,
    });
    assert.deepEqual(decision, {
      shouldCheckout: true,
      reason: "auto_out_of_zone",
    });
  });

  it("prefers offline when both thresholds met", () => {
    const decision = decideAutoCheckout({
      isOnDuty: true,
      hasOpenAttendanceLog: true,
      wentOfflineAt: new Date(NOW - 50 * 60_000).toISOString(),
      outOfZoneSince: new Date(NOW - 50 * 60_000).toISOString(),
      thresholdMinutes: 45,
      nowMs: NOW,
    });
    assert.equal(decision.shouldCheckout, true);
    if (decision.shouldCheckout) {
      assert.equal(decision.reason, "auto_offline");
    }
  });

  it("resets when outOfZoneSince cleared after early return", () => {
    const decision = decideAutoCheckout({
      isOnDuty: true,
      hasOpenAttendanceLog: true,
      wentOfflineAt: null,
      outOfZoneSince: null,
      thresholdMinutes: 45,
      nowMs: NOW,
    });
    assert.deepEqual(decision, { shouldCheckout: false });
  });

  it("skips when not on duty", () => {
    const decision = decideAutoCheckout({
      isOnDuty: false,
      hasOpenAttendanceLog: true,
      wentOfflineAt: new Date(NOW - 60 * 60_000).toISOString(),
      outOfZoneSince: null,
      thresholdMinutes: 45,
      nowMs: NOW,
    });
    assert.deepEqual(decision, { shouldCheckout: false });
  });
});

describe("nextOutOfZoneSince", () => {
  it("starts timer on first out_of_zone", () => {
    assert.equal(
      nextOutOfZoneSince({
        previousZoneStatus: "in_zone",
        previousOutOfZoneSince: null,
        nextZoneStatus: "out_of_zone",
        nowIso: "2026-07-29T12:00:00.000Z",
      }),
      "2026-07-29T12:00:00.000Z",
    );
  });

  it("keeps previous timer while still out", () => {
    assert.equal(
      nextOutOfZoneSince({
        previousZoneStatus: "out_of_zone",
        previousOutOfZoneSince: "2026-07-29T11:00:00.000Z",
        nextZoneStatus: "out_of_zone",
        nowIso: "2026-07-29T12:00:00.000Z",
      }),
      "2026-07-29T11:00:00.000Z",
    );
  });

  it("clears on return in_zone", () => {
    assert.equal(
      nextOutOfZoneSince({
        previousZoneStatus: "out_of_zone",
        previousOutOfZoneSince: "2026-07-29T11:00:00.000Z",
        nextZoneStatus: "in_zone",
        nowIso: "2026-07-29T12:00:00.000Z",
      }),
      null,
    );
  });
});
