import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { composeFleetFeed, type FeedDriverView } from "./fleet-feed";
import { emptyFleetFlags } from "./fleet-status";
import type { FleetFeedItem } from "./fleet-types";

const NOW = 1_724_000_000_000;

function item(
  overrides: Partial<FleetFeedItem> & Pick<FleetFeedItem, "eventKey">,
): FleetFeedItem {
  return {
    id: overrides.id ?? `${overrides.eventKey}:${overrides.atMs ?? NOW}`,
    kind: overrides.kind ?? "ops",
    driverId: overrides.driverId ?? "d1",
    driverName: overrides.driverName ?? "Ali",
    eventKey: overrides.eventKey,
    severity: overrides.severity ?? "info",
    value: overrides.value ?? null,
    statusAfter: overrides.statusAfter ?? null,
    success: overrides.success ?? true,
    errorCode: overrides.errorCode ?? null,
    latitude: overrides.latitude ?? null,
    longitude: overrides.longitude ?? null,
    context: overrides.context ?? {},
    atMs: overrides.atMs ?? NOW,
  };
}

function driver(overrides: Partial<FeedDriverView> = {}): FeedDriverView {
  return {
    driverId: "d1",
    status: "idle",
    flags: emptyFleetFlags(),
    ...overrides,
  };
}

describe("composeFleetFeed", () => {
  it("pins GPS offline above a leftover Entered zone when the phone went silent", () => {
    const feed = composeFleetFeed(
      [
        item({
          eventKey: "location.zone_entry",
          atMs: NOW + 5_000,
        }),
      ],
      [driver({ status: "gps_offline" })],
      NOW + 90_000,
    );
    assert.equal(feed[0]?.eventKey, "gps.offline");
    assert.ok(feed.some((row) => row.eventKey === "location.zone_entry"));
  });

  it("does not duplicate a GPS offline row the worker already authored", () => {
    const feed = composeFleetFeed(
      [
        item({
          kind: "fleet",
          eventKey: "gps.offline",
          atMs: NOW + 80_000,
        }),
        item({
          eventKey: "location.zone_entry",
          atMs: NOW + 5_000,
        }),
      ],
      [driver({ status: "gps_offline" })],
      NOW + 90_000,
    );
    assert.equal(feed.filter((row) => row.eventKey === "gps.offline").length, 1);
    assert.equal(feed[0]?.eventKey, "gps.offline");
  });

  it("sorts by time descending so a current-status pin does not steal list order", () => {
    const feed = composeFleetFeed(
      [
        item({
          eventKey: "delivery.pickup_create",
          atMs: NOW,
        }),
        item({
          eventKey: "movement.started",
          atMs: NOW + 5_000,
        }),
      ],
      [driver({ status: "on_delivery" })],
      NOW + 10_000,
    );
    assert.deepEqual(
      feed.map((row) => row.eventKey),
      ["movement.started", "delivery.pickup_create"],
    );
  });

  it("drops the pickup pin after delivery.complete even while still on_delivery", () => {
    const feed = composeFleetFeed(
      [
        item({
          eventKey: "delivery.pickup_create",
          atMs: NOW,
        }),
        item({
          eventKey: "delivery.complete",
          atMs: NOW + 10_000,
        }),
      ],
      [driver({ status: "on_delivery" })],
      NOW + 20_000,
    );
    assert.equal(feed[0]?.eventKey, "delivery.complete");
    assert.equal(feed[1]?.eventKey, "delivery.pickup_create");
  });

  it("lets zone.entry clear the Left zone pin even when out_of_zone is still set", () => {
    const feed = composeFleetFeed(
      [
        item({
          eventKey: "zone.exit",
          atMs: NOW,
        }),
        item({
          eventKey: "zone.entry",
          atMs: NOW + 10_000,
        }),
      ],
      [driver({ flags: { ...emptyFleetFlags(), out_of_zone: true } })],
      NOW + 20_000,
    );
    assert.equal(feed[0]?.eventKey, "zone.entry");
    assert.equal(feed[1]?.eventKey, "zone.exit");
  });
});
