import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pendingStaffSignerIds, SIGNER_STATUS_VOID } from "./esign-signer-void";

describe("pendingStaffSignerIds", () => {
  it("releases staff rows still waiting on a dead request", () => {
    assert.deepEqual(
      pendingStaffSignerIds([
        { id: "s1", data: { status: "pending", staff_user_id: "u1" } },
        { id: "s2", data: { status: "pending", staff_user_id: "u2" } },
      ]),
      ["s1", "s2"],
    );
  });

  it("leaves the rider row, signed rows and voids alone", () => {
    assert.deepEqual(
      pendingStaffSignerIds([
        // The rider's own row: no staff assignment.
        { id: "rider", data: { status: "pending", staff_user_id: null } },
        { id: "signed", data: { status: "signed", staff_user_id: "u1" } },
        { id: "declined", data: { status: "declined", staff_user_id: "u2" } },
        { id: "void", data: { status: SIGNER_STATUS_VOID, staff_user_id: "u3" } },
        { id: "blank", data: { status: "pending", staff_user_id: "   " } },
      ]),
      [],
    );
  });

  it("is stable for an empty request", () => {
    assert.deepEqual(pendingStaffSignerIds([]), []);
  });
});
