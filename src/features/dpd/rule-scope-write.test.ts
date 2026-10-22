import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ruleScopeWrite } from "./rule-scope-write";

describe("rule scope write", () => {
  it("writes the legacy single-FK column and one junction row per id", () => {
    const write = ruleScopeWrite("restaurant", ["r1", "r2"]);
    assert.equal(write.legacyId, "r1");
    assert.deepEqual(write.legacyColumns, {
      zone_id: null,
      partner_id: null,
      restaurant_id: "r1",
    });
    assert.deepEqual(write.rows, [
      { zone_id: null, partner_id: null, restaurant_id: "r1" },
      { zone_id: null, partner_id: null, restaurant_id: "r2" },
    ]);
  });

  it("keeps a zone rule's id in zone_id only", () => {
    const write = ruleScopeWrite("zone", ["z1", "z2"]);
    assert.deepEqual(write.legacyColumns, {
      zone_id: "z1",
      partner_id: null,
      restaurant_id: null,
    });
    assert.deepEqual(write.rows, [
      { zone_id: "z1", partner_id: null, restaurant_id: null },
      { zone_id: "z2", partner_id: null, restaurant_id: null },
    ]);
  });

  it("keeps a partner rule's id in partner_id only", () => {
    const write = ruleScopeWrite("partner", ["p1"]);
    assert.deepEqual(write.legacyColumns, {
      zone_id: null,
      partner_id: "p1",
      restaurant_id: null,
    });
    assert.deepEqual(write.rows, [{ zone_id: null, partner_id: "p1", restaurant_id: null }]);
  });

  it("trims, de-duplicates and drops blank ids", () => {
    const write = ruleScopeWrite("restaurant", [" r1 ", "r1", "", "  ", "r2"]);
    assert.equal(write.legacyId, "r1");
    assert.deepEqual(
      write.rows.map((row) => row.restaurant_id),
      ["r1", "r2"],
    );
  });

  it("writes nothing for an empty selection", () => {
    const write = ruleScopeWrite("restaurant", []);
    assert.equal(write.legacyId, null);
    assert.deepEqual(write.legacyColumns, {
      zone_id: null,
      partner_id: null,
      restaurant_id: null,
    });
    assert.deepEqual(write.rows, []);
  });
});
