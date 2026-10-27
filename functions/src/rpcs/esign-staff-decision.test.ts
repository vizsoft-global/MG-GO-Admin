import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  managementDecisionLabel,
  parseEsignStaffDecision,
  signerNotifyCopy,
  signerNotifyKind,
} from "./esign-staff-decision";

describe("parseEsignStaffDecision", () => {
  it("accepts approved and rejected, including short verbs and case", () => {
    assert.equal(parseEsignStaffDecision("approved"), "approved");
    assert.equal(parseEsignStaffDecision("approve"), "approved");
    assert.equal(parseEsignStaffDecision("  APPROVED "), "approved");
    assert.equal(parseEsignStaffDecision("rejected"), "rejected");
    assert.equal(parseEsignStaffDecision("Reject"), "rejected");
  });

  it("returns null for anything that is not a decision", () => {
    assert.equal(parseEsignStaffDecision("signed"), null);
    assert.equal(parseEsignStaffDecision(""), null);
    assert.equal(parseEsignStaffDecision("   "), null);
    assert.equal(parseEsignStaffDecision(null), null);
    assert.equal(parseEsignStaffDecision(undefined), null);
  });
});

describe("managementDecisionLabel", () => {
  it("prints the sheet checkbox words", () => {
    assert.equal(managementDecisionLabel("approved"), "Approved");
    assert.equal(managementDecisionLabel("rejected"), "Rejected");
  });
});

describe("signerNotifyKind", () => {
  it("lets this decision win over a stored review", () => {
    assert.equal(signerNotifyKind("rejected", "approved"), "rejected");
    assert.equal(signerNotifyKind("approved", "rejected"), "approved");
  });

  it("falls back to the stored review when this submit is sign-only", () => {
    assert.equal(signerNotifyKind(null, "approved"), "approved");
    assert.equal(signerNotifyKind(null, "Reject"), "rejected");
  });

  it("stays signed when nobody has decided", () => {
    assert.equal(signerNotifyKind(null, null), "signed");
    assert.equal(signerNotifyKind(null, "pending"), "signed");
    assert.equal(signerNotifyKind(null, ""), "signed");
  });
});

describe("signerNotifyCopy", () => {
  it("names approval, rejection, and a plain signature", () => {
    assert.deepEqual(signerNotifyCopy("approved", "Loan Request"), {
      title: "Document approved",
      body: "Loan Request was approved by management",
    });
    assert.deepEqual(signerNotifyCopy("signed", "Loan Request"), {
      title: "Document signed",
      body: "Loan Request was signed by management",
    });
    assert.deepEqual(signerNotifyCopy("rejected", "Loan Request"), {
      title: "Document rejected",
      body: "Loan Request was rejected by management",
    });
    assert.deepEqual(signerNotifyCopy("rejected", "Loan Request", "  missing papers  "), {
      title: "Document rejected",
      body: "Loan Request was rejected by management: missing papers",
    });
  });
});
