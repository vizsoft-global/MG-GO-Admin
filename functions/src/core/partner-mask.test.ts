import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { maskDriverForPartner } from "./partner-mask";

describe("maskDriverForPartner", () => {
  it("drops salary, bank, passcode, and internal notes", () => {
    const masked = maskDriverForPartner({
      id: "d1",
      full_name: "Sam",
      project_key: "keeta",
      civil_id: "visible",
      phone: "965000",
      passport_number: "P1",
      nationality: "IN",
      nationality_category_keys: "indian",
      source_company: "mg",
      company_name: "MG",
      sponsorship_key: "in_house",
      hiring_type: "direct",
      fixed_salary: 120,
      work_permit_salary: 90,
      app_passcode: "123456",
      bank_details: { iban: "KW00" },
      note_internal: "private",
      screenshots_allowed: true,
      frozen_from: "2026-01-01",
    });
    assert.equal(masked.full_name, "Sam");
    assert.equal(masked.project_key, "keeta");
    assert.equal(masked.civil_id, "visible");
    assert.equal("phone" in masked, false);
    assert.equal("passport_number" in masked, false);
    assert.equal("nationality" in masked, false);
    assert.equal("nationality_category_keys" in masked, false);
    assert.equal("source_company" in masked, false);
    assert.equal("company_name" in masked, false);
    assert.equal("sponsorship_key" in masked, false);
    assert.equal("hiring_type" in masked, false);
    assert.equal("fixed_salary" in masked, false);
    assert.equal("work_permit_salary" in masked, false);
    assert.equal("app_passcode" in masked, false);
    assert.equal("bank_details" in masked, false);
    assert.equal("note_internal" in masked, false);
    assert.equal("screenshots_allowed" in masked, false);
    assert.equal("frozen_from" in masked, false);
  });
});
