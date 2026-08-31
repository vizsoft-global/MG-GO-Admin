import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  evaluateImportIdentity,
  isImportRowReady,
  shouldApproveImportRow,
  type ImportIdentityRoster,
  type ImportIdentitySeen,
} from "./import-identity";

function emptySeen(): ImportIdentitySeen {
  return {
    employeeIds: new Set(),
    phones: new Map(),
    civils: new Map(),
  };
}

function roster(partial: Partial<ImportIdentityRoster> = {}): ImportIdentityRoster {
  return {
    employeeIds: new Set(),
    phoneToEmployee: new Map(),
    civilToEmployee: new Map(),
    ...partial,
  };
}

describe("evaluateImportIdentity", () => {
  it("marks an employee ID already in the fleet as an update candidate, not a block", () => {
    const seen = emptySeen();
    const result = evaluateImportIdentity(
      { full_name: "Ahmed", employee_id: "EMP2048", phone: "99111111", civil_id: null },
      roster({
        employeeIds: new Set(["emp2048"]),
        phoneToEmployee: new Map([["+96599111111", "emp2048"]]),
      }),
      seen,
    );
    assert.equal(result.status, "duplicate_employee_id");
    assert.equal(result.existingByEmployeeId, true);
    assert.equal(isImportRowReady(result, "update"), true);
    assert.equal(isImportRowReady(result, "skip"), false);
  });

  it("does not treat the same phone on that same employee as a phone clash", () => {
    const result = evaluateImportIdentity(
      { full_name: "Ahmed", employee_id: "12345", phone: "99111111", civil_id: null },
      roster({
        employeeIds: new Set(["12345"]),
        phoneToEmployee: new Map([["+96599111111", "12345"]]),
      }),
      emptySeen(),
    );
    assert.equal(result.status, "duplicate_employee_id");
    assert.equal(result.existingByEmployeeId, true);
  });

  it("still refuses a phone that belongs to a different employee", () => {
    const result = evaluateImportIdentity(
      { full_name: "Sara", employee_id: "EMP9", phone: "99111111", civil_id: null },
      roster({
        employeeIds: new Set(["12345"]),
        phoneToEmployee: new Map([["+96599111111", "12345"]]),
      }),
      emptySeen(),
    );
    assert.equal(result.status, "duplicate_phone");
    assert.equal(isImportRowReady(result, "update"), false);
  });

  it("refuses a second sheet row with the same employee ID even when Update is on", () => {
    const seen = emptySeen();
    const first = evaluateImportIdentity(
      { full_name: "A", employee_id: "EMP1", phone: null, civil_id: null },
      roster(),
      seen,
    );
    assert.equal(first.status, "ok");
    const second = evaluateImportIdentity(
      { full_name: "B", employee_id: "emp1", phone: null, civil_id: null },
      roster(),
      seen,
    );
    assert.equal(second.status, "duplicate_employee_id");
    assert.equal(second.existingByEmployeeId, false);
    assert.equal(isImportRowReady(second, "update"), false);
  });

  it("accepts a brand-new alphanumeric employee ID as create", () => {
    const result = evaluateImportIdentity(
      { full_name: "Sara", employee_id: "EMP2048", phone: null, civil_id: null },
      roster(),
      emptySeen(),
    );
    assert.equal(result.status, "ok");
    assert.equal(result.existingByEmployeeId, false);
    assert.equal(isImportRowReady(result, "skip"), true);
  });
});

describe("shouldApproveImportRow", () => {
  it("does not re-approve an intake that already has a login", () => {
    assert.equal(shouldApproveImportRow(true, true), false);
    assert.equal(shouldApproveImportRow(true, false), true);
    assert.equal(shouldApproveImportRow(false, false), false);
  });
});
