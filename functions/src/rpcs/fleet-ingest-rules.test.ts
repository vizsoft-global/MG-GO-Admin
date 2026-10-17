import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  clampHistoryRecordedAt,
  parseFleetEventBatch,
  parseIngestBatch,
  parseRiderDayStats,
  pinWriteAllowed,
  R2_PIN_HEARTBEAT_MS,
  r2PinWriteDue,
  shouldCoalesceIngestPin,
  sortIngestPoints,
  type IngestPoint,
} from "./fleet-ingest-rules";

const NOW = new Date("2026-10-10T00:00:00.000Z");

function point(overrides: Partial<IngestPoint> = {}): IngestPoint {
  return {
    driverId: "driver-a",
    lat: 29.37,
    lng: 47.98,
    speedMps: 0,
    accuracyM: 8,
    headingDeg: null,
    batteryPct: 80,
    altitudeM: null,
    networkType: null,
    chargingState: null,
    isMocked: false,
    locationProvider: null,
    activeDeliveryId: null,
    deliveryId: null,
    trackingStatus: "idle",
    clientTs: NOW,
    replay: false,
    ord: 0,
    ...overrides,
  };
}

describe("parseIngestBatch", () => {
  it("rejects a non-array", () => {
    assert.deepEqual(parseIngestBatch({}, NOW), { ok: false, error: "events_array_required" });
  });

  it("rejects a batch over 5000", () => {
    const raw = Array.from({ length: 5001 }, () => ({ driver_id: "d", lat: 1, lng: 1 }));
    const parsed = parseIngestBatch(raw, NOW);
    assert.equal(parsed.ok, false);
    if (!parsed.ok) {
      assert.equal(parsed.error, "batch_too_large");
      assert.equal(parsed.received, 5001);
    }
  });

  it("keeps a worker-shaped point and drops invalid rows", () => {
    const parsed = parseIngestBatch(
      [
        {
          driver_id: "driver-a",
          lat: 29.37,
          lng: 47.98,
          accuracy_m: 12,
          tracking_status: "moving",
          client_ts: "2026-10-09T23:59:00.000Z",
        },
        { driver_id: "driver-a", lat: 91, lng: 47.98 },
        { driver_id: "driver-a", lat: 29, lng: 47, tracking_status: "flying" },
        {
          driver_id: "driver-a",
          lat: 29,
          lng: 47,
          client_ts: "2026-01-01T00:00:00.000Z",
        },
        { lat: 29, lng: 47 },
      ],
      NOW,
    );
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.received, 5);
      assert.equal(parsed.points.length, 1);
      assert.equal(parsed.points[0]?.trackingStatus, "moving");
      assert.equal(parsed.points[0]?.accuracyM, 12);
      assert.equal(parsed.points[0]?.clientTs.toISOString(), "2026-10-09T23:59:00.000Z");
    }
  });

  it("defaults a missing client timestamp to now", () => {
    const parsed = parseIngestBatch([{ driver_id: "driver-a", lat: 1, lng: 2 }], NOW);
    assert.equal(parsed.ok, true);
    if (parsed.ok) assert.equal(parsed.points[0]?.clientTs.getTime(), NOW.getTime());
  });
});

describe("clampHistoryRecordedAt", () => {
  it("caps the future and floors anything older than 15 minutes", () => {
    const future = clampHistoryRecordedAt(new Date(NOW.getTime() + 60_000), NOW);
    const old = clampHistoryRecordedAt(new Date(NOW.getTime() - 60 * 60_000), NOW);
    const recent = clampHistoryRecordedAt(new Date(NOW.getTime() - 60_000), NOW);
    assert.equal(future.toISOString(), NOW.toISOString());
    assert.equal(old.toISOString(), new Date(NOW.getTime() - 15 * 60_000).toISOString());
    assert.equal(recent.toISOString(), new Date(NOW.getTime() - 60_000).toISOString());
  });
});

describe("pinWriteAllowed", () => {
  it("allows the first write and refuses a second inside one second", () => {
    assert.equal(pinWriteAllowed(null, NOW.getTime()), true);
    assert.equal(pinWriteAllowed(NOW.getTime() - 999, NOW.getTime()), false);
    assert.equal(pinWriteAllowed(NOW.getTime() - 1000, NOW.getTime()), true);
  });
});

describe("sortIngestPoints", () => {
  it("finishes a driver's live points before that driver's replay", () => {
    const sorted = sortIngestPoints([
      point({ driverId: "b", ord: 0 }),
      point({ driverId: "a", replay: true, ord: 2, clientTs: new Date(NOW.getTime() - 1000) }),
      point({ driverId: "a", ord: 1, clientTs: new Date(NOW.getTime() - 500) }),
    ]);
    assert.deepEqual(
      sorted.map((row) => `${row.driverId}:${row.replay}`),
      ["a:false", "a:true", "b:false"],
    );
  });
});

