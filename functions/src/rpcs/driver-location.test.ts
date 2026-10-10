import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  deferCoarsePin,
  odometerSegmentMeters,
  resolveTrackingStatus,
  shouldCoalesceLocation,
  shouldWriteLocationHistory,
} from "./driver-location";

const ORIGIN = { lat: 29.375, lng: 47.978 };
const NEAR = { lat: 29.37505, lng: 47.978 }; // ~5.5 m
const FAR = { lat: 29.376, lng: 47.978 }; // ~111 m

describe("resolveTrackingStatus", () => {
  it("downgrades delivery_submit without an id using speed", () => {
    assert.equal(resolveTrackingStatus("delivery_submit", null, 0.2), "idle");
    assert.equal(resolveTrackingStatus("delivery_submit", null, 1.2), "moving");
    assert.equal(resolveTrackingStatus("delivery_submit", "d1", 0), "delivery_submit");
    assert.equal(resolveTrackingStatus("moving", null, 0), "moving");
  });
});

describe("shouldCoalesceLocation", () => {
  const now = new Date("2026-10-09T12:00:00.000Z");
  const prev = {
    lastSeenAt: new Date("2026-10-09T11:59:50.000Z"),
    lat: ORIGIN.lat,
    lng: ORIGIN.lng,
    trackingStatus: "idle",
  };

  it("coalesces same-status fixes inside 15s and 18m, never delivery_submit", () => {
    assert.equal(
      shouldCoalesceLocation({
        prev,
        now,
        lat: NEAR.lat,
        lng: NEAR.lng,
        status: "idle",
        minIntervalSeconds: 15,
      }),
      true,
    );
    assert.equal(
      shouldCoalesceLocation({
        prev,
        now,
        lat: NEAR.lat,
        lng: NEAR.lng,
        status: "delivery_submit",
        minIntervalSeconds: 15,
      }),
      false,
    );
    assert.equal(
      shouldCoalesceLocation({
        prev,
        now,
        lat: FAR.lat,
        lng: FAR.lng,
        status: "idle",
        minIntervalSeconds: 15,
      }),
      false,
    );
  });
});

describe("odometerSegmentMeters", () => {
  const now = new Date("2026-10-09T12:00:10.000Z");
  const prev = {
    lastSeenAt: new Date("2026-10-09T12:00:00.000Z"),
    lat: ORIGIN.lat,
    lng: ORIGIN.lng,
    accuracyMeters: 12,
    day: "2026-10-09",
  };

  it("credits a moving same-day hop and zeros coarse, parked, or teleport segments", () => {
    const hop = odometerSegmentMeters({
      prev,
      now,
      nowDay: "2026-10-09",
      lat: NEAR.lat,
      lng: NEAR.lng,
      accuracyMeters: 10,
      isMoving: true,
    });
    assert.ok(hop > 4 && hop < 12);

    assert.equal(
      odometerSegmentMeters({
        prev,
        now,
        nowDay: "2026-10-09",
        lat: NEAR.lat,
        lng: NEAR.lng,
        accuracyMeters: 10,
        isMoving: false,
      }),
      0,
    );
    assert.equal(
      odometerSegmentMeters({
        prev,
        now,
        nowDay: "2026-10-09",
        lat: NEAR.lat,
        lng: NEAR.lng,
        accuracyMeters: 80,
        isMoving: true,
      }),
      0,
    );
    assert.equal(
      odometerSegmentMeters({
        prev: { ...prev, lastSeenAt: new Date("2026-10-09T11:59:59.000Z") },
        now,
        nowDay: "2026-10-09",
        lat: 29.4,
        lng: 47.978,
        accuracyMeters: 10,
        isMoving: true,
      }),
      0,
    );
  });
});

describe("history and coarse defer", () => {
  const now = new Date("2026-10-09T12:05:00.000Z");

  it("writes history on force, submit, status change, 75m or 300s", () => {
    const lastEvent = {
      lat: ORIGIN.lat,
      lng: ORIGIN.lng,
      recordedAt: new Date("2026-10-09T12:04:50.000Z"),
      trackingStatus: "idle",
    };
    assert.equal(
      shouldWriteLocationHistory({
        force: false,
        status: "idle",
        lastEvent,
        lat: NEAR.lat,
        lng: NEAR.lng,
        now,
      }),
      false,
    );
    assert.equal(
      shouldWriteLocationHistory({
        force: true,
        status: "idle",
        lastEvent,
        lat: NEAR.lat,
        lng: NEAR.lng,
        now,
      }),
      true,
    );
    assert.equal(
      shouldWriteLocationHistory({
        force: false,
        status: "delivery_submit",
        lastEvent,
        lat: NEAR.lat,
        lng: NEAR.lng,
        now,
      }),
      true,
    );
    assert.equal(
      shouldWriteLocationHistory({
        force: false,
        status: "idle",
        lastEvent,
        lat: FAR.lat,
        lng: FAR.lng,
        now,
      }),
      true,
    );
  });

  it("defers a coarse pin only when a recent accurate fix exists", () => {
    assert.equal(
      deferCoarsePin({
        accuracyMeters: 80,
        lastAccurateAt: new Date("2026-10-09T12:04:00.000Z"),
        now,
      }),
      true,
    );
    assert.equal(
      deferCoarsePin({
        accuracyMeters: 80,
        lastAccurateAt: new Date("2026-10-09T12:00:00.000Z"),
        now,
      }),
      false,
    );
    assert.equal(deferCoarsePin({ accuracyMeters: 80, lastAccurateAt: null, now }), false);
    assert.equal(
      deferCoarsePin({
        accuracyMeters: 20,
        lastAccurateAt: new Date("2026-10-09T12:04:00.000Z"),
        now,
      }),
      false,
    );
  });
});
