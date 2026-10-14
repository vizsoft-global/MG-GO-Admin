import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canSendEsignCategory,
  canViewIncomingType,
  esignGrantDocId,
  grantsKeyForEsign,
  hubReceiverBadge,
  hubSenderBadge,
  incomingTypesAllowed,
  normalizeEsignSenderKeys,
  outgoingCategoryVisible,
} from "./esign-staff-access";

describe("permissions Edit access + Assign Staff", () => {
  const loan = [{ categoryKey: "loan", accessLevel: "sender" as const }];
  const leave = [{ requestType: "leave", accessLevel: "approver" as const }];

  it("round-trips one outgoing category between the two UIs", () => {
    const fromEdit = loan;
    const fromAssign = normalizeEsignSenderKeys(["loan"]).map((categoryKey) => ({
      categoryKey,
      accessLevel: "sender" as const,
    }));
    assert.equal(grantsKeyForEsign(fromEdit), grantsKeyForEsign(fromAssign));
    assert.equal(esignGrantDocId("user-1", "loan"), "user-1_loan");
  });

  it("round-trips one incoming type between the two UIs", () => {
    assert.equal(canViewIncomingType("leave", leave, { isSuperAdmin: false, hasIncomingView: true }), true);
    assert.equal(canViewIncomingType("loan", leave, { isSuperAdmin: false, hasIncomingView: true }), false);
  });

  it("hides ungated outgoing tiles and refuses send", () => {
    const ctx = { isSuperAdmin: false, hasOutgoingManage: false };
    assert.equal(outgoingCategoryVisible("loan", loan, ctx), true);
    assert.equal(outgoingCategoryVisible("penalty", loan, ctx), false);
    assert.equal(canSendEsignCategory("penalty", loan, ctx), false);
    assert.equal(canSendEsignCategory("loan", loan, ctx), true);
  });

  it("shows a penalty child when the parent is granted", () => {
    const penalty = [{ categoryKey: "penalty", accessLevel: "sender" as const }];
    assert.equal(
      canSendEsignCategory("late_attendance", penalty, { isSuperAdmin: false, hasOutgoingManage: false }),
      true,
    );
  });

  it("legacy manage still sees every outgoing category", () => {
    assert.equal(
      canSendEsignCategory("payslip", [], { isSuperAdmin: false, hasOutgoingManage: true }),
      true,
    );
  });

  it("employeedesk.view only cannot send or list incoming types", () => {
    const out = { isSuperAdmin: false, hasOutgoingManage: false };
    const incoming = { isSuperAdmin: false, hasIncomingView: false };
    assert.equal(canSendEsignCategory("loan", [], out), false);
    assert.deepEqual(incomingTypesAllowed(["leave", "loan"], [], incoming), []);
    assert.equal(hubSenderBadge([], out), false);
    assert.equal(hubReceiverBadge([], incoming), false);
  });

  it("super admin bypasses both stores", () => {
    assert.equal(canSendEsignCategory("loan", [], { isSuperAdmin: true, hasOutgoingManage: false }), true);
    assert.equal(canViewIncomingType("leave", [], { isSuperAdmin: true, hasIncomingView: false }), true);
  });

  it("aligns hub other onto penalty_others in the store id", () => {
    assert.equal(esignGrantDocId("u1", "other"), "u1_penalty_others");
    assert.deepEqual(normalizeEsignSenderKeys(["other", "loan", "loan"]), ["loan", "penalty_others"]);
  });
});
