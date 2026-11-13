import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  alarmIntervalMs,
  downsampleForDurability,
  DURABLE_SEND_MS,
  durableSendDue,
  durableSignature,
  FleetRoom,
  IDLE_ALARM_MS,
  INGEST_HOT_WINDOW_MS,
  isDriverAttachment,
  jwtExpiryMs,
  OPS_DRIVER_REFRESH_MAX,
  OPS_RELAY_MIN_MS,
  opsDriversToRefresh,
  opsRelayDue,
  type PendingPoint,
} from "./fleet-room";

describe("driver ingest socket helpers", () => {
  it("reads exp from a JWT payload as milliseconds", () => {
    const payload = Buffer.from(JSON.stringify({ exp: 1_800_000_000, sub: "u" }))
      .toString("base64url");
    assert.equal(jwtExpiryMs(`h.${payload}.s`), 1_800_000_000_000);
  });

  it("returns null for a malformed token", () => {
    assert.equal(jwtExpiryMs("nope"), null);
    assert.equal(jwtExpiryMs("a.!!!.c"), null);
  });

  it("tells driver attachments from admin socket views", () => {
    assert.equal(isDriverAttachment({ kind: "driver", driverId: "d1", expMs: null }), true);
    assert.equal(isDriverAttachment({ bbox: null, statuses: null }), false);
    assert.equal(isDriverAttachment(null), false);
  });
});

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

function fakeRoom() {
  const sql = { exec: () => ({ toArray: () => [] }) };
  const state = {
    storage: { sql },
    getWebSockets: () => [],
  } as unknown as DurableObjectState;
  const env = {
    GPS_SINK: "r2",
    GPS_SINK_PERCENT: "100",
    GPS_DUAL_WRITE: "0",
    GPS_ARCHIVE: {},
    FIREBASE_FUNCTIONS_BASE_URL: "https://functions.test",
    WORKER_SHARED_SECRET: "secret",
  } as never;
  return new FleetRoom(state, env);
}

function seedPending(room: FleetRoom, points: PendingPoint[]) {
  const entity = { driverId: "driver-a", inAssignedZone: true, pending: points };
  (room as unknown as { entities: Map<string, unknown> }).entities.set("driver-a", entity);
  return entity;
}

/** Captures the `p_events` body of the Functions call; returns a restore function. */
function captureFlushCalls(): { calls: Array<{ p_events: Array<Record<string, unknown>> }>; restore: () => void } {
  const calls: Array<{ p_events: Array<Record<string, unknown>> }> = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body ?? "{}")) as { p_events: Array<Record<string, unknown>> });
    return new Response(JSON.stringify({ ok: true, skipped: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = original) };
}

describe("flushPositions archive safety", () => {
  it("keeps the batch pending when archive.record throws, then archives it on retry", async () => {
    const room = fakeRoom();
    const entity = seedPending(room, batch(2));
    let attempts = 0;
    let archivedPoints = 0;
    (room as unknown as { archive: unknown }).archive = {
      record: (_driverId: string, points: unknown[]) => {
        attempts += 1;
        if (attempts === 1) throw new Error("sqlite_busy");
        archivedPoints = points.length;
        return { accepted: true };
      },
      persistBuffers: () => ({ capped: false }),
      distanceTodayM: () => 42,
    };
    const capture = captureFlushCalls();
    try {
      await (room as unknown as { flushPositions: () => Promise<void> }).flushPositions();

      assert.equal(attempts, 1);
      assert.equal(entity.pending.length, 2, "a failed record must not clear pending");
      assert.equal(capture.calls.length, 0, "a failed record must not reach Firestore");

      await (room as unknown as { flushPositions: () => Promise<void> }).flushPositions();

      assert.equal(attempts, 2);
      assert.equal(archivedPoints, 2);
      assert.equal(entity.pending.length, 0);
      assert.equal(capture.calls.length, 1);
      assert.equal(capture.calls[0]!.p_events.length, 2);
      assert.equal(capture.calls[0]!.p_events[0]!.history_in_r2, true);
      assert.equal(capture.calls[0]!.p_events[0]!.distance_today_m, 42);
    } finally {
      capture.restore();
    }
  });

  it("retries a capped buffer once, then falls back to Firestore instead of dropping", async () => {
    const room = fakeRoom();
    const entity = seedPending(room, batch(2));
    (room as unknown as { archive: unknown }).archive = {
      record: () => ({ accepted: false, reason: "buffer_capped" }),
      persistBuffers: () => ({ capped: false }),
      distanceTodayM: () => null,
    };
    const capture = captureFlushCalls();
    try {
      await (room as unknown as { flushPositions: () => Promise<void> }).flushPositions();
      assert.equal(entity.pending.length, 2, "first cap keeps the batch pending");
      assert.equal(capture.calls.length, 0);

      await (room as unknown as { flushPositions: () => Promise<void> }).flushPositions();
      assert.equal(entity.pending.length, 0);
      assert.equal(capture.calls.length, 1);
      assert.equal(capture.calls[0]!.p_events[0]!.history_in_r2, false);
    } finally {
      capture.restore();
    }
  });
});

