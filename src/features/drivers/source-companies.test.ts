import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { guessColumnMapping } from "./import/parse";
import {
  companyKeyFromName,
  companyMatchesCategory,
  computeSourceCompanyIncentive,
  normalizeClientCode,
  parseDpdTarget,
  parseRateKwd,
  resolveCompanyInput,
  selectableCompanies,
  validateSourceCompanyScheme,
  type SourceCompany,
} from "./source-companies";

const company = (
  overrides: Partial<SourceCompany> = {},
): SourceCompany => ({
  key: "kn",
  name: "KN",
  client_code: null,
  is_active: true,
  is_system: false,
  sort_order: 1,
  dpd_target: null,
  incentive_enabled: false,
  incentive_above_kwd: null,
  incentive_below_kwd: null,
  effective_from: null,
  ...overrides,
});

const companies: SourceCompany[] = [
  { key: "mg", name: "MG", client_code: "CL-0001", is_active: true, is_system: true, sort_order: 0, dpd_target: null, incentive_enabled: false, incentive_above_kwd: null, incentive_below_kwd: null, effective_from: null },
  company({ key: "kn", name: "KN" }),
  company({ key: "brk", name: "Barakat", client_code: "CL-0009", is_active: false, sort_order: 2 }),
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

describe("computeSourceCompanyIncentive", () => {
  // Sadeeq scheme: target 15, above 0.100, below 0.350.
  const target = 15;
  const above = 0.1;
  const below = 0.35;

  it("matches the Excel Sadeeq rows", () => {
    assert.deepEqual(computeSourceCompanyIncentive(30, target, above, below), {
      incentiveKwd: 1.5,
      deductionKwd: 0,
      netKwd: 1.5,
    });
    assert.deepEqual(computeSourceCompanyIncentive(21, target, above, below), {
      incentiveKwd: 0.6,
      deductionKwd: 0,
      netKwd: 0.6,
    });
    assert.deepEqual(computeSourceCompanyIncentive(10, target, above, below), {
      incentiveKwd: 0,
      deductionKwd: 1.75,
      netKwd: -1.75,
    });
    assert.deepEqual(computeSourceCompanyIncentive(5, target, above, below), {
      incentiveKwd: 0,
      deductionKwd: 3.5,
      netKwd: -3.5,
    });
  });

  it("is zero at exactly the target", () => {
    assert.deepEqual(computeSourceCompanyIncentive(15, target, above, below), {
      incentiveKwd: 0,
      deductionKwd: 0,
      netKwd: 0,
    });
  });

  it("applies a full deduction at zero orders when the scheme is on", () => {
    assert.deepEqual(computeSourceCompanyIncentive(0, target, above, below), {
      incentiveKwd: 0,
      deductionKwd: 5.25,
      netKwd: -5.25,
    });
  });

  it("treats a negative order count as zero", () => {
    assert.deepEqual(computeSourceCompanyIncentive(-3, target, above, below), {
      incentiveKwd: 0,
      deductionKwd: 5.25,
      netKwd: -5.25,
    });
  });
});

describe("scheme parsers", () => {
  it("parses a positive integer DPD target, else null", () => {
    assert.equal(parseDpdTarget("15"), 15);
    assert.equal(parseDpdTarget(" 15 "), 15);
    assert.equal(parseDpdTarget(""), null);
    assert.equal(parseDpdTarget("0"), null);
    assert.equal(parseDpdTarget("-1"), null);
    assert.equal(parseDpdTarget("1.5"), null);
    assert.equal(parseDpdTarget("abc"), null);
  });

  it("parses a positive KWD rate, else null", () => {
    assert.equal(parseRateKwd("0.100"), 0.1);
    assert.equal(parseRateKwd("0.35"), 0.35);
    assert.equal(parseRateKwd(""), null);
    assert.equal(parseRateKwd("0"), null);
    assert.equal(parseRateKwd("-0.1"), null);
    assert.equal(parseRateKwd("abc"), null);
  });
});

describe("validateSourceCompanyScheme", () => {
  const base = {
    dpdTarget: "15",
    incentiveEnabled: true,
    aboveKwd: "0.100",
    belowKwd: "0.350",
    effectiveFrom: "2026-09-30",
  };

  it("accepts a complete scheme", () => {
    assert.equal(validateSourceCompanyScheme(base), null);
  });

  it("allows incentive off without rates or date", () => {
    assert.equal(
      validateSourceCompanyScheme({
        ...base,
        incentiveEnabled: false,
        aboveKwd: "",
        belowKwd: "",
        effectiveFrom: "",
      }),
      null,
    );
  });

  it("rejects a blank or non-integer DPD target", () => {
    assert.equal(validateSourceCompanyScheme({ ...base, dpdTarget: "" }), "invalid_dpd_target");
    assert.equal(validateSourceCompanyScheme({ ...base, dpdTarget: "1.5" }), "invalid_dpd_target");
  });

  it("rejects a missing rate when the scheme is on", () => {
    assert.equal(validateSourceCompanyScheme({ ...base, aboveKwd: "" }), "invalid_incentive_rate");
    assert.equal(validateSourceCompanyScheme({ ...base, belowKwd: "" }), "invalid_incentive_rate");
  });

  it("rejects a missing effective date when the scheme is on", () => {
    assert.equal(
      validateSourceCompanyScheme({ ...base, effectiveFrom: "" }),
      "incentive_effective_from_required",
    );
  });

  it("allows DPD-only (target + date, incentive off) and still rejects a bad target", () => {
    assert.equal(
      validateSourceCompanyScheme({
        ...base,
        incentiveEnabled: false,
        aboveKwd: "",
        belowKwd: "",
      }),
      null,
    );
    assert.equal(
      validateSourceCompanyScheme({
        ...base,
        incentiveEnabled: false,
        aboveKwd: "",
        belowKwd: "",
        dpdTarget: "0",
      }),
      "invalid_dpd_target",
    );
  });
});
