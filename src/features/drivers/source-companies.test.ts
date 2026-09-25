import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { guessColumnMapping } from "./import/parse";
import {
  companyKeyFromName,
  companyMatchesCategory,
  normalizeClientCode,
  resolveCompanyInput,
  selectableCompanies,
  type SourceCompany,
} from "./source-companies";

const companies: SourceCompany[] = [
  { key: "mg", name: "MG", client_code: "CL-0001", is_active: true, is_system: true, sort_order: 0 },
  { key: "kn", name: "KN", client_code: null, is_active: true, is_system: false, sort_order: 1 },
  { key: "brk", name: "Barakat", client_code: "CL-0009", is_active: false, is_system: false, sort_order: 2 },
];

describe("resolveCompanyInput", () => {
  it("matches key, name or Client ID case-insensitively", () => {
    assert.equal(resolveCompanyInput("mg", companies), "mg");
    assert.equal(resolveCompanyInput(" Mg ", companies), "mg");
    assert.equal(resolveCompanyInput("cl-0001", companies), "mg");
    assert.equal(resolveCompanyInput("KN", companies), "kn");
  });

  it("treats blank as no company and unknown or inactive as invalid", () => {
    assert.equal(resolveCompanyInput("", companies), null);
    assert.equal(resolveCompanyInput(null, companies), null);
    assert.equal(resolveCompanyInput("Nope", companies), "invalid");
    assert.equal(resolveCompanyInput("Barakat", companies), "invalid");
  });
});

describe("companyMatchesCategory", () => {
  it("pins in-house to the system company and outsourced to partners", () => {
    assert.equal(companyMatchesCategory("in_house", "mg", companies), true);
    assert.equal(companyMatchesCategory("in_house", "kn", companies), false);
    assert.equal(companyMatchesCategory("outsourced", "kn", companies), true);
    assert.equal(companyMatchesCategory("outsourced", "mg", companies), false);
    assert.equal(companyMatchesCategory("outsourced", null, companies), true);
    assert.equal(companyMatchesCategory("outsourced", "ghost", companies), false);
  });
});

describe("selectableCompanies", () => {
  it("hides inactive companies unless already selected", () => {
    assert.deepEqual(selectableCompanies("outsourced", companies, null).map((c) => c.key), ["kn"]);
    assert.deepEqual(
      selectableCompanies("outsourced", companies, "brk").map((c) => c.key),
      ["kn", "brk"],
    );
    assert.deepEqual(selectableCompanies("in_house", companies, null).map((c) => c.key), ["mg"]);
  });
});

describe("key and code normalisation", () => {
  it("derives a slug key and upper-cases the client code", () => {
    assert.equal(companyKeyFromName("Al Sadeeq Co."), "al_sadeeq_co");
    assert.equal(normalizeClientCode(" cl-0002 "), "CL-0002");
    assert.equal(normalizeClientCode("  "), null);
  });
});

describe("SOP import headers", () => {
  it("maps MG ID, Company Name, Platform ID and Platform to distinct fields", () => {
    const mapping = guessColumnMapping(["Full Name", "MG ID", "Company Name", "Platform ID", "Platform"]);
    assert.equal(mapping.full_name, "Full Name");
    assert.equal(mapping.employee_id, "MG ID");
    assert.equal(mapping.source_company, "Company Name");
    assert.equal(mapping.client_id, "Platform ID");
    assert.equal(mapping.client_name, "Platform");
  });

  it("still accepts the legacy Employee ID / Client headers", () => {
    const mapping = guessColumnMapping(["Full Name", "Employee ID", "Client ID", "Client Name"]);
    assert.equal(mapping.employee_id, "Employee ID");
    assert.equal(mapping.client_id, "Client ID");
    assert.equal(mapping.client_name, "Client Name");
    assert.equal(mapping.source_company, undefined);
  });
});
