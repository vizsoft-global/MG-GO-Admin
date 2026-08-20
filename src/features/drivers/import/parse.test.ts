import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { guessColumnMapping, mapRowsFromSheet, parseRiderCategory } from "./parse";

describe("parseRiderCategory", () => {
  it("defaults blank to null so preview can apply in_house", () => {
    assert.equal(parseRiderCategory(""), null);
    assert.equal(parseRiderCategory("in_house"), "in_house");
    assert.equal(parseRiderCategory("In House"), "in_house");
    assert.equal(parseRiderCategory("outsourced"), "outsourced");
    assert.equal(parseRiderCategory("vendor"), "invalid");
  });
});

describe("guessColumnMapping", () => {
  it("maps human-readable partner/zone/restaurant headers", () => {
    const mapping = guessColumnMapping([
      "Full Name",
      "Phone (+965)",
      "Partner",
      "Zone",
      "Restaurant IDs (name, RST code, or UUID)",
      "Nationality",
      "Rider Category",
    ]);
    assert.equal(mapping.partner_id, "Partner");
    assert.equal(mapping.zone_id, "Zone");
    assert.equal(mapping.restaurant_ids, "Restaurant IDs (name, RST code, or UUID)");
    assert.equal(mapping.nationality, "Nationality");
    assert.equal(mapping.rider_category, "Rider Category");
  });
});

describe("mapRowsFromSheet", () => {
  it("keeps +965 phones as the local number after normalize", () => {
    const rows = mapRowsFromSheet(
      ["Full Name", "Phone (+965)", "Civil ID", "Employee ID"],
      [["Ahmed", "+96599123456", "281010100001", "12345"]],
      {
        full_name: "Full Name",
        phone: "Phone (+965)",
        civil_id: "Civil ID",
        employee_id: "Employee ID",
      },
    );
    assert.equal(rows[0]?.phone, "+96599123456");
  });
});
