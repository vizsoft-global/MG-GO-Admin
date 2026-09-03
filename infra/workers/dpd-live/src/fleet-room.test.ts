import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  alarmIntervalMs,
  downsampleForDurability,
  IDLE_ALARM_MS,
  INGEST_HOT_WINDOW_MS,
  type PendingPoint,
} from "./fleet-room";

const T0 = Date.parse("2026-08-14T10:00:00.000Z");
const LAT = 29.37;
const LNG = 47.98;

function point(overrides: Partial<PendingPoint> = {}): PendingPoint {
  return {
    lat: LAT,
    lng: LNG,
    speedMps: 8,
    accuracyM: 6,
    headingDeg: 90,
    headingSource: "gps",
    batteryPct: 80,
    altitudeM: null,
    networkType: "wifi",
    chargingState: null,
    isMocked: false,
    locationProvider: "fused",
    activeDeliveryId: null,
    deliveryId: null,
    trackingStatus: "moving",
    clientTs: new Date(T0).toISOString(),
    replay: false,
    ...overrides,
  };
}

/** A steady 1Hz batch, roughly 2m apart — the shape a stopped-in-traffic rider sends. */
function batch(count: number, stepDeg = 0.00002): PendingPoint[] {
  return Array.from({ length: count }, (_, i) =>
    point({
      lat: LAT + i * stepDeg,
      clientTs: new Date(T0 + i * 1_000).toISOString(),
    }),
  );
}

describe("downsampleForDurability", () => {
  it("passes a batch too short to thin", () => {
    const points = batch(2);
    assert.equal(downsampleForDurability(points).length, 2);
  });

  it("thins a 1Hz batch of near-identical fixes", () => {
    // Ten seconds at 1Hz, barely moving: without thinning this is 10 rows per driver
    // per flush, which is ~43M rows/day across the fleet.
    const kept = downsampleForDurability(batch(10));
    assert.ok(kept.length <= 4, `expected a thinned batch, kept ${kept.length}`);
  });

  it("always keeps the first and last fix", () => {
    const points = batch(10);
    const kept = downsampleForDurability(points);
    assert.equal(kept[0], points[0]);
    assert.equal(kept[kept.length - 1], points[points.length - 1]);
  });

  it("does not write more rows just because the rider is fast", () => {
    // The row rate has to be a function of time, not speed. A rider at 35km/h and
    // one crawling in traffic both cost the same history, because nothing reads
    // `driver_locations` at sub-5s resolution — the day route simplifies it away.
    const slow = downsampleForDurability(batch(10, 0.00002)).length;
    const fast = downsampleForDurability(batch(10, 0.0005)).length;
    assert.equal(fast, slow, `fast kept ${fast}, slow kept ${slow}`);
  });

  it("caps a 10s batch at the pre-1Hz write rate", () => {
    // One flush is ~10s of movement. Two to three rows keeps `driver_locations`
    // within ~1.5x of the old 5s cadence instead of the ~5x that 1Hz raw would be.
    const kept = downsampleForDurability(batch(10, 0.0005));
    assert.ok(kept.length <= 3, `kept ${kept.length}`);
  });

  it("keeps a tracking-status change, which is what other readers act on", () => {
    const points = batch(8);
    points[3] = point({
      lat: points[3]!.lat,
      clientTs: points[3]!.clientTs,
      trackingStatus: "delivery_submit",
    });

    const kept = downsampleForDurability(points);
    assert.ok(kept.includes(points[3]!), "a status transition must survive thinning");
  });

  it("keeps a delivery stamp, because the audit trail reads this table", () => {
    const points = batch(8);
    points[5] = point({
      lat: points[5]!.lat,
      clientTs: points[5]!.clientTs,
      deliveryId: "11111111-1111-1111-1111-111111111111",
    });

    assert.ok(downsampleForDurability(points).includes(points[5]!));
  });

  it("keeps a mocked fix, which is evidence rather than noise", () => {
    const points = batch(8);
    points[2] = point({
      lat: points[2]!.lat,
      clientTs: points[2]!.clientTs,
      isMocked: true,
    });

    assert.ok(downsampleForDurability(points).includes(points[2]!));
  });

  it("keeps replayed fixes, which are the offline history", () => {
    const points = batch(8);
    points[4] = point({
      lat: points[4]!.lat,
      clientTs: points[4]!.clientTs,
      replay: true,
    });

    assert.ok(downsampleForDurability(points).includes(points[4]!));
  });

  it("keeps a fix that is both old enough and has moved", () => {
    const points = [
      point({ clientTs: new Date(T0).toISOString() }),
      point({ lat: LAT + 0.0005, clientTs: new Date(T0 + 6_000).toISOString() }),
      point({ lat: LAT + 0.001, clientTs: new Date(T0 + 6_500).toISOString() }),
      point({ lat: LAT + 0.0015, clientTs: new Date(T0 + 7_000).toISOString() }),
    ];
    const kept = downsampleForDurability(points);
    assert.ok(kept.includes(points[1]!), "past the time gate the fix earns its row");
    assert.ok(!kept.includes(points[2]!), "inside the gate it does not");
  });

  it("drops a stationary fix even after the time gate passes", () => {
    // A phone parked at a restaurant for ten minutes is one coordinate, not 120.
    // The batch's last point still lands, so the live row stays fresh.
    const points = Array.from({ length: 12 }, (_, i) =>
      point({ clientTs: new Date(T0 + i * 1_000).toISOString() }),
    );
    assert.equal(downsampleForDurability(points).length, 2);
  });

  it("preserves order", () => {
    const points = batch(12, 0.0004);
    const kept = downsampleForDurability(points);
    for (let i = 1; i < kept.length; i += 1) {
      assert.ok(Date.parse(kept[i]!.clientTs) >= Date.parse(kept[i - 1]!.clientTs));
    }
  });
});

describe("alarmIntervalMs", () => {
  const tickMs = 2_000;
  const nowMs = T0;

  it("keeps the live tick while an admin is watching", () => {
    assert.equal(
      alarmIntervalMs({
        tickMs,
        socketCount: 1,
        lastIngestAt: 0,
        nowMs,
      }),
      tickMs,
    );
  });

  it("keeps the live tick while ingest is still hot", () => {
    assert.equal(
      alarmIntervalMs({
        tickMs,
        socketCount: 0,
        lastIngestAt: nowMs - 60_000,
        nowMs,
      }),
      tickMs,
    );
  });

  it("backs off once the room is quiet", () => {
    assert.equal(
      alarmIntervalMs({
        tickMs,
        socketCount: 0,
        lastIngestAt: nowMs - INGEST_HOT_WINDOW_MS - 1,
        nowMs,
      }),
      IDLE_ALARM_MS,
    );
  });
});
