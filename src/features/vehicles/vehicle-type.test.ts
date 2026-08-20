import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_VEHICLE_TYPE_KEY,
  vehicleSpriteKey,
  vehicleTypeFromDriverJoin,
} from "./vehicle-type";

describe("vehicleSpriteKey", () => {
  it("keeps car and falls back to bike", () => {
    assert.equal(vehicleSpriteKey("car"), "car");
    assert.equal(vehicleSpriteKey("bike"), "bike");
    assert.equal(vehicleSpriteKey("scooter"), DEFAULT_VEHICLE_TYPE_KEY);
    assert.equal(vehicleSpriteKey(null), DEFAULT_VEHICLE_TYPE_KEY);
  });
});

describe("vehicleTypeFromDriverJoin", () => {
  it("prefers the assigned vehicle over the driver fallback", () => {
    assert.equal(
      vehicleTypeFromDriverJoin({
        vehicle_type_key: "bike",
        vehicles: { vehicle_type_key: "car" },
      }),
      "car",
    );
    assert.equal(
      vehicleTypeFromDriverJoin({ vehicle_type_key: "car", vehicles: null }),
      "car",
    );
  });
});