describe("shouldCoalesceIngestPin", () => {
  const prev = {
    lastSeenAt: new Date(NOW.getTime() - 1000),
    lat: 29.37,
    lng: 47.98,
    trackingStatus: "idle",
  };

  it("coalesces a still pin inside 15s and 18m when the zone did not change", () => {
    assert.equal(
      shouldCoalesceIngestPin({
        prev,
        now: NOW,
        lat: 29.37001,
        lng: 47.98,
        status: "idle",
        minIntervalSeconds: 15,
        prevZoneStatus: "in_zone",
        zoneStatus: "in_zone",
      }),
      true,
    );
  });

  it("does not coalesce a zone crossing", () => {
    assert.equal(
      shouldCoalesceIngestPin({
        prev,
        now: NOW,
        lat: 29.37001,
        lng: 47.98,
        status: "idle",
        minIntervalSeconds: 15,
        prevZoneStatus: "out_of_zone",
        zoneStatus: "in_zone",
      }),
      false,
    );
  });
});

describe("parseFleetEventBatch", () => {
  it("rejects a non-array and a batch over 2000", () => {
    assert.deepEqual(parseFleetEventBatch(null, NOW), { ok: false, error: "events_array_required" });
    const huge = parseFleetEventBatch(
      Array.from({ length: 2001 }, () => ({ driver_id: "d", event_key: "overspeed" })),
      NOW,
    );
    assert.equal(huge.ok, false);
    if (!huge.ok) assert.equal(huge.error, "batch_too_large");
  });

  it("keeps a class-b event and drops a row with no key", () => {
    const parsed = parseFleetEventBatch(
      [
        {
          driver_id: "driver-a",
          event_key: "overspeed",
          severity: "nope",
          context: ["not-an-object"],
          detected_at: "2026-10-10T00:05:00.000Z",
        },
        { driver_id: "driver-a" },
      ],
      NOW,
    );
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.received, 2);
      assert.equal(parsed.events.length, 1);
      assert.equal(parsed.events[0]?.severity, "info");
      assert.deepEqual(parsed.events[0]?.context, {});
      assert.equal(parsed.events[0]?.detectedAt.toISOString(), NOW.toISOString());
    }
  });
});

describe("history_in_r2 batch fields", () => {
  it("parses the archive flag and DO odometer", () => {
    const parsed = parseIngestBatch(
      [
        { driver_id: "d1", lat: 29.3, lng: 47.9, history_in_r2: true, distance_today_m: 1234 },
        { driver_id: "d2", lat: 29.3, lng: 47.9 },
      ],
      NOW,
    );
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.points[0]?.historyInR2, true);
    assert.equal(parsed.points[0]?.distanceTodayM, 1234);
    assert.equal(parsed.points[1]?.historyInR2, false);
    assert.equal(parsed.points[1]?.distanceTodayM, null);
  });
});

describe("r2PinWriteDue", () => {
  const prev = {
    updatedAtMs: NOW.getTime(),
    zoneStatus: "in_zone",
    trackingStatus: "moving",
    activeDeliveryId: null,
    isMocked: false,
  };
  const base = {
    prev,
    nowMs: NOW.getTime() + 60_000,
    zoneStatus: "in_zone",
    trackingStatus: "moving",
    activeDeliveryId: null,
    isMocked: false,
  };

  it("writes the first pin", () => {
    assert.equal(r2PinWriteDue({ ...base, prev: null }), true);
  });
  it("skips an unchanged pin inside the heartbeat", () => {
    assert.equal(r2PinWriteDue(base), false);
  });
  it("writes after the heartbeat", () => {
    assert.equal(r2PinWriteDue({ ...base, nowMs: NOW.getTime() + R2_PIN_HEARTBEAT_MS }), true);
  });
  it("writes on any state change", () => {
    assert.equal(r2PinWriteDue({ ...base, zoneStatus: "out_of_zone" }), true);
    assert.equal(r2PinWriteDue({ ...base, trackingStatus: "idle" }), true);
    assert.equal(r2PinWriteDue({ ...base, activeDeliveryId: "x" }), true);
    assert.equal(r2PinWriteDue({ ...base, isMocked: true }), true);
  });
});

describe("parseRiderDayStats", () => {
  it("keeps valid rows and rounds counters", () => {
    const rows = parseRiderDayStats([
      { driver_id: "d1", day: "2026-10-10", moving_s: 12.6, distance_m: 99.4, points: 3 },
      { driver_id: "a/b", day: "2026-10-10" },
      { driver_id: "d2", day: "10-10-2026" },
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.movingS, 13);
    assert.equal(rows[0]?.distanceM, 99);
    assert.equal(rows[0]?.idleS, 0);
  });
  it("ignores a missing body", () => {
    assert.deepEqual(parseRiderDayStats(undefined), []);
  });
});
