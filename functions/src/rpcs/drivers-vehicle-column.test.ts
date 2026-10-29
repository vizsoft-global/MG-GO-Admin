import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { vehicleListValue } from "./drivers";

/**
 * The Employees list keeps its own copy of "what the Vehicle column shows",
 * because the column is filtered, grouped and sorted on the server. It used to
 * collapse every type that was not a car into `bike`, which made a type added
 * to the catalog unfilterable and printed the wrong word.
 */
describe("vehicleListValue", () => {
  it("returns the stored catalog key unchanged", () => {
    assert.equal(vehicleListValue({ vehicle_type_key: "car" }), "car");
    assert.equal(vehicleListValue({ vehicle_type_key: "bike" }), "bike");
    assert.equal(vehicleListValue({ vehicle_type_key: "van" }), "van");
    assert.equal(vehicleListValue({ vehicle_type_key: "truck" }), "truck");
  });

  it("prints nothing when the rider has neither a type nor a plate", () => {
    assert.equal(vehicleListValue({}), "");
    assert.equal(vehicleListValue({ vehicle_type_key: null, vehicle_label: null }), "");
  });

  it("keeps bike for a plate with no stored type", () => {
    // A plate assigned before the catalog existed has no type. The sprite
    // default is bike, so the column and the map agree.
    assert.equal(vehicleListValue({ vehicle_label: "12345" }), "bike");
  });
});
