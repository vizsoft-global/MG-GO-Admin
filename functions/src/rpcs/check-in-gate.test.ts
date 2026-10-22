import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isCheckInPhotoKeyForKey,
  isKeetaDriver,
  keetaZoneVerdict,
  matchCheckInRestaurant,
  nearestCheckInRestaurant,
  needsCheckIn,
  type CheckInCandidate,
} from "./check-in-gate";
import { restaurantReachableForPartner } from "../core/restaurant-proximity";

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
  it("accepts a rider inside the restaurant geofence", () => {    const match = matchCheckInRestaurant({
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

describe("Keeta zone gate", () => {
  const ZONE = {
    id: "z1",
    name: "Salmiya",
    geometry: SQUARE.geometry,
    zone_type: "polygon",
  };

  it("identifies a Keeta rider regardless of case or padding", () => {
    assert.equal(isKeetaDriver({ project_key: "keeta" }), true);
    assert.equal(isKeetaDriver({ project_key: " Keeta " }), true);
    assert.equal(isKeetaDriver({ project_key: "americana" }), false);
    assert.equal(isKeetaDriver({ project_key: "" }), false);
    assert.equal(isKeetaDriver({ project_key: 7 }), false);
    assert.equal(isKeetaDriver({}), false);
  });

  it("accepts a rider inside the assigned zone", () => {
    const verdict = keetaZoneVerdict({ lat: 29.375, lng: 47.978, zone: ZONE });
    assert.equal(verdict.outcome, "in_range");
    assert.deepEqual(verdict.zone, { id: "z1", name: "Salmiya" });
  });

  it("refuses a rider outside the zone and still names it", () => {
    const verdict = keetaZoneVerdict({ lat: 29.45, lng: 47.978, zone: ZONE });
    assert.equal(verdict.outcome, "outside_zone");
    assert.equal(verdict.zone?.name, "Salmiya");
  });

  it("treats a missing zone or missing shape as no_zone", () => {
    assert.deepEqual(keetaZoneVerdict({ lat: 29.375, lng: 47.978, zone: null }), {
      outcome: "no_zone",
      zone: null,
    });
    const noShape = keetaZoneVerdict({
      lat: 29.375,
      lng: 47.978,
      zone: { ...ZONE, geometry: null },
    });
    // No shape is the administrator case, so the phone is given no zone name to
    // blame on the rider's location.
    assert.equal(noShape.outcome, "no_zone");
    assert.equal(noShape.zone, null);
  });

  it("reads a circle zone from its centre and radius", () => {
    const circle = {
      id: "z2",
      name: "Circle",
      zone_type: "circle",
      geometry: {
        type: "Feature",
        geometry: { type: "Point", coordinates: [47.978, 29.375] },
        properties: { radiusMeters: 300 },
      },
    };
    assert.equal(keetaZoneVerdict({ lat: 29.376, lng: 47.978, zone: circle }).outcome, "in_range");
    assert.equal(
      keetaZoneVerdict({ lat: 29.395, lng: 47.978, zone: circle }).outcome,
      "outside_zone",
    );
  });

  /**
   * The zone gate replaces the *restaurant* proof, not the selfie: the photo key
   * check is shared with every rider, so a Keeta clock-in must still carry a key
   * that belongs to that rider.
   */
  it("still binds a Keeta selfie key to that rider", () => {
    const uid = "keeta-rider-1";
    assert.equal(
      isCheckInPhotoKeyForKey(uid, `drivers/${uid}/check_in/2026-10-23/abc.jpg`),
      true,
    );
    assert.equal(
      isCheckInPhotoKeyForKey(uid, "drivers/other-rider/check_in/2026-10-23/abc.jpg"),
      false,
    );
    assert.equal(isCheckInPhotoKeyForKey(uid, `drivers/${uid}/check_in/../secret.jpg`), false);
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

/**
 * A restaurant without a partner is shared fleet catalogue, not a restaurant
 * the rider cannot reach. The regression this guards: a rider with a partner
 * got `candidates: 0` for a published, active restaurant that carried no
 * partner, and the app told them no restaurant was assigned.
 */
describe("restaurantReachableForPartner", () => {
  const PARTNER_A = "partner-a";
  const PARTNER_B = "partner-b";

  it("keeps an unowned restaurant reachable for a rider who has a partner", () => {
    assert.equal(restaurantReachableForPartner({ partner_id: null }, PARTNER_A), true);
    assert.equal(restaurantReachableForPartner({}, PARTNER_A), true);
    assert.equal(restaurantReachableForPartner({ partner_id: "" }, PARTNER_A), true);
    assert.equal(restaurantReachableForPartner({ partner_id: "   " }, PARTNER_A), true);
  });

  it("keeps the rider's own partner restaurants reachable", () => {
    assert.equal(restaurantReachableForPartner({ partner_id: PARTNER_A }, PARTNER_A), true);
  });

  it("refuses another partner's restaurant", () => {
    assert.equal(restaurantReachableForPartner({ partner_id: PARTNER_B }, PARTNER_A), false);
  });

  it("lets a rider without a partner reach every restaurant", () => {
    assert.equal(restaurantReachableForPartner({ partner_id: PARTNER_A }, null), true);
    assert.equal(restaurantReachableForPartner({ partner_id: null }, null), true);
  });
});
