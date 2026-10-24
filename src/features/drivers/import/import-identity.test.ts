import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canContinueImportLookups,
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
    clientIds: new Map(),
  };
}

function roster(partial: Partial<ImportIdentityRoster> = {}): ImportIdentityRoster {
  return {
    employeeIds: new Set(),
    phoneToEmployee: new Map(),
    civilToEmployee: new Map(),
    clientIdToEmployees: new Map(),
    employeeIdByKey: new Map(),
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

  it("updates on a unique Client ID when MG ID is blank", () => {
    const result = evaluateImportIdentity(
      { full_name: null, employee_id: null, phone: null, civil_id: null, client_id: "105913" },
      roster({
        employeeIds: new Set(["emp2048"]),
        clientIdToEmployees: new Map([["105913", new Set(["emp2048"])]]),
        employeeIdByKey: new Map([["emp2048", "EMP2048"]]),
      }),
      emptySeen(),
    );
    assert.equal(result.status, "duplicate_client_id");
    assert.equal(result.existingByClientId, true);
    assert.equal(result.resolvedEmployeeId, "EMP2048");
    assert.equal(isImportRowReady(result, "update"), true);
    assert.equal(canContinueImportLookups(result), true);
  });

  it("refuses when Client ID and MG ID name different people", () => {
    const result = evaluateImportIdentity(
      { full_name: "Sara", employee_id: "EMP9", phone: null, civil_id: null, client_id: "105913" },
      roster({
        employeeIds: new Set(["emp2048", "emp9"]),
        clientIdToEmployees: new Map([["105913", new Set(["emp2048"])]]),
        employeeIdByKey: new Map([["emp2048", "EMP2048"]]),
      }),
      emptySeen(),
    );
    assert.equal(result.status, "client_id_mismatch");
    assert.equal(isImportRowReady(result, "update"), false);
  });

  it("refuses a Client ID that matches more than one person when MG ID is blank", () => {
    const result = evaluateImportIdentity(
      { full_name: "Sara", employee_id: null, phone: null, civil_id: null, client_id: "105913" },
      roster({
        clientIdToEmployees: new Map([["105913", new Set(["emp1", "emp2"])]]),
      }),
      emptySeen(),
    );
    assert.equal(result.status, "ambiguous_client_id");
    assert.equal(isImportRowReady(result, "update"), false);
  });

  it("treats a second sheet row with the same Client ID as a sheet duplicate", () => {
    const seen = emptySeen();
    const fleet = roster({
      employeeIds: new Set(["emp2048"]),
      clientIdToEmployees: new Map([["105913", new Set(["emp2048"])]]),
      employeeIdByKey: new Map([["emp2048", "EMP2048"]]),
    });
    const first = evaluateImportIdentity(
      { full_name: null, employee_id: null, phone: null, civil_id: null, client_id: "105913" },
      fleet,
      seen,
    );
    assert.equal(first.existingByClientId, true);
    const second = evaluateImportIdentity(
      { full_name: null, employee_id: null, phone: null, civil_id: null, client_id: "105913" },
      fleet,
      seen,
    );
    assert.equal(second.status, "duplicate_client_id");
    assert.equal(second.existingByClientId, false);
    assert.equal(isImportRowReady(second, "update"), false);
  });

  it("lets two creates share a Client ID that is not yet in the roster", () => {
    const seen = emptySeen();
    const first = evaluateImportIdentity(
      { full_name: "A", employee_id: "EMP1", phone: null, civil_id: null, client_id: "NEW-1" },
      roster(),
      seen,
    );
    const second = evaluateImportIdentity(
      { full_name: "B", employee_id: "EMP2", phone: null, civil_id: null, client_id: "NEW-1" },
      roster(),
      seen,
    );
    assert.equal(first.status, "ok");
    assert.equal(second.status, "ok");
  });
});

describe("shouldApproveImportRow", () => {
  it("does not re-approve an intake that already has a login", () => {
    assert.equal(shouldApproveImportRow(true, true), false);
    assert.equal(shouldApproveImportRow(true, false), true);
    assert.equal(shouldApproveImportRow(false, false), false);
  });
});
