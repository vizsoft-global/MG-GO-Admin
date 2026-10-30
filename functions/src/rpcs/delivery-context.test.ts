import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  DELIVERY_CONTEXT_MAX_AGE_MS,
  cachedRestaurantsFor,
  isDeliveryContextStale,
  type DeliveryContextSnapshot,
} from "./delivery-context";

const snapshot = (overrides: Partial<DeliveryContextSnapshot> = {}): DeliveryContextSnapshot => ({
  builtAt: new Date("2026-10-30T12:00:00Z"),
  settings: { proximityMeters: 500, earlyDropMeters: 50, proofOcrMode: "block" },
  zones: { z1: { name: "Salmiya", zone_type: "polygon", geometry: null } },
  restaurants: {
    b: { id: "b", name: "Beta", latitude: 29.3, longitude: 48.0, geofences: [] },
    a: { id: "a", name: "Alpha", latitude: 29.2, longitude: 47.9, geofences: [] },
  },
  truncated: false,
  ...overrides,
});

describe("isDeliveryContextStale", () => {
  it("fresh inside the window", () => {
    const built = new Date("2026-10-30T12:00:00Z");
    assert.equal(
      isDeliveryContextStale(snapshot(), new Date(built.getTime() + DELIVERY_CONTEXT_MAX_AGE_MS - 1)),
      false,
    );
  });

  it("stale once the sweep has been quiet for longer", () => {
    const built = new Date("2026-10-30T12:00:00Z");
    assert.equal(
      isDeliveryContextStale(snapshot(), new Date(built.getTime() + DELIVERY_CONTEXT_MAX_AGE_MS + 1)),
      true,
    );
  });
});

describe("cachedRestaurantsFor", () => {
  it("returns the rider's stores sorted by name", () => {
    const rows = cachedRestaurantsFor(["b", "a"], snapshot());
    assert.deepEqual(rows?.map((row) => row.id), ["a", "b"]);
  });

  it("is null for a store the build has not seen, so the caller reads live", () => {
    assert.equal(cachedRestaurantsFor(["a", "missing"], snapshot()), null);
  });

  it("keeps the empty assignment empty rather than falling back", () => {
    assert.deepEqual(cachedRestaurantsFor([], snapshot()), []);
  });
});
