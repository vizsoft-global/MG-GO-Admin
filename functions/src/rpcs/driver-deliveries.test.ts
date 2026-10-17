import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assertExternalOrderId,
  assertPublishedPickupRestaurant,
  isWithinDeliveryRange,
  normalizeExternalOrderId,
  orderIdSpellings,
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
  it("keeps the digits and drops a legacy Bites prefix", () => {
    assert.equal(normalizeExternalOrderId(" #12345# "), "12345");
    assert.equal(assertExternalOrderId("#12345"), "12345");
    assert.equal(assertExternalOrderId("  "), null);
    // Orders allocated before the prefix was dropped still work: what is stored is
    // the digits alone, which is what the Bites order carries.
    assert.equal(assertExternalOrderId(" ORDBTS1215 "), "1215");
    assert.equal(assertExternalOrderId("ordbts1215"), "1215");
    assert.equal(normalizeExternalOrderId("ORDBTS1215"), "1215");
  });

  it("probes the digits form and the legacy prefixed form a stored row could hold", () => {
    assert.deepEqual(orderIdSpellings("12345"), ["12345", "ORDBTS12345"]);
  });

  it("refuses ids that cannot be a merchant order number", () => {
    for (const bad of ["12 34", "12ab", "ORD BTS", "ORD/1215", "a".repeat(33), "ORDBTS"]) {
      assert.throws(() => assertExternalOrderId(bad), (error: unknown) => {
        assert.equal(messageOf(error), "invalid_order_id");
        return true;
      });
    }
    // Only hashes is the same as typing nothing, which is a "no id", not junk.
    assert.equal(assertExternalOrderId("#"), null);
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

  it("refuses a pickup when no published restaurant is assigned", () => {
    assert.throws(
      () => assertPublishedPickupRestaurant([]),
      (error: unknown) => messageOf(error) === "no_restaurants_assigned",
    );
    assert.doesNotThrow(() => assertPublishedPickupRestaurant([{ id: "r1" }]));
  });
});
