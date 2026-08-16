/**
 * Room-level regression tests for the four live-state defects fixed on 2026-08-16.
 *
 * These drive the real `FleetRoom` in-process with Supabase replaced at the `fetch`
 * boundary — the same technique `scripts/fleet-sim.mjs --target room` uses, for the same
 * reason: every one of these bugs lives in how the room reconciles a snapshot read with
 * an ingest, and nothing below that seam can show it. Asserting on the room's `entities`
 * map is a deliberate reach past the public surface; the alternative is a WebSocket and a
 * wire decoder between the assertion and the thing under test.
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { FleetRoom } from "./fleet-room";
import type { FleetStatus } from "../../../../src/features/live-tracking-v2/fleet-status";

const DRIVER = "11111111-1111-4111-8111-111111111111";
const SUPABASE_URL = "https://room-test.invalid";
const LAT = 29.37;
const LNG = 47.98;

type SnapshotRow = Record<string, unknown>;

/** The slice of the room's private `Entity` these tests assert on. */
type ObservedEntity = {
  status: FleetStatus;
  activeDeliveryId: string | null;
  dutyStateVersion: number | null;
  posVersion: number;
  lat: number | null;
  lng: number | null;
};

type Harness = {
  room: FleetRoom;
  /** Mutable — a test edits this to stand for a database change, then forces a reload. */
  row: SnapshotRow;
  refresh: () => Promise<void>;
  ingest: (body: unknown) => Promise<{ status: number; json: Record<string, unknown> }>;
  entity: () => ObservedEntity;
};

function snapshotRow(overrides: SnapshotRow = {}): SnapshotRow {
  return {
    driver_id: DRIVER,
    driver_name: "Test Rider",
    driver_code: "10001",
    employee_id: "1001",
    zone_id: null,
    zone_name: null,
    partner_id: null,
    partner_name: null,
    vehicle_type: "bike",
    is_on_duty: true,
    is_online: true,
    is_blocked: false,
    account_status: "active",
    latitude: LAT,
    longitude: LNG,
    speed_mps: 0,
    heading_deg: null,
    accuracy_meters: 8,
    battery_pct: 80,
    is_mocked: false,
    tracking_status: "idle",
    active_delivery_id: null,
    zone_status: "in_zone",
    last_report_at: new Date().toISOString(),
    deliveries_today: 0,
    distance_today_meters: 0,
    shift_start_at: null,
    shift_end_at: null,
    // Stands in for `attendance_logs.check_in_at`: a clock-out then clock-in moves this.
    on_duty_since: "2026-08-16T05:00:00.000Z",
    ...overrides,
  };
}

function makeHarness(): Harness {
  const state = {
    storage: {
      get: async () => undefined,
      put: async () => {},
      delete: async () => true,
      setAlarm: async () => {},
      deleteAlarm: async () => {},
    },
    getWebSockets: () => [],
    acceptWebSocket: () => {},
    blockConcurrencyWhile: async (fn: () => unknown) => fn(),
    waitUntil: () => {},
  };

  const holder: { row: SnapshotRow } = { row: snapshotRow() };
  const realFetch = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(SUPABASE_URL)) return realFetch(input as RequestInfo, init);
    const path = url.slice(SUPABASE_URL.length);
    const body = (value: unknown, status = 200) =>
      new Response(JSON.stringify(value), {
        status,
        headers: { "content-type": "application/json" },
      });

    if (path.startsWith("/auth/v1/user")) return body({ id: DRIVER });
    if (path.startsWith("/rest/v1/rpc/admin_live_fleet_snapshot")) {
      return body({ settings: null, drivers: [holder.row] });
    }
    if (path.startsWith("/rest/v1/rpc/")) return body({});
    return body([]);
  }) as typeof fetch;

  const room = new FleetRoom(state as never, {
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: "test-service-role",
    SUPABASE_ANON_KEY: "test-anon",
    ADMIN_WS_TOKEN_SECRET: "test-secret",
    POSITION_FRAME_HZ: "4",
    TICK_MS: "2000",
    FLEET_ROOM: null,
  } as never);

  return {
    room,
    get row() {
      return holder.row;
    },
    set row(next: SnapshotRow) {
      holder.row = next;
    },
    refresh: async () => {
      await room.fetch(new Request(`${SUPABASE_URL}/refresh`));
    },
    ingest: async (payload: unknown) => {
      const response = await room.fetch(
        new Request(`${SUPABASE_URL}/ingest`, {
          method: "POST",
          headers: { authorization: "Bearer test-token", "content-type": "application/json" },
          body: JSON.stringify(payload),
        }),
      );
      return {
        status: response.status,
        json: (await response.json()) as Record<string, unknown>,
      };
    },
    entity: () => {
      const { entities } = room as unknown as { entities: Map<string, ObservedEntity> };
      const entity = entities.get(DRIVER);
      assert.ok(entity, "driver should be in the room");
      return entity;
    },
  };
}

