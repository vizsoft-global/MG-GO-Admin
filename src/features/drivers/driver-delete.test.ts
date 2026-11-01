import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  conflictDetailHref,
  conflictStateKey,
  deleteConfirmationMatches,
  type IdentityConflict,
} from "./driver-delete";

const conflict = (over: Partial<IdentityConflict> = {}): IdentityConflict => ({
  field: "employee_id",
  kind: "intake",
  id: "intake-1",
  intakeId: "intake-1",
  driverId: null,
  name: "Test Rider",
  employeeId: "1344",
  phone: "+96590000099",
  state: "not_approved",
  ...over,
});

describe("driver delete confirmation", () => {
  it("needs the MG ID typed back in full", () => {
    assert.equal(deleteConfirmationMatches("1344", "1344"), true);
    assert.equal(deleteConfirmationMatches("  1344  ", "1344"), true);
    assert.equal(deleteConfirmationMatches("1345", "1344"), false);
    assert.equal(deleteConfirmationMatches("134", "1344"), false);
    assert.equal(deleteConfirmationMatches("", "1344"), false);
  });

  it("is case-insensitive, because an MG ID can arrive as emp2049", () => {
    assert.equal(deleteConfirmationMatches("emp2049", "EMP2049"), true);
    assert.equal(deleteConfirmationMatches("EMP2049", "emp2049"), true);
  });

  it("refuses when the record has no MG ID to confirm", () => {
    assert.equal(deleteConfirmationMatches("anything", null), false);
    assert.equal(deleteConfirmationMatches("anything", ""), false);
    assert.equal(deleteConfirmationMatches("", undefined), false);
  });
});

describe("identity conflict", () => {
  it("links an unfinished profile on its own id", () => {
    assert.equal(conflictDetailHref(conflict()), "/drivers/intake-1");
  });

  it("links an approved rider on the driver id", () => {
    assert.equal(
      conflictDetailHref(conflict({ kind: "driver", id: "drv-9", intakeId: "intake-2", driverId: "drv-9" })),
      "/drivers/drv-9",
    );
  });

  it("names the state a duplicate was found in", () => {
    assert.equal(conflictStateKey(conflict({ state: "archived" })), "conflictArchived");
    assert.equal(conflictStateKey(conflict({ state: "not_approved" })), "conflictNotApproved");
    assert.equal(conflictStateKey(conflict({ kind: "driver", state: "suspended" })), "conflictRider");
  });
});