describe("ops relay cost guards", () => {
  const base = { nowMs: 100_000, lastRelayAt: 0, inFlight: false, socketCount: 1 };

  it("does not relay with no admin socket open", () => {
    assert.equal(opsRelayDue({ ...base, socketCount: 0 }), false);
  });

  it("holds the relay to one call per interval, however often ingest pumps", () => {
    assert.equal(opsRelayDue({ ...base, lastRelayAt: 100_000 - OPS_RELAY_MIN_MS + 1 }), false);
    assert.equal(opsRelayDue({ ...base, lastRelayAt: 100_000 - OPS_RELAY_MIN_MS }), true);
  });

  it("never stacks a second call on one still in flight", () => {
    assert.equal(opsRelayDue({ ...base, inFlight: true }), false);
  });

  it("names only the riders whose duty or delivery state moved", () => {
    const ids = opsDriversToRefresh([
      { driver_id: "a", category: "duty", operation_key: "duty.clock_in" },
      { driver_id: "a", category: "delivery", operation_key: "delivery.pickup" },
      { driver_id: "b", category: "ops", operation_key: "delivery.complete" },
      { driver_id: "c", category: "location", operation_key: "location.report" },
    ]);
    assert.deepEqual(ids, ["a", "b"]);
  });

  it("reads nobody when no row changes a roster fact", () => {
    assert.deepEqual(
      opsDriversToRefresh([{ driver_id: "c", category: "telemetry", operation_key: "app.resume" }]),
      [],
    );
  });

  it("falls back to the roster reload for a burst or an unattributed event", () => {
    const burst = Array.from({ length: OPS_DRIVER_REFRESH_MAX + 1 }, (_, i) => ({
      driver_id: `d${i}`,
      category: "duty",
      operation_key: "duty.clock_out",
    }));
    assert.equal(opsDriversToRefresh(burst), null);
    assert.equal(
      opsDriversToRefresh([{ driver_id: null, category: "duty", operation_key: "duty.sweep" }]),
      null,
    );
  });
});

describe("durable send throttle", () => {
  const moving = {
    trackingStatus: "moving",
    activeDeliveryId: null,
    isMocked: false,
    deliveryId: null,
    replay: false,
  };
  const sig = durableSignature(moving);
  const base = { nowMs: 500_000, lastSentAt: 500_000 - 10_000, lastSignature: sig, historyInR2: true };

  it("always sends a rider whose history is not in R2", () => {
    assert.equal(durableSendDue({ ...base, historyInR2: false, batch: [moving] }), true);
  });

  it("sends a rider the function has never seen", () => {
    assert.equal(durableSendDue({ ...base, lastSentAt: 0, lastSignature: null, batch: [moving] }), true);
  });

  it("holds an unchanged rider until the interval passes", () => {
    assert.equal(durableSendDue({ ...base, batch: [moving, moving] }), false);
    assert.equal(
      durableSendDue({ ...base, lastSentAt: base.nowMs - DURABLE_SEND_MS, batch: [moving] }),
      true,
    );
  });

  it("sends at once when tracking status, open delivery or mock state changes", () => {
    assert.equal(durableSendDue({ ...base, batch: [{ ...moving, trackingStatus: "idle" }] }), true);
    assert.equal(durableSendDue({ ...base, batch: [{ ...moving, activeDeliveryId: "d1" }] }), true);
    assert.equal(durableSendDue({ ...base, batch: [{ ...moving, isMocked: true }] }), true);
  });

  it("sends a batch carrying a delivery-stamped or replayed point", () => {
    assert.equal(durableSendDue({ ...base, batch: [{ ...moving, deliveryId: "d9" }, moving] }), true);
    assert.equal(durableSendDue({ ...base, batch: [{ ...moving, replay: true }, moving] }), true);
  });

  it("has nothing to send for an empty batch already in the archive", () => {
    assert.equal(durableSendDue({ ...base, batch: [] }), false);
  });
});
