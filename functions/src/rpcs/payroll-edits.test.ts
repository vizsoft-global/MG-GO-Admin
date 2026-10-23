import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyPayrollManualOrders, payrollOrderDateAllowed } from "./payroll-edits";

describe("applyPayrollManualOrders", () => {
  it("lets a manual 0 replace recon and verified", () => {
    assert.deepEqual(applyPayrollManualOrders(0, 12, 4), {
      orders: 0,
      displayOrders: 0,
      overridden: true,
    });
  });

  it("falls through when there is no override", () => {
    assert.deepEqual(applyPayrollManualOrders(null, 12, 4), {
      orders: 12,
      displayOrders: 12,
      overridden: false,
    });
    assert.deepEqual(applyPayrollManualOrders(null, null, 4), {
      orders: 0,
      displayOrders: 4,
      overridden: false,
    });
  });
});

describe("payrollOrderDateAllowed", () => {
  it("keeps the current month and the previous two, through today", () => {
    assert.equal(payrollOrderDateAllowed("2026-08-01", "2026-10-23"), true);
    assert.equal(payrollOrderDateAllowed("2026-07-31", "2026-10-23"), false);
    assert.equal(payrollOrderDateAllowed("2026-10-23", "2026-10-23"), true);
    assert.equal(payrollOrderDateAllowed("2026-10-24", "2026-10-23"), false);
    assert.equal(payrollOrderDateAllowed("not-a-day", "2026-10-23"), false);
  });
});
