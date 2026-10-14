import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  counterSignatureState,
  isAwaitingCounterSignature,
  isEsignStaffSignerRole,
  previewStaffLabel,
} from "./esign-signers";

describe("esign staff signers", () => {
  it("only countersigner/manager/witness are staff roles", () => {
    assert.equal(isEsignStaffSignerRole("countersigner"), true);
    assert.equal(isEsignStaffSignerRole("manager"), true);
    assert.equal(isEsignStaffSignerRole("witness"), true);
    assert.equal(isEsignStaffSignerRole("employee"), false);
    assert.equal(isEsignStaffSignerRole("signer"), false);
  });

  it("awaiting counter-signature is signed + pending staff only", () => {
    assert.equal(
      isAwaitingCounterSignature({ requestStatus: "signed", hasPendingStaffSigner: true }),
      true,
    );
    assert.equal(
      isAwaitingCounterSignature({ requestStatus: "pending", hasPendingStaffSigner: true }),
      false,
    );
    assert.equal(
      isAwaitingCounterSignature({ requestStatus: "signed", hasPendingStaffSigner: false }),
      false,
    );
  });

  it("counter-signature state prefers declined then pending", () => {
    assert.equal(counterSignatureState([]), "none");
    assert.equal(counterSignatureState(["pending"]), "pending");
    assert.equal(counterSignatureState(["signed", "pending"]), "pending");
    assert.equal(counterSignatureState(["signed", "declined"]), "declined");
    assert.equal(counterSignatureState(["signed", "signed"]), "signed");
  });

  it("preview staff label prefers a draft name, then the pick, then the fallback", () => {
    assert.equal(previewStaffLabel([{ display_name: "  Sara  " }], "Ali", "HR signature"), "Sara");
    assert.equal(previewStaffLabel([{ display_name: "   " }], "Ali", "HR signature"), "Ali");
    assert.equal(previewStaffLabel([], "", "HR signature"), "HR signature");
  });
});
