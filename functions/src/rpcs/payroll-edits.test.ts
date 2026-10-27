import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyPayrollManualOrders,
  applyPayrollStatusRoster,
  normalizePayrollStatusChoice,
  payrollOrderDateAllowed,
  type PayrollStatusRoster,
} from "./payroll-edits";

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

const emptyRoster = (): PayrollStatusRoster => ({ byDriver: {}, customs: [] });

describe("payroll rider status roster", () => {
  it("stores a core word as that core, even when the caller says custom", () => {
    assert.deepEqual(normalizePayrollStatusChoice({ key: "custom", label: "Absent" }), {
      key: "absent",
      label: "Absent",
    });
    assert.deepEqual(normalizePayrollStatusChoice({ key: "active_payroll", label: "Desk" }), {
      key: "active_payroll",
      label: "Active Payroll",
    });
    assert.deepEqual(normalizePayrollStatusChoice({ label: "Leave Return" }), {
      key: "leave_return",
      label: "Leave Return",
    });
    assert.deepEqual(normalizePayrollStatusChoice({ key: "new", label: "Desk" }), {
      key: "new",
      label: "New",
    });
  });

  it("keeps a custom label on the roster and does not duplicate it", () => {
    const first = applyPayrollStatusRoster(
      emptyRoster(),
      "d1",
      normalizePayrollStatusChoice({ label: "Night desk" }),
    );
    assert.deepEqual(first.customs, ["Night desk"]);
    const second = applyPayrollStatusRoster(
      first,
      "d2",
      normalizePayrollStatusChoice({ label: "night desk" }),
    );
    assert.deepEqual(second.customs, ["Night desk"]);
    assert.equal(second.byDriver.d2?.label, "night desk");
  });

  it("clears one rider and keeps the custom catalog", () => {
    const saved = applyPayrollStatusRoster(
      emptyRoster(),
      "d1",
      normalizePayrollStatusChoice({ label: "Night desk" }),
    );
    const cleared = applyPayrollStatusRoster(saved, "d1", null);
    assert.equal(cleared.byDriver.d1, undefined);
    assert.deepEqual(cleared.customs, ["Night desk"]);
  });

  it("refuses an empty label and stops the catalog at 40", () => {
    assert.throws(() => normalizePayrollStatusChoice({ label: "  " }), /invalid_status/);
    let roster = emptyRoster();
    for (let i = 0; i < 40; i += 1) {
      roster = applyPayrollStatusRoster(
        roster,
        `seed-${i}`,
        normalizePayrollStatusChoice({ label: `Desk ${i}` }),
      );
    }
    assert.equal(roster.customs.length, 40);
    const extra = applyPayrollStatusRoster(
      roster,
      "d-extra",
      normalizePayrollStatusChoice({ label: "One more" }),
    );
    assert.equal(extra.customs.length, 40);
    assert.equal(extra.byDriver["d-extra"]?.label, "One more");
  });
});
