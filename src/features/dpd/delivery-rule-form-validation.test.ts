import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { defaultDeliveryRuleWindow } from "./delivery-rule-defaults";
import {
  deliveryRuleFieldForError,
  hasDeliveryRuleValidationErrors,
  validateDeliveryRuleForm,
  type ValidateDeliveryRuleFormInput,
} from "./delivery-rule-form-validation";

function input(over: Partial<ValidateDeliveryRuleFormInput> = {}): ValidateDeliveryRuleFormInput {
  return {
    name: "KFC daily",
    status: "active",
    scopeType: "restaurant",
    zoneIds: [],
    partnerIds: [],
    restaurantIds: ["r1"],
    startDate: "2026-10-22",
    endDate: "2027-10-22",
    dpdTarget: "20",
    dpdPeriod: "daily",
    priority: "",
    ...over,
  };
}

describe("delivery rule form validation", () => {
  it("accepts an active daily rule with a target", () => {
    const errors = validateDeliveryRuleForm(input());
    assert.equal(hasDeliveryRuleValidationErrors(errors), false);
  });

  it("requires a target on an active rule", () => {
    const errors = validateDeliveryRuleForm(input({ dpdTarget: "" }));
    assert.equal(errors.dpdTarget, "dpd_target_required");
    assert.equal(deliveryRuleFieldForError("dpd_target_required"), "dpdTarget");
  });

  it("refuses a weekly or monthly period once a target is set", () => {
    for (const dpdPeriod of ["weekly", "monthly"] as const) {
      const errors = validateDeliveryRuleForm(input({ dpdPeriod }));
      assert.equal(errors.dpdPeriod, "invalid_dpd_period");
      assert.equal(deliveryRuleFieldForError("invalid_dpd_period"), "dpdPeriod");
    }
    // A blank period reads as daily in the functions.
    assert.equal(
      validateDeliveryRuleForm(input({ dpdPeriod: "" })).dpdPeriod,
      undefined,
    );
  });

  it("leaves a draft free of target and period requirements", () => {
    for (const status of ["draft", "ended"] as const) {
      const errors = validateDeliveryRuleForm(
        input({ status, dpdTarget: "", dpdPeriod: "weekly" }),
      );
      assert.equal(errors.dpdTarget, undefined);
      assert.equal(errors.dpdPeriod, undefined);
    }
  });

  it("still names the generic target, date and scope mistakes", () => {
    assert.equal(validateDeliveryRuleForm(input({ dpdTarget: "0" })).dpdTarget, "invalid_target");
    assert.equal(
      validateDeliveryRuleForm(input({ startDate: "2026-10-22", endDate: "2026-10-01" })).endDate,
      "invalid_dates",
    );
    assert.equal(
      validateDeliveryRuleForm(input({ restaurantIds: [] })).scopeIds,
      "invalid_scope",
    );
  });
});

describe("new rule window defaults", () => {
  it("opens today and closes the same day next year", () => {
    assert.deepEqual(defaultDeliveryRuleWindow("2026-10-22"), {
      startDate: "2026-10-22",
      endDate: "2027-10-22",
    });
  });

  it("clamps 29 February to the next year's 28th", () => {
    assert.deepEqual(defaultDeliveryRuleWindow("2028-02-29"), {
      startDate: "2028-02-29",
      endDate: "2029-02-28",
    });
  });
});
