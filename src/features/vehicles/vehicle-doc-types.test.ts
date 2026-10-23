import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isLegacyVehicleDocType,
  isVehicleDocType,
  LEGACY_VEHICLE_DOC_TYPES,
  VEHICLE_DOC_TYPE_VALUES,
} from "./vehicle-doc-types";

describe("vehicle document kinds", () => {
  it("allows only the three live kinds on a new upload", () => {
    assert.deepEqual([...VEHICLE_DOC_TYPE_VALUES], [
      "registration",
      "health_card",
      "baladiya_card",
    ]);
    assert.equal(isVehicleDocType("health_card"), true);
    assert.equal(isVehicleDocType("baladiya_card"), true);
    assert.equal(isVehicleDocType("registration"), true);
  });

  it("keeps the retired kinds readable but refuses them as new uploads", () => {
    assert.deepEqual([...LEGACY_VEHICLE_DOC_TYPES], ["insurance", "other"]);
    assert.equal(isLegacyVehicleDocType("insurance"), true);
    assert.equal(isLegacyVehicleDocType("other"), true);
    assert.equal(isLegacyVehicleDocType("registration"), false);
    assert.equal(isVehicleDocType("insurance"), false);
    assert.equal(isVehicleDocType("other"), false);
  });
});
