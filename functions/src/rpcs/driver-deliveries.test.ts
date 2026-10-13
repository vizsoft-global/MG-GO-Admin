import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assertExternalOrderId,
  isWithinDeliveryRange,
  normalizeExternalOrderId,
  parseProofKeys,
  resolvePickupRestaurantId,
  restaurantDeliveryAllowed,
} from "./driver-deliveries";

const PIN = { latitude: 29.375, longitude: 47.978 };

const SQUARE: Record<string, unknown> = {
  kind: "inclusion",
  zone_type: "polygon",
  geometry: {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [47.97, 29.37],
          [47.99, 29.37],
          [47.99, 29.38],
          [47.97, 29.38],
          [47.97, 29.37],
        ],
      ],
    },
  },
};

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

describe("parseProofKeys", () => {
  it("accepts a scalar key and a JSON array, and refuses junk", () => {
    assert.deepEqual(parseProofKeys("drivers/a/pickup.jpg"), ["drivers/a/pickup.jpg"]);
    assert.deepEqual(parseProofKeys('["a.jpg","b.jpg","a.jpg"]'), ["a.jpg", "b.jpg"]);
    assert.deepEqual(parseProofKeys(""), []);
    assert.throws(() => parseProofKeys("foo..bar"), (error: unknown) => {
      assert.equal(messageOf(error), "invalid_proof_keys");
      return true;
    });
    assert.throws(() => parseProofKeys('["1","2","3","4","5","6"]'), (error: unknown) => {
      assert.equal(messageOf(error), "too_many_proofs");
      return true;
    });
  });
});

describe("order id", () => {
  it("strips hashes, lowercases, and rejects non-digits", () => {
    assert.equal(normalizeExternalOrderId(" #ABC12# "), "abc12");
    assert.equal(assertExternalOrderId("#12345"), "12345");
    assert.equal(assertExternalOrderId("  "), null);
    assert.throws(() => assertExternalOrderId("12ab"), (error: unknown) => {
      assert.equal(messageOf(error), "invalid_order_id");
      return true;
    });
  });
});

describe("restaurant geofence", () => {
  it("lets inclusion win, exclusion refuse, and falls back to the pin radius", () => {
    assert.equal(
      restaurantDeliveryAllowed({
        lat: 29.375,
        lng: 47.978,
        restaurant: PIN,
        geofences: [SQUARE],
        proximityMeters: 500,
      }),
      true,
    );
    assert.equal(
      restaurantDeliveryAllowed({
        lat: 29.375,
        lng: 47.978,
        restaurant: PIN,
        geofences: [{ ...SQUARE, kind: "exclusion" }],
        proximityMeters: 500,
      }),
      false,
    );
    assert.equal(
      restaurantDeliveryAllowed({
        lat: 29.375,
        lng: 47.978,
        restaurant: PIN,
        geofences: [],
        proximityMeters: 50,
      }),
      true,
    );
    assert.equal(
      restaurantDeliveryAllowed({
        lat: 29.4,
        lng: 48.1,
        restaurant: PIN,
        geofences: [],
        proximityMeters: 50,
      }),
      false,
    );
  });

  it("resolves unique, allowed, then nearest published pin", () => {
    const far = { latitude: 29.5, longitude: 48.2 };
    assert.equal(
      resolvePickupRestaurantId({
        candidates: [{ id: "only", restaurant: PIN, geofences: [] }],
        lat: 29.4,
        lng: 48.1,
        proximityMeters: 50,
      }),
      "only",
    );
    assert.equal(
      resolvePickupRestaurantId({
        candidates: [
          { id: "far", restaurant: far, geofences: [] },
          { id: "near", restaurant: PIN, geofences: [] },
        ],
        lat: 29.375,
        lng: 47.978,
        proximityMeters: 80,
      }),
      "near",
    );
    assert.equal(
      resolvePickupRestaurantId({
        candidates: [
          { id: "far", restaurant: far, geofences: [] },
          { id: "near", restaurant: PIN, geofences: [] },
        ],
        lat: 29.41,
        lng: 48.05,
        proximityMeters: 10,
      }),
      "near",
    );
  });

  it("treats proximity 0 as always in range and honours the assigned zone buffer", () => {
    assert.equal(
      isWithinDeliveryRange({
        lat: 1,
        lng: 1,
        proximityMeters: 0,
        zone: null,
        restaurants: [],
      }),
      true,
    );
    assert.equal(
      isWithinDeliveryRange({
        lat: 29.375,
        lng: 47.978,
        proximityMeters: 500,
        zone: { geometry: SQUARE.geometry, zone_type: "polygon" },
        restaurants: [],
      }),
      true,
    );
  });
});
