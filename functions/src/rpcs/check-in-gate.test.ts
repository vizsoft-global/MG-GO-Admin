import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isCheckInPhotoKeyForKey,
  matchCheckInRestaurant,
  nearestCheckInRestaurant,
  needsCheckIn,
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

  it("accepts the per-attempt key shape the presign route now writes", () => {
    const key = "drivers/u1/check_in/2026-10-19/2f7d5a4e-0b3f-4c11-9ac4-1f9f6a1d6c55.jpg";
    assert.equal(isCheckInPhotoKeyForKey("u1", key), true);
    assert.equal(isCheckInPhotoKeyForKey("u2", key), false);
    assert.equal(
      isCheckInPhotoKeyForKey("u1", "drivers/u1/check_in/2026-10-19/../../other.jpg"),
      false,
    );
  });
});

/**
 * The precheck and the duty write share one expression, so the matrix below is
 * the contract both of them answer to.
 */
describe("needsCheckIn", () => {
  it("requires a check-in when the rider has no attendance log for the day", () => {
    assert.equal(needsCheckIn(null), true);
    assert.equal(needsCheckIn(undefined), true);
  });

  it("requires a check-in when the log row has no check_in_at", () => {
    assert.equal(needsCheckIn({ driver_id: "u1", log_date: "2026-10-19" }), true);
    assert.equal(needsCheckIn({ check_in_at: null }), true);
  });

  it("does not require a check-in once check_in_at is stamped", () => {
    assert.equal(needsCheckIn({ check_in_at: new Date("2026-10-19T05:00:00Z") }), false);
  });

  it("does not require a check-in for an open log row (clocked out and back in today)", () => {
    assert.equal(
      needsCheckIn({
        check_in_at: new Date("2026-10-19T05:00:00Z"),
        check_out_at: null,
        status: "present",
      }),
      false,
    );
  });
});
