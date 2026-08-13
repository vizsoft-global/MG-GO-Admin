import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fleetStatusFromLocation, liveListStatus } from "./tracking-status";

const NOW = Date.parse("2026-08-13T12:00:00.000Z");
const fresh = new Date(NOW - 10_000).toISOString();

describe("liveListStatus", () => {
  it("shows Offline after logout even if last GPS was Moving", () => {
    assert.equal(
      liveListStatus({
        isOnDuty: false,
        trackingStatus: "moving",
        speedMps: 8,
        lastSeenAt: fresh,
        now: NOW,
      }),
      "offline",
    );
  });

  it("shows Moving when GPS is fresh and speed is above the walk threshold", () => {
    assert.equal(
      liveListStatus({
        isOnDuty: true,
        trackingStatus: "idle",
        speedMps: 5,
        lastSeenAt: fresh,
        now: NOW,
      }),
      "moving",
    );
  });
});

describe("fleetStatusFromLocation", () => {
  it("maps logged-out drivers to offline, not available/moving", () => {
    assert.equal(
      fleetStatusFromLocation({
        pinStatus: "active",
        trackingStatus: "moving",
        isOnDuty: false,
        speedMps: 8,
        lastSeenAt: fresh,
        now: NOW,
      }),
      "offline",
    );
  });

  it("maps a fresh high-speed idle stamp to available", () => {
    assert.equal(
      fleetStatusFromLocation({
        pinStatus: "idle",
        trackingStatus: "idle",
        isOnDuty: true,
        speedMps: 5,
        lastSeenAt: fresh,
        now: NOW,
      }),
      "available",
    );
  });
});
