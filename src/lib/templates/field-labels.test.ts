import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CANONICAL_FIELDS,
  canonicalHeaderRow,
  canonicalLabel,
  labelForKey,
  matchCanonicalKey,
} from "./field-labels";

describe("canonical field catalogue", () => {
  it("has a unique key per field and both locales filled", () => {
    const keys = new Set(CANONICAL_FIELDS.map((f) => f.key));
    assert.equal(keys.size, CANONICAL_FIELDS.length);
    for (const field of CANONICAL_FIELDS) {
      assert.ok(field.en.length > 0, `${field.key} needs an English label`);
      assert.ok(field.ar.length > 0, `${field.key} needs an Arabic label`);
    }
  });

  it("returns the label in the requested locale", () => {
    assert.equal(canonicalLabel("employee_code", "en"), "Employee Code");
    assert.equal(canonicalLabel("employee_code", "ar"), "كود الموظف");
    assert.equal(canonicalLabel("joining_date"), "Joining Date");
  });

  it("matches the canonical English and Arabic headers", () => {
    assert.equal(matchCanonicalKey("Employee Code"), "employee_code");
    assert.equal(matchCanonicalKey("employee code"), "employee_code");
    assert.equal(matchCanonicalKey("كود الموظف"), "employee_code");
    assert.equal(matchCanonicalKey("Company Name"), "company_name");
    assert.equal(matchCanonicalKey("Joining Date"), "joining_date");
  });

  it("still accepts legacy aliases so older sheets keep importing", () => {
    assert.equal(matchCanonicalKey("MG ID"), "employee_code");
    assert.equal(matchCanonicalKey("Driver ID"), "employee_code");
    assert.equal(matchCanonicalKey("Full Name"), "employee_name");
    assert.equal(matchCanonicalKey("Driver Name"), "employee_name");
    assert.equal(matchCanonicalKey("Platform"), "company_name");
    assert.equal(matchCanonicalKey("Job Title"), "position");
    assert.equal(matchCanonicalKey("Start Date"), "joining_date");
  });

  it("normalizes punctuation and stray whitespace", () => {
    assert.equal(matchCanonicalKey("  full   name  "), "employee_name");
    assert.equal(matchCanonicalKey("employee_id"), "employee_code");
  });

  it("returns null for a header that is not personal information", () => {
    assert.equal(matchCanonicalKey("Restaurant IDs"), null);
    assert.equal(matchCanonicalKey(""), null);
    assert.equal(matchCanonicalKey("Zone"), null);
  });

  it("builds a header row from keys", () => {
    assert.deepEqual(
      canonicalHeaderRow(["employee_code", "employee_name", "joining_date"]),
      ["Employee Code", "Employee Name", "Joining Date"],
    );
    assert.deepEqual(canonicalHeaderRow(["date"], "ar"), ["التاريخ"]);
  });

  describe("labelForKey", () => {
    it("resolves a stored snake_case key to the canonical label", () => {
      // The reason this function exists: a stored key is not a header, so the
      // input matcher misses it and the field would print de-snaked.
      assert.equal(labelForKey("employee_name"), "Employee Name");
      assert.equal(labelForKey("employee_code"), "Employee Code");
      assert.equal(labelForKey("company_name"), "Company Name");
      assert.equal(labelForKey("joining_date"), "Joining Date");
    });

    it("resolves the Arabic label in the Arabic locale", () => {
      assert.equal(labelForKey("employee_code", "ar"), "كود الموظف");
      assert.equal(labelForKey("employee name", "ar"), "اسم الموظف");
    });

    it("accepts a header spelling as well as a key", () => {
      assert.equal(labelForKey("MG ID"), "Employee Code");
      assert.equal(labelForKey("Job Title"), "Position");
    });

    it("humanises a key the catalogue has never heard of", () => {
      // A template may carry its own column, and a blank label is worse than an
      // imperfect one.
      assert.equal(labelForKey("uniform_size"), "Uniform size");
      assert.equal(labelForKey("shift-start"), "Shift start");
    });

    it("returns the input unchanged when there is nothing to humanise", () => {
      assert.equal(labelForKey("   "), "   ");
    });
  });
});
