import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { companyKeyFromLabel, companyLabel, COMPANY_KEY_RE } from "./vehicle-companies";

describe("vehicle companies", () => {
  it("derives a stable key from a label", () => {
    assert.equal(companyKeyFromLabel("Honda Motor"), "honda_motor");
    assert.equal(companyKeyFromLabel("  Toyota  "), "toyota");
    assert.equal(companyKeyFromLabel("Yamaha-Motors"), "yamaha_motors");
  });

  it("accepts only the short key shape", () => {
    assert.equal(COMPANY_KEY_RE.test("honda"), true);
    assert.equal(COMPANY_KEY_RE.test("honda_motor"), true);
    assert.equal(COMPANY_KEY_RE.test("Honda Motor"), false);
    assert.equal(COMPANY_KEY_RE.test(""), false);
  });

  it("prefers the Arabic label when the locale is Arabic", () => {
    const companies = [
      { key: "honda", label_en: "Honda", label_ar: "هوندا", is_active: true, sort_order: 1 },
    ];
    assert.equal(companyLabel("honda", companies, "ar"), "هوندا");
    assert.equal(companyLabel("honda", companies, "en"), "Honda");
    assert.equal(companyLabel("missing", companies, "en"), "missing");
    assert.equal(companyLabel(null, companies, "en"), "—");
  });
});
