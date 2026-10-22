import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  companyConfigApplies,
  companySchemeGoverns,
  ruleMatchesScope,
  ruleScopeRows,
  type RuleScope,
  type ScopedRule,
  type SourceCompanyConfig,
} from "./incentive";

const NONE: readonly RuleScope[] = [];

function scope(over: Partial<RuleScope>): RuleScope {
  return { zone_id: null, partner_id: null, restaurant_id: null, ...over };
}

function rule(over: Partial<ScopedRule>): ScopedRule {
  return {
    scope_type: "restaurant",
    zone_id: null,
    partner_id: null,
    restaurant_id: null,
    ...over,
  };
}

const rider = {
  zone_id: "z1",
  partner_id: "p1",
  restaurant_id: "r1",
};

describe("canonical rule scope matcher", () => {
  it("reads the legacy single-FK column", () => {
    assert.equal(ruleMatchesScope(rule({ restaurant_id: "r1" }), NONE, rider), true);
    assert.equal(ruleMatchesScope(rule({ restaurant_id: "r2" }), NONE, rider), false);
  });

  it("reads junction rows too", () => {
    const scopes = [scope({ restaurant_id: "r1" })];
    assert.equal(ruleMatchesScope(rule({}), scopes, rider), true);
    assert.equal(
      ruleMatchesScope(rule({}), [scope({ restaurant_id: "r2" })], rider),
      false,
    );
  });

  it("unions legacy and junction rows instead of picking one", () => {
    const scopes = [scope({ restaurant_id: "r2" }), scope({ restaurant_id: "r1" })];
    assert.equal(ruleMatchesScope(rule({ restaurant_id: "r1" }), scopes, rider), true);
    assert.equal(ruleMatchesScope(rule({ restaurant_id: "r3" }), scopes, rider), true);
  });

  it("matches a zone or partner rule through either source", () => {
    assert.equal(
      ruleMatchesScope(rule({ scope_type: "zone", zone_id: "z1" }), NONE, rider),
      true,
    );
    assert.equal(
      ruleMatchesScope(rule({ scope_type: "zone" }), [scope({ zone_id: "z1" })], rider),
      true,
    );
    assert.equal(
      ruleMatchesScope(rule({ scope_type: "zone" }), [scope({ zone_id: "z2" })], rider),
      false,
    );
    assert.equal(
      ruleMatchesScope(rule({ scope_type: "partner", partner_id: "p1" }), NONE, rider),
      true,
    );
    assert.equal(
      ruleMatchesScope(rule({ scope_type: "partner" }), [scope({ partner_id: "p1" })], rider),
      true,
    );
    assert.equal(
      ruleMatchesScope(rule({ scope_type: "partner" }), [scope({ partner_id: "p2" })], rider),
      false,
    );
  });

  it("never matches a blank id on either side", () => {
    assert.equal(
      ruleMatchesScope(rule({ restaurant_id: null }), [scope({ restaurant_id: null })], rider),
      false,
    );
    assert.equal(
      ruleMatchesScope(rule({ restaurant_id: "r1" }), NONE, {
        zone_id: null,
        partner_id: null,
        restaurant_id: null,
      }),
      false,
    );
  });

  it("projects legacy ids into scope rows for labels", () => {
    assert.deepEqual(ruleScopeRows(rule({ restaurant_id: "r1" }), NONE), [
      scope({ restaurant_id: "r1" }),
    ]);
    assert.deepEqual(ruleScopeRows(rule({ scope_type: "zone", zone_id: "z1" }), NONE), [
      scope({ zone_id: "z1" }),
    ]);
    assert.deepEqual(ruleScopeRows(rule({ scope_type: "partner", partner_id: "p1" }), NONE), [
      scope({ partner_id: "p1" }),
    ]);
    // The id belongs to another scope type, so it is not a scope row at all.
    assert.deepEqual(ruleScopeRows(rule({ scope_type: "zone", restaurant_id: "r1" }), NONE), []);
    assert.deepEqual(ruleScopeRows(rule({}), [scope({ restaurant_id: "r1" })]), [
      scope({ restaurant_id: "r1" }),
    ]);
  });
});

const company = (over: Partial<SourceCompanyConfig> = {}): SourceCompanyConfig => ({
  key: "sadeeq",
  name: "Sadeeq",
  incentive_enabled: true,
  dpd_target: 15,
  incentive_above_kwd: 0.1,
  incentive_below_kwd: 0.35,
  effective_from: "2026-09-30",
  ...over,
});

describe("company scheme gate", () => {
  it("governs only an outsourced, live, enabled scheme with a target", () => {
    const args = { riderCategory: "outsourced", company: company(), onDate: "2026-10-16" };
    assert.equal(companyConfigApplies(args), true);
    assert.equal(companySchemeGoverns(args), true);
  });

  it("stays out of the way when the company cannot pay", () => {
    const onDate = "2026-10-16";
    assert.equal(
      companySchemeGoverns({
        riderCategory: "outsourced",
        company: company({ incentive_enabled: false }),
        onDate,
      }),
      false,
    );
    assert.equal(
      companySchemeGoverns({
        riderCategory: "outsourced",
        company: company({ dpd_target: 0 }),
        onDate,
      }),
      false,
    );
    assert.equal(
      companySchemeGoverns({
        riderCategory: "outsourced",
        company: company({ dpd_target: null }),
        onDate,
      }),
      false,
    );
    // An outsourced rider whose company is still staged keeps the rules.
    assert.equal(
      companySchemeGoverns({
        riderCategory: "outsourced",
        company: company({ effective_from: null }),
        onDate,
      }),
      false,
    );
    assert.equal(
      companySchemeGoverns({
        riderCategory: "outsourced",
        company: company({ effective_from: "2026-11-01" }),
        onDate,
      }),
      false,
    );
    // In-house riders are never priced by a company scheme.
    assert.equal(
      companySchemeGoverns({ riderCategory: "in_house", company: company(), onDate }),
      false,
    );
    assert.equal(companySchemeGoverns({ riderCategory: null, company: company(), onDate }), false);
    assert.equal(companySchemeGoverns({ riderCategory: "outsourced", company: null, onDate }), false);
  });
});
