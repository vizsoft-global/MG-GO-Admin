import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createFleetBaseCache,
  fleetBaseCacheKey,
  projectFleetSnapshot,
  type FleetCacheRow,
} from "./fleet-snapshot-cache";

const NOW = Date.parse("2026-10-12T09:00:00.000Z");

function row(partial: Partial<FleetCacheRow> & Pick<FleetCacheRow, "driver_id">): FleetCacheRow {
  return {
    zone_id: null,
    partner_id: null,
    is_on_duty: false,
    is_blocked: false,
    active_delivery_id: null,
    last_seen_at: new Date(NOW).toISOString(),
    phone: "96500000000",
    contact: "ops@example.com",
    email: "rider@example.com",
    driver_phone: "96511111111",
    ...partial,
  };
}

const base = {
  drivers: [
    row({ driver_id: "a", zone_id: "z1", partner_id: "p1", phone: "111" }),
    row({ driver_id: "b", zone_id: "z2", partner_id: "p2", phone: "222" }),
  ],
};

describe("fleet snapshot cache", () => {
  it("gives each caller only their zone and partner within one cache fill", async () => {
    let now = NOW;
    let loads = 0;
    const cache = createFleetBaseCache<typeof base>({ now: () => now, ttlMs: 5_000 });
    const loaded = await cache.get(async () => {
      loads += 1;
      return base;
    });
    const again = await cache.get(async () => {
      loads += 1;
      return base;
    });
    assert.equal(loads, 1);
    assert.equal(again, loaded);

    const callerA = projectFleetSnapshot(loaded, {
      zoneIds: ["z1"],
      partnerIds: ["p1"],
      seenWithinMinutes: 30,
      nowMs: now,
      canSeeContact: true,
    });
    const callerB = projectFleetSnapshot(loaded, {
      zoneIds: ["z2"],
      partnerIds: ["p2"],
      seenWithinMinutes: 30,
      nowMs: now,
      canSeeContact: true,
    });
    assert.deepEqual(callerA.drivers.map((driver) => driver.driver_id), ["a"]);
    assert.deepEqual(callerB.drivers.map((driver) => driver.driver_id), ["b"]);
    assert.equal(callerA.drivers[0]?.phone, "111");
    assert.equal(fleetBaseCacheKey(true), "unscoped");
    assert.notEqual(
      fleetBaseCacheKey(false, { uid: "a", permissionSetHash: "view", filtersHash: "z1" }),
      fleetBaseCacheKey(false, { uid: "b", permissionSetHash: "view", filtersHash: "z2" }),
    );
  });

  it("strips phone and contact for a caller who cannot see them without mutating the base", () => {
    const hidden = projectFleetSnapshot(base, {
      zoneIds: null,
      partnerIds: null,
      seenWithinMinutes: 30,
      nowMs: NOW,
      canSeeContact: false,
    });
    const visible = projectFleetSnapshot(base, {
      zoneIds: null,
      partnerIds: null,
      seenWithinMinutes: 30,
      nowMs: NOW,
      canSeeContact: true,
    });
    for (const driver of hidden.drivers) {
      assert.equal("phone" in driver, false);
      assert.equal("contact" in driver, false);
      assert.equal("email" in driver, false);
      assert.equal("driver_phone" in driver, false);
    }
    assert.equal(visible.drivers[0]?.phone, "111");
    assert.equal(base.drivers[0]?.phone, "111");
    assert.equal(base.drivers[1]?.contact, "ops@example.com");
  });
});
