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
    assert.equal(vehicleSpriteKey("van"), "car");
    assert.equal(vehicleSpriteKey("bike"), "bike");
    assert.equal(vehicleSpriteKey("scooter"), DEFAULT_VEHICLE_TYPE_KEY);
    assert.equal(vehicleSpriteKey(null), DEFAULT_VEHICLE_TYPE_KEY);
  });

  it("draws the bike sprite for a type the catalog added", () => {
    // Adding a type to `vehicle_types` must not need a new map sprite. Anything
    // the atlas does not know falls back to bike rather than drawing nothing.
    for (const key of ["truck", "cycle", "pickup", "forklift"]) {
      assert.equal(vehicleSpriteKey(key), DEFAULT_VEHICLE_TYPE_KEY, key);
    }
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
    assert.equal(
      vehicleTypeFromDriverJoin({ vehicle_type_key: "van", vehicles: null }),
      "car",
    );
  });
});
