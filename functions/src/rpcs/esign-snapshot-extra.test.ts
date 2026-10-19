import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readEsignSnapshotExtra } from "./esign-snapshot-extra";

describe("readEsignSnapshotExtra", () => {
  it("reads a driver column, then custom_fields, then the intake", () => {
    const fromDriver = readEsignSnapshotExtra(
      { position: " Rider ", custom_fields: { sponsor: "ignored" } },
      { sponsor: "intake" },
    );
    assert.equal(fromDriver.position, "Rider");
    assert.equal(fromDriver.sponsor, "ignored");

    const fromIntake = readEsignSnapshotExtra(
      { custom_fields: { pay_through: "" } },
      { pay_through: "2026-10-31", bank_number: 1001, custom_fields: { position: "Intake role" } },
    );
    assert.equal(fromIntake.position, "Intake role");
    assert.equal(fromIntake.pay_through, "2026-10-31");
    assert.equal(fromIntake.bank_number, "1001");
    assert.equal(fromIntake.sponsor, null);
  });

  it("leaves every key null when neither record has it", () => {
    const empty = readEsignSnapshotExtra({ employee_id: "1" }, null);
    for (const value of Object.values(empty)) assert.equal(value, null);
    assert.equal("department" in empty, true);
    assert.equal("monthly_salary_kwd" in empty, true);
    assert.equal("policy_check" in empty, true);
  });

  it("reads the HR policy chips from custom fields", () => {
    const row = readEsignSnapshotExtra(
      {
        department: "Ops",
        custom_fields: {
          monthly_salary_kwd: 260,
          years_of_service: "3.4",
          max_loan_policy_kwd: "780",
          previous_loan_outstanding_kwd: 0,
          policy_check: "Eligible",
        },
      },
      null,
    );
    assert.equal(row.department, "Ops");
    assert.equal(row.monthly_salary_kwd, "260");
    assert.equal(row.years_of_service, "3.4");
    assert.equal(row.max_loan_policy_kwd, "780");
    assert.equal(row.previous_loan_outstanding_kwd, "0");
    assert.equal(row.policy_check, "Eligible");
  });
});
