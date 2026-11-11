import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HR_CATALOG_CELLS, HR_DATE_CELLS, masterFilterValues } from "./hr-inline-cells";

describe("HR_CATALOG_CELLS", () => {
  it("covers every column the sheet made editable from a master", () => {
    assert.deepEqual(Object.keys(HR_CATALOG_CELLS).sort(), [
      "company",
      "hiring",
      "natCat",
      "nationality",
      "position",
      "rest",
      "section",
      "sponsor",
    ]);
  });

  it("binds each column to a different stored key", () => {
    // Two columns sharing one field would mean one of them silently overwrites
    // the other — a mistake only visible as "my edit keeps disappearing".
    const fields = Object.values(HR_CATALOG_CELLS).map((spec) => spec.field);
    assert.equal(new Set(fields).size, fields.length);
  });

  it("reads the stored key, never the printed label", () => {
    const row = {
      nationalityCode: "IN",
      nationalityCategoryKeys: ["asian"],
      nationalityCategoryKey: "asian",
      restaurantId: "rest-1",
      sponsorKey: "al_musallam",
      sectionKey: "ops",
      positionKey: "rider",
      companyKey: "mg",
      hiringType: "overseas",
      cells: { nationality: "India", natCat: "Asian", rest: "KFC", sponsor: "Al Musallam", hiring: "Overseas" },
    } as never;
    assert.equal(HR_CATALOG_CELLS.nationality.valueOf(row), "IN");
    assert.equal(HR_CATALOG_CELLS.natCat.valueOf(row), "asian");
    assert.equal(HR_CATALOG_CELLS.rest.valueOf(row), "rest-1");
    assert.equal(HR_CATALOG_CELLS.sponsor.valueOf(row), "al_musallam");
    assert.equal(HR_CATALOG_CELLS.hiring.valueOf(row), "overseas");
    assert.equal(HR_CATALOG_CELLS.section.valueOf(row), "ops");
  });

  it("sends each column to its own master", () => {
    assert.equal(HR_CATALOG_CELLS.nationality.optionsKey, "nationalities");
    assert.equal(HR_CATALOG_CELLS.natCat.optionsKey, "nationalityCategories");
    assert.equal(HR_CATALOG_CELLS.rest.optionsKey, "restaurants");
    assert.equal(HR_CATALOG_CELLS.sponsor.optionsKey, "sponsorships");
    assert.equal(HR_CATALOG_CELLS.section.optionsKey, "sections");
    assert.equal(HR_CATALOG_CELLS.position.optionsKey, "positions");
    assert.equal(HR_CATALOG_CELLS.company.optionsKey, "companies");
    assert.equal(HR_CATALOG_CELLS.hiring.optionsKey, "hiringTypes");
  });
});

describe("HR_DATE_CELLS", () => {
  it("maps the column ids the sheet uses onto the fields it writes", () => {
    assert.equal(HR_DATE_CELLS.start, "workStartDate");
    assert.equal(HR_DATE_CELLS.endDate, "jobEndDate");
  });
});

describe("masterFilterValues", () => {
  it("puts what the sheet holds first, then the rest of the master", () => {
    assert.deepEqual(masterFilterValues(["KFC", "Pizza Hut"], ["Pizza Hut", "Burger King"]), [
      "KFC",
      "Pizza Hut",
      "Burger King",
    ]);
  });

  it("offers a value added to the master before anyone carries it", () => {
    // The sync requirement: a new restaurant is pickable on the filter at once.
    assert.deepEqual(masterFilterValues([], ["New Place"]), ["New Place"]);
  });

  it("drops the dashes the sheet prints for an empty cell", () => {
    assert.deepEqual(masterFilterValues(["—", "KFC"], ["—"]), ["KFC"]);
  });

  it("trims, dedupes case-sensitively and keeps order stable", () => {
    assert.deepEqual(masterFilterValues([" KFC ", "KFC"], ["KFC", "kfc"]), ["KFC", "kfc"]);
  });

  it("returns nothing when both sides are empty", () => {
    assert.deepEqual(masterFilterValues([], []), []);
  });
});
