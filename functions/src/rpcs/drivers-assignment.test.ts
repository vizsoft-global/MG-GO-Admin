import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { intakeAssigned, restaurantIdsFromEdges } from "./drivers-assignment";

describe("drivers assignment", () => {
  it("merges unique restaurant ids from mixed edge collections", () => {
    assert.deepEqual(
      restaurantIdsFromEdges([
        { restaurant_id: "r1" },
        { restaurant_id: " r1 " },
        { restaurant_id: "r2" },
        { restaurant_id: "" },
        { restaurant_id: null },
        {},
      ]),
      ["r1", "r2"],
    );
  });

  it("assigns from a zone even with no restaurants", () => {
    assert.equal(intakeAssigned({ zoneId: "zone-1", restaurants: [] }), true);
    assert.equal(intakeAssigned({ zoneId: "  ", restaurants: [] }), false);
  });

  it("requires a published active restaurant when there is no zone", () => {
    assert.equal(intakeAssigned({ zoneId: null, restaurants: [] }), false);
    assert.equal(
      intakeAssigned({
        zoneId: null,
        restaurants: [{ exists: true, is_active: true, status: "draft" }],
      }),
      false,
    );
    assert.equal(
      intakeAssigned({
        zoneId: null,
        restaurants: [{ exists: true, is_active: false, status: "published" }],
      }),
      false,
    );
    assert.equal(
      intakeAssigned({
        zoneId: null,
        restaurants: [{ exists: false, is_active: true, status: "published" }],
      }),
      false,
    );
    assert.equal(
      intakeAssigned({
        zoneId: null,
        restaurants: [{ exists: true, is_active: true, status: "published" }],
      }),
      true,
    );
  });
});
