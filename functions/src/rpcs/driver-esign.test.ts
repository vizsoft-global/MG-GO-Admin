import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  awaitingCounterSignature,
  counterSignatureState,
  declarationAccepted,
  esignListStatus,
  esignRecipientStage,
  parseAppointmentAction,
} from "./driver-esign";

describe("esignListStatus", () => {
  it("remaps overdue pending rows to expired", () => {
    assert.equal(esignListStatus("pending", "2026-10-01", "2026-10-09"), "expired");
    assert.equal(esignListStatus("pending", "2026-10-09", "2026-10-09"), "pending");
    assert.equal(esignListStatus("signed", "2026-10-01", "2026-10-09"), "signed");
  });
});

describe("esignRecipientStage", () => {
  it("follows the SQL CASE", () => {
    assert.equal(esignRecipientStage("signed", null, null, "2026-10-09"), "signed");
    assert.equal(esignRecipientStage("pending", "2026-10-01", null, "2026-10-09"), "expired");
    assert.equal(esignRecipientStage("pending", null, "2026-10-08T10:00:00Z", "2026-10-09"), "opened");
    assert.equal(esignRecipientStage("pending", null, null, "2026-10-09"), "not_opened");
  });
});

describe("declarationAccepted", () => {
  it("is the declaration_required gate", () => {
    assert.equal(declarationAccepted({}), false);
    assert.equal(declarationAccepted({ declaration_accepted: false }), false);
    assert.equal(declarationAccepted({ declaration_accepted: true }), true);
  });
});

describe("counter signature helpers", () => {
  it("awaiting is signed + pending staff row", () => {
    assert.equal(awaitingCounterSignature("signed", ["pending"]), true);
    assert.equal(awaitingCounterSignature("signed", ["signed"]), false);
    assert.equal(awaitingCounterSignature("pending", ["pending"]), false);
    assert.equal(counterSignatureState([]), "none");
    assert.equal(counterSignatureState(["declined"]), "declined");
    assert.equal(counterSignatureState(["pending"]), "pending");
    assert.equal(counterSignatureState(["signed"]), "signed");
  });
});

describe("parseAppointmentAction", () => {
  it("accepts accept / reject / propose only", () => {
    assert.equal(parseAppointmentAction("Accept"), "accept");
    assert.equal(parseAppointmentAction("propose"), "propose");
    assert.equal(parseAppointmentAction("nope"), null);
  });
});
