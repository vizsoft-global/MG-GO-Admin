import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { payrollAssignField, payrollPartnerLabel } from "./payroll-assign";

describe("payroll assign", () => {
  it("maps Client Name and Zone onto catalog fields", () => {
    assert.equal(payrollAssignField("partner"), "projectKey");
    assert.equal(payrollAssignField("zone"), "zoneId");
    assert.equal(payrollAssignField("amId"), null);
    assert.equal(payrollAssignField("restaurantId"), null);
    assert.equal(payrollAssignField("name"), null);
  });

  it("prints the catalog name, then Keeta or Americana", () => {
    assert.equal(payrollPartnerLabel("talabat", "Talabat Co"), "Talabat Co");
    assert.equal(payrollPartnerLabel("keeta", null), "Keeta");
    assert.equal(payrollPartnerLabel("americana", "  "), "Americana");
    assert.equal(payrollPartnerLabel(null, null), "—");
    assert.equal(payrollPartnerLabel("custom", null), "—");
  });
});
