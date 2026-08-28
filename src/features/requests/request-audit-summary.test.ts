import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  describeRequestsAudit,
  isRequestsListScan,
} from "./request-audit-summary";

describe("isRequestsListScan", () => {
  it("drops All-Requests list reads so Details cannot echo This Month", () => {
    assert.equal(isRequestsListScan("requests.list"), true);
    assert.equal(isRequestsListScan("requests.detail"), false);
  });
});

describe("describeRequestsAudit", () => {
  it("names the request instead of leaving detail-reads blank", () => {
    assert.deepEqual(
      describeRequestsAudit({
        routeName: "requests.detail",
        context: { requestId: "44cdd153-80d5-4758-958f-d6523ea5908e" },
        changedFields: [],
        errorMessage: null,
        targetCode: "RCM-0055",
        targetType: "loan",
      }),
      { kind: "opened", code: "RCM-0055", type: "loan" },
    );
  });

  it("does not print the list date preset as the detail", () => {
    const detail = describeRequestsAudit({
      routeName: "requests.decide",
      context: { decideAction: "approve", status: "approved", preset: "this_month" },
      changedFields: [],
      errorMessage: null,
      targetCode: "RCM-0055",
      targetType: "loan",
    });
    assert.deepEqual(detail, {
      kind: "decided",
      code: "RCM-0055",
      type: "loan",
      action: "approve",
      status: "approved",
    });
  });

  it("lists the decision-term keys that used to be dropped as an object", () => {
    assert.deepEqual(
      describeRequestsAudit({
        routeName: "requests.decisionTerms",
        context: { terms: ["approved_amount", "deduction_start_date"] },
        changedFields: [],
        errorMessage: null,
        targetCode: "RCM-0047",
        targetType: "loan",
      }),
      {
        kind: "terms",
        code: "RCM-0047",
        fields: ["approved_amount", "deduction_start_date"],
      },
    );
  });
});