function fix(overrides: Record<string, unknown> = {}) {
  return {
    lat: LAT,
    lng: LNG,
    speed_mps: 9,
    // `accuracy_m` on the wire (`accuracy_meters` is the column name) — see the app's
    // LivePositionPublisher.
    accuracy_m: 8,
    heading_deg: 90,
    heading_source: "gps",
    battery_pct: 80,
    tracking_status: "moving",
    client_ts: new Date().toISOString(),
    active_delivery_id: null,
    ...overrides,
  };
}

describe("open delivery drives On Delivery", () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });

  it("reads On Delivery from the roster even while the rider is moving", async () => {
    await h.ingest({ points: [fix()] });
    assert.equal(h.entity().status, "moving");

    // The pickup is created: `deliveries.status` becomes in_transit, which the snapshot
    // now reports. The phone is still stamping `moving` and sending no delivery id.
    h.row = snapshotRow({ active_delivery_id: "d-1" });
    await h.refresh();
    await h.ingest({ points: [fix({ client_ts: new Date(Date.now() + 1_000).toISOString() })] });

    assert.equal(h.entity().activeDeliveryId, "d-1");
    assert.equal(h.entity().status, "on_delivery");
  });

  it("publishes a frame for a status that changed with no new position", async () => {
    await h.ingest({ points: [fix({ speed_mps: 0, tracking_status: "idle" })] });
    const before = h.entity().posVersion;

    h.row = snapshotRow({ active_delivery_id: "d-1" });
    await h.refresh();

    assert.equal(h.entity().status, "on_delivery");
    assert.ok(
      h.entity().posVersion > before,
      "status rides the position frame, so a roster-only change must bump posVersion",
    );
  });

  it("lets an ingest announce a delivery but never clear one", async () => {
    await h.ingest({ points: [fix({ active_delivery_id: "d-2" })] });
    assert.equal(h.entity().activeDeliveryId, "d-2");

    // The foreground service reads its delivery id from another isolate's preferences
    // cache and usually sends null. Honouring that null is what kept the status off.
    await h.ingest({
      points: [fix({ active_delivery_id: null, client_ts: new Date(Date.now() + 1_000).toISOString() })],
    });
    assert.equal(h.entity().activeDeliveryId, "d-2");
  });

  it("clears the delivery when the roster says it closed", async () => {
    await h.ingest({ points: [fix({ active_delivery_id: "d-3" })] });
    assert.equal(h.entity().status, "on_delivery");

    h.row = snapshotRow({ active_delivery_id: null });
    await h.refresh();
    assert.equal(h.entity().activeDeliveryId, null);
    assert.notEqual(h.entity().status, "on_delivery");
  });
});

describe("duty state version across a re-clock-in", () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });

  it("refuses a stale version within one session", async () => {
    await h.ingest({ points: [fix()], duty_state_version: 7 });
    const stale = await h.ingest({ points: [fix()], duty_state_version: 6 });
    assert.equal(stale.status, 409);
    assert.equal(stale.json.error, "stale_duty_state");
  });

  it("accepts a lower version after a new check-in, which is a new session", async () => {
    await h.ingest({ points: [fix()], duty_state_version: 7 });

    // Clock out, clock in: a different `attendance_logs.check_in_at`. The restarted
    // foreground service can read a lower counter from its own preferences cache, and
    // refusing it left a driver who was online and moving drawn as Offline.
    h.row = snapshotRow({ on_duty_since: "2026-08-16T09:00:00.000Z" });
    await h.refresh();

    const accepted = await h.ingest({ points: [fix()], duty_state_version: 3 });
    assert.equal(accepted.status, 200);
    assert.equal(h.entity().status, "moving");
  });
});

describe("coarse fixes", () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });

  it("does not let a cell-tower fix move a pin that has a warm GPS fix", async () => {
    await h.ingest({ points: [fix({ accuracy_m: 8, speed_mps: 0, tracking_status: "idle" })] });
    const { lat, lng } = h.entity();

    const result = await h.ingest({
      points: [
        fix({
          lat: LAT + 0.05,
          lng: LNG + 0.05,
          accuracy_m: 100,
          speed_mps: 0,
          tracking_status: "idle",
          client_ts: new Date(Date.now() + 1_000).toISOString(),
        }),
      ],
    });

    assert.equal(result.status, 200);
    assert.equal(result.json.accepted, 0, "the coarse fix did not move the live pin");
    assert.equal(h.entity().lat, lat);
    assert.equal(h.entity().lng, lng);

    // Deferred, not dropped: it is queued for the durable write, so the history keeps
    // what the device actually said.
    assert.ok(
      (result.json.queued as number) >= 1,
      "the coarse point is still queued for the flush",
    );
  });

  it("accepts a coarse fix when there is no accurate one to prefer", async () => {
    // No last-known position at all: an approximate pin beats no pin.
    h.row = snapshotRow({ latitude: null, longitude: null, last_report_at: null });

    const result = await h.ingest({
      points: [fix({ lat: LAT + 0.05, accuracy_m: 100, speed_mps: 0, tracking_status: "idle" })],
    });
    assert.equal(result.json.accepted, 1);
    assert.equal(h.entity().lat, LAT + 0.05);
  });
});
