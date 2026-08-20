import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  partnersLookupAoa,
  restaurantsLookupAoa,
  zonesLookupAoa,
} from "./lookups";

describe("lookup spreadsheets", () => {
  it("puts RST code and ID on restaurant rows so import can match", () => {
    const aoa = restaurantsLookupAoa([
      {
        name: "Crystal Tower",
        restaurant_code: "RST-0001",
        id: "77777777-7777-4777-8777-777777777777",
        partner_name: "Talabat",
        partner_id: "11111111-1111-4111-8111-111111111111",
        zone_name: "Hawalli",
        zone_code: "HAW",
        zone_id: "55555555-5555-4555-8555-555555555555",
        importable: true,
      },
    ]);
    assert.deepEqual(aoa[1], [
      "Crystal Tower",
      "RST-0001",
      "77777777-7777-4777-8777-777777777777",
      "Talabat",
      "11111111-1111-4111-8111-111111111111",
      "Hawalli",
      "HAW",
      "55555555-5555-4555-8555-555555555555",
      "Yes",
    ]);
  });

  it("exports zone name, code, and ID", () => {
    const aoa = zonesLookupAoa([
      { name: "Hawalli", code: "HAW", id: "55555555-5555-4555-8555-555555555555" },
    ]);
    assert.deepEqual(aoa[1], ["Hawalli", "HAW", "55555555-5555-4555-8555-555555555555"]);
  });

  it("exports partner name and ID", () => {
    const aoa = partnersLookupAoa([
      { name: "Talabat", id: "11111111-1111-4111-8111-111111111111" },
    ]);
    assert.deepEqual(aoa[1], ["Talabat", "11111111-1111-4111-8111-111111111111"]);
  });
});
