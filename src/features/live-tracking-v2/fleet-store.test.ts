import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { emptyFleetFlags } from "./fleet-status";
import { FleetStore, type FleetSnapshotRow } from "./fleet-store";
import {
  emptyFleetFilters,
  parsePersistedFleetFilters,
  toggleFleetAlertsOnly,
  toggleFleetStatusChip,
  type FleetZone,
} from "./fleet-types";
import { encodePosition, flagBits } from "./fleet-wire";

const NOW = "2026-08-16T12:00:00.000Z";

function row(overrides: Partial<FleetSnapshotRow> = {}): FleetSnapshotRow {
  return {
    driver_id: "d1",
    driver_name: "Jhon Doe",
    driver_code: "10001",
    employee_id: "1001",
    avatar_object_key: null,
    avatar_updated_at: null,
    account_status: "active",
    is_on_duty: true,
    is_blocked: false,
    is_online: true,
    zone_id: "z1",
    zone_name: "Kuwait City",
    partner_id: "p1",
    partner_name: "Talabat",
    restaurant_name: "Burger Place",
    vehicle_reg_number: "ABC",
    vehicle_bike_id: "B1",
    latitude: 29.37,
    longitude: 47.98,
    speed_mps: 0,
    heading_deg: 0,
    accuracy_meters: 8,
    battery_pct: 80,
    is_mocked: false,
    tracking_status: "idle",
    zone_status: "in_zone",
    out_of_zone_since: null,
    distance_today_meters: 0,
    active_delivery_id: null,
    last_seen_at: NOW,
    last_report_at: NOW,
    on_duty_since: NOW,
    deliveries_today: 0,
    deliveries_completed_today: 0,
    shift: null,
    ...overrides,
  };
}

const ZONE: FleetZone = {
  id: "z1",
  name: "Kuwait City",
  color: "#10b981",
  zoneType: "circle",
  ring: null,
  center: [47.98, 29.37],
  radiusMeters: 500,
};

describe("persisted status filters", () => {
  it("restores a status subset from storage", () => {
    const next = parsePersistedFleetFilters(
      JSON.stringify({ statuses: ["idle", "location_off"], alertsOnly: false }),
    );
    assert.deepEqual(next.statuses, ["idle", "location_off"]);
    assert.equal(next.alertsOnly, false);
  });

  it("drops unknown statuses so a stale payload cannot hide the fleet", () => {
    const next = parsePersistedFleetFilters(
      JSON.stringify({ statuses: ["idle", "flying"], alertsOnly: true }),
    );
    assert.deepEqual(next.statuses, ["idle"]);
    assert.equal(next.alertsOnly, true);
  });

  it("treats missing storage as the default all-statuses view", () => {
    const next = parsePersistedFleetFilters(null);
    assert.equal(next.statuses, null);
    assert.equal(next.alertsOnly, false);
  });
});

describe("toggleFleetStatusChip / toggleFleetAlertsOnly", () => {
  it("makes Alert Only exclusive by clearing status chips", () => {
    const next = toggleFleetAlertsOnly({
      ...emptyFleetFilters(),
      statuses: ["moving", "idle"],
    });
    assert.equal(next.alertsOnly, true);
    assert.equal(next.statuses, null);
  });

  it("turns Alert Only off when a status chip is picked", () => {
    const next = toggleFleetStatusChip(
      { ...emptyFleetFilters(), alertsOnly: true },
      "moving",
    );
    assert.equal(next.alertsOnly, false);
    assert.deepEqual(next.statuses, ["moving"]);
  });
});

