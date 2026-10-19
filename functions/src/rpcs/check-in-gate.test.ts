import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isCheckInPhotoKeyForKey,
  matchCheckInRestaurant,
  nearestCheckInRestaurant,
  type CheckInCandidate,
} from "./check-in-gate";

const PIN = { latitude: 29.375, longitude: 47.978, name: "Salmiya" };
const FAR = { latitude: 29.5, longitude: 47.978, name: "Far" };

function candidate(id: string, restaurant: Record<string, unknown>, geofences: Record<string, unknown>[] = []): CheckInCandidate {
  return { id, restaurant, geofences };
}

const SQUARE = {
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

describe("check-in gate", () => {
  it("accepts a rider inside the restaurant geofence", () => {
    const match = matchCheckInRestaurant({
      candidates: [candidate("r1", PIN, [SQUARE])],
      lat: 29.375,
      lng: 47.978,
      proximityMeters: 500,
    });
    assert.equal(match?.id, "r1");
    assert.equal(match?.name, "Salmiya");
  });

  it("refuses a rider outside every restaurant range", () => {
    const match = matchCheckInRestaurant({
      candidates: [candidate("r1", PIN)],
      lat: 29.45,
      lng: 47.978,
      proximityMeters: 500,
    });
    assert.equal(match, null);
    const nearest = nearestCheckInRestaurant({
      candidates: [candidate("r1", PIN), candidate("r2", FAR)],
      lat: 29.45,
      lng: 47.978,
    });
    assert.equal(nearest?.id, "r2");
    assert.ok((nearest?.distanceM ?? 0) > 0);
  });

  it("ignores a requested restaurant that is out of range", () => {
    const match = matchCheckInRestaurant({
      candidates: [candidate("r1", PIN), candidate("r2", FAR)],
      lat: 29.375,
      lng: 47.978,
      proximityMeters: 500,
      requestedId: "r2",
    });
    assert.equal(match?.id, "r1");
  });

  it("honours a requested restaurant only when it is allowed", () => {
    const match = matchCheckInRestaurant({
      candidates: [candidate("r1", PIN), candidate("r2", { ...PIN, latitude: 29.376 })],
      lat: 29.375,
      lng: 47.978,
      proximityMeters: 500,
      requestedId: "r2",
    });
    assert.equal(match?.id, "r2");
  });

  it("binds the check-in photo key to the rider prefix", () => {
    assert.equal(isCheckInPhotoKeyForKey("u1", "drivers/u1/check_in/2026-10-19.jpg"), true);
    assert.equal(isCheckInPhotoKeyForKey("u1", "drivers/u2/check_in/2026-10-19.jpg"), false);
    assert.equal(isCheckInPhotoKeyForKey("u1", "drivers/u1/check_in/../secret.jpg"), false);
    assert.equal(isCheckInPhotoKeyForKey("u1", ""), false);
  });
});
