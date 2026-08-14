import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  fleetStatusFromLocation,
  LEGEND_FILTERABLE_STATUSES,
  LEGEND_STATUSES,
  liveListStatus,
  liveListStatusTone,
} from "./tracking-status";

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

  it("shows Offline when GPS is stale even if the driver is still on duty", () => {
    const stale = new Date(NOW - 9 * 60_000).toISOString();
    assert.equal(
      liveListStatus({
        isOnDuty: true,
        trackingStatus: "idle",
        speedMps: 0,
        lastSeenAt: stale,
        now: NOW,
      }),
      "offline",
    );
    assert.equal(
      liveListStatus({
        isOnDuty: true,
        trackingStatus: "moving",
        speedMps: 8,
        lastSeenAt: stale,
        now: NOW,
      }),
      "offline",
    );
  });

  it("shows Blocked instead of Idle/Moving when the driver is blocked", () => {
    assert.equal(
      liveListStatus({
        isOnDuty: true,
        isBlocked: true,
        trackingStatus: "moving",
        speedMps: 8,
        lastSeenAt: fresh,
        now: NOW,
      }),
      "blocked",
    );
  });

  it("shows Delivered after finish when there is no active pickup", () => {
    assert.equal(
      liveListStatus({
        isOnDuty: true,
        trackingStatus: "delivery_submit",
        speedMps: 0,
        lastSeenAt: fresh,
        now: NOW,
        activeDeliveryId: null,
      }),
      "delivered",
    );
  });

  it("keeps On Delivery while an active pickup is still open", () => {
    assert.equal(
      liveListStatus({
        isOnDuty: true,
        trackingStatus: "delivery_submit",
        speedMps: 0,
        lastSeenAt: fresh,
        now: NOW,
        activeDeliveryId: "del-1",
      }),
      "delivery_submit",
    );
  });
});

describe("liveListStatusTone", () => {
  it("paints Moving and Idle red when the driver is out of zone", () => {
    assert.equal(liveListStatusTone("moving", "out_of_zone"), "danger");
    assert.equal(liveListStatusTone("idle", "out_of_zone"), "danger");
  });

  it("keeps in-zone Idle yellow and Moving green", () => {
    assert.equal(liveListStatusTone("idle", "in_zone"), "warning");
    assert.equal(liveListStatusTone("moving", "in_zone"), "success");
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

  it("does not keep Delivering after the active pickup is cleared", () => {
    assert.equal(
      fleetStatusFromLocation({
        pinStatus: "idle",
        trackingStatus: "delivery_submit",
        isOnDuty: true,
        speedMps: 0,
        lastSeenAt: fresh,
        now: NOW,
        activeDeliveryId: null,
      }),
      "idle",
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

  it("maps stale GPS and blocked drivers to offline, not idle/available", () => {
    const stale = new Date(NOW - 9 * 60_000).toISOString();
    assert.equal(
      fleetStatusFromLocation({
        pinStatus: "idle",
        trackingStatus: "idle",
        isOnDuty: true,
        speedMps: 0,
        lastSeenAt: stale,
        now: NOW,
      }),
      "offline",
    );
    assert.equal(
      fleetStatusFromLocation({
        pinStatus: "active",
        trackingStatus: "moving",
        isOnDuty: true,
        isBlocked: true,
        speedMps: 8,
        lastSeenAt: fresh,
        now: NOW,
      }),
      "offline",
    );
  });
});

describe("LEGEND_STATUSES", () => {
  it("does not list Cluster as a status chip — the count row already does", () => {
    assert.equal(LEGEND_STATUSES.includes("cluster"), false);
    assert.equal(LEGEND_FILTERABLE_STATUSES.includes("cluster"), false);
  });

  it("does not list Break — the app has no Break duty state", () => {
    assert.equal(LEGEND_STATUSES.includes("break"), false);
  });
});