describe("FleetStore filters and roster", () => {
  it("counts On Delivery from an open pickup, not from the phone stamp", () => {
    const store = new FleetStore();
    store.applySnapshot({
      generatedAt: NOW,
      settings: null,
      drivers: [row({ active_delivery_id: "del-1", tracking_status: "idle", speed_mps: 0 })],
    });
    assert.equal(store.getSnapshot().kpis.onDelivery, 1);
    assert.equal(store.getDriver("d1")?.status, "on_delivery");
  });

  it("keeps a driver in the rail after a viewport cull", () => {
    const store = new FleetStore();
    store.applyMeta([
      {
        idIdx: 1,
        driverId: "d1",
        driverName: "Jhon Doe",
        driverCode: "10001",
        employeeId: "1001",
        avatarObjectKey: null,
        avatarUpdatedAt: null,
        zoneId: "z1",
        zoneName: "Kuwait City",
        partnerId: "p1",
        partnerName: "Talabat",
        restaurantName: "Burger Place",
        vehicleLabel: "B1",
        accountStatus: "active",
        onDutySince: NOW,
        deliveriesToday: 0,
        deliveriesCompletedToday: 0,
        distanceTodayMeters: 0,
        batteryPct: 80,
        accuracyMeters: 8,
        activeDeliveryId: null,
        currentZoneId: null,
        currentZoneName: null,
        shiftStartAt: null,
        shiftEndAt: null,
        lastFixAt: NOW,
      },
    ]);
    store.applyDelta({
      ts: Date.parse(NOW),
      e: [
        encodePosition({
          idIdx: 1,
          lat: 29.37,
          lng: 47.98,
          speedMps: 0,
          headingDeg: 0,
          status: "idle",
          flags: emptyFleetFlags(),
          ageMs: 0,
        }),
      ],
      gone: [],
    });
    store.applyDelta({ ts: Date.parse(NOW) + 1_000, e: [], gone: [1] });
    assert.equal(store.getDriver("d1") != null, true);
    assert.ok(store.getSnapshot().driverIds.includes("d1"));
  });

  it("lists a blocked driver when the Blocked chip is the only status", () => {
    const store = new FleetStore();
    store.applySnapshot({
      generatedAt: NOW,
      settings: null,
      drivers: [
        row({ is_blocked: true, is_on_duty: false, latitude: 29.37, longitude: 47.98 }),
        row({
          driver_id: "d2",
          driver_name: "Moving Rider",
          driver_code: "10002",
          is_blocked: false,
          tracking_status: "moving",
          speed_mps: 8,
        }),
      ],
    });
    store.setFilters({ statuses: ["blocked"] });
    assert.deepEqual(store.getSnapshot().driverIds, ["d1"]);
  });

  it("keeps the selected driver in the rail when the filters exclude them", () => {
    // Selecting an Offline rider and watching their card vanish — because Offline is not a
    // checked chip — takes away the surface that explains why they are offline.
    const store = new FleetStore();
    store.applySnapshot({
      generatedAt: NOW,
      settings: null,
      drivers: [
        row({ is_on_duty: false, latitude: 29.37, longitude: 47.98 }),
        row({
          driver_id: "d2",
          driver_name: "Moving Rider",
          driver_code: "10002",
          tracking_status: "moving",
          speed_mps: 8,
        }),
      ],
    });
    store.setFilters({ statuses: ["moving"] });
    assert.deepEqual(store.getSnapshot().driverIds, ["d2"]);

    store.selectDriver("d1");
    const pinned = store.getSnapshot();
    assert.ok(pinned.driverIds.includes("d1"));
    // Pinned, not counted: the KPI tiles keep describing the chips above them.
    assert.equal(pinned.counts.offline, 0);

    store.clearSelection();
    assert.deepEqual(store.getSnapshot().driverIds, ["d2"]);
  });

  it("finds an out-of-zone driver by name in search", () => {
    const store = new FleetStore();
    store.applySnapshot({
      generatedAt: NOW,
      settings: null,
      drivers: [
        row({
          driver_name: "Out Rider",
          out_of_zone_since: NOW,
          zone_status: "out_of_zone",
        }),
      ],
    });
    store.setFilters({ search: "Out Rider" });
    assert.deepEqual(store.getSnapshot().driverIds, ["d1"]);
    assert.equal(store.getDriver("d1")?.flags.out_of_zone, true);

    store.setFilters({ search: "out of zone" });
    assert.deepEqual(store.getSnapshot().driverIds, ["d1"]);
  });

  it("lists a driver who arrived as meta only, the way an off-map Out of Zone rider does", () => {
    const store = new FleetStore();
    const flags = { ...emptyFleetFlags(), on_duty: true, online: true, out_of_zone: true };
    store.applyMeta([
      {
        idIdx: 7,
        driverId: "d-out",
        driverName: "Out Rider",
        driverCode: "10009",
        employeeId: "9",
        avatarObjectKey: null,
        avatarUpdatedAt: null,
        zoneId: "z1",
        zoneName: "Kuwait City",
        partnerId: "p1",
        partnerName: "Talabat",
        restaurantName: null,
        vehicleLabel: null,
        accountStatus: "active",
        onDutySince: NOW,
        deliveriesToday: 0,
        deliveriesCompletedToday: 0,
        distanceTodayMeters: 0,
        batteryPct: 80,
        accuracyMeters: 8,
        activeDeliveryId: null,
        currentZoneId: null,
        currentZoneName: null,
        shiftStartAt: null,
        shiftEndAt: null,
        lastFixAt: NOW,
        status: "idle",
        flagBits: flagBits(flags),
      },
    ]);
    store.setFilters({ search: "Out Rider" });
    assert.deepEqual(store.getSnapshot().driverIds, ["d-out"]);
    assert.equal(store.getDriver("d-out")?.status, "idle");
    assert.equal(store.getDriver("d-out")?.flags.out_of_zone, true);
  });

  it("does not let an empty hello wipe zones the snapshot already loaded", () => {
    const store = new FleetStore();
    store.applySnapshot({
      generatedAt: NOW,
      settings: null,
      drivers: [row()],
      zones: [ZONE],
    });
    store.applyHello({
      serverTime: Date.parse(NOW),
      frameHz: 4,
      settings: {},
      zones: [],
    });
    assert.equal(store.getSnapshot().zones.length, 1);
    assert.equal(store.getSnapshot().zones[0]?.name, "Kuwait City");
  });

  it("ages a Moving driver to GPS offline on the local clock", () => {
    const store = new FleetStore();
    store.applySnapshot({
      generatedAt: NOW,
      settings: null,
      drivers: [row({ tracking_status: "moving", speed_mps: 8 })],
    });
    assert.equal(store.getDriver("d1")?.status, "moving");

    const fixAt = Date.parse(NOW);
    // Inside the window the status must not move: a rider between reports is not offline.
    store.tickStatusDecay(fixAt + 60_000);
    assert.equal(store.getDriver("d1")?.status, "moving");
    assert.equal(store.getDriver("d1")?.flags.stale_gps, true);

    store.tickStatusDecay(fixAt + 91_000);
    assert.equal(store.getDriver("d1")?.status, "gps_offline");
    assert.equal(store.getSnapshot().kpis.gpsOffline, 1);
    assert.equal(store.getSnapshot().kpis.moving, 0);
  });

  it("leaves an off-duty driver Offline rather than decaying it to GPS offline", () => {
    const store = new FleetStore();
    store.applySnapshot({
      generatedAt: NOW,
      settings: null,
      drivers: [row({ is_on_duty: false })],
    });
    assert.equal(store.getDriver("d1")?.status, "offline");
    store.tickStatusDecay(Date.parse(NOW) + 10 * 60_000);
    assert.equal(store.getDriver("d1")?.status, "offline");
  });

  it("dedupes feed items so a poll seed plus a socket frame do not double", () => {
    const store = new FleetStore();
    store.applyOpsEvents([
      {
        id: "1",
        driverId: "d1",
        category: "delivery",
        operationKey: "delivery.pickup_create",
        success: true,
        errorCode: null,
        context: {},
        occurredAt: NOW,
      },
    ]);
    store.applyOpsEvents([
      {
        id: "1",
        driverId: "d1",
        category: "delivery",
        operationKey: "delivery.pickup_create",
        success: true,
        errorCode: null,
        context: {},
        occurredAt: NOW,
      },
    ]);
    assert.equal(store.getSnapshot().feed.length, 1);
  });
});
