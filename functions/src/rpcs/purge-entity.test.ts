import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canonicalPurgeEntity, purgeEntityOf } from "./purge";

describe("purgeEntityOf", () => {
  it("reads entity or p_entity and canonicalises", () => {
    assert.equal(purgeEntityOf({ entity: "vehicles" }), "vehicles");
    assert.equal(purgeEntityOf({ p_entity: "vehicles" }), "vehicles");
    assert.equal(purgeEntityOf({ p_entity: "delivery" }), "deliveries");
    assert.equal(purgeEntityOf({ entity: " driver ", p_entity: "zones" }), "drivers");
  });

  it("stays empty when neither key is a name, so unknown_entity still fires", () => {
    assert.equal(purgeEntityOf({}), "");
    assert.equal(purgeEntityOf({ entity: "   ", p_entity: "" }), "");
    assert.equal(canonicalPurgeEntity(""), "");
    assert.equal(purgeEntityOf({ p_entity: "not_a_module" }), "not_a_module");
  });
});
