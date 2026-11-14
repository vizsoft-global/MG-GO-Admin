import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyEmployeeSnapshotChange,
  firstMissingRequiredKey,
  mergeFieldValuesForSend,
} from "./esign-snapshot-merge";
import { classifyEsignResolveError } from "./esign-resolve-error";
import { classifyEsignUploadError } from "./esign-upload-error";

describe("snapshot auto-fill", () => {
  const fields = [
    { field_key: "employee_name" },
    { field_key: "position" },
    { field_key: "sponsor" },
    { field_key: "pay_through" },
    { field_key: "bank_number" },
    { field_key: "amount" },
  ];

  it("fills empty sheet keys from a known snapshot", () => {
    const merged = mergeFieldValuesForSend(
      {
        employee_name: "Ali",
        position: "Rider",
        sponsor: "MG",
        pay_through: "Salary",
        bank_number: "****1234",
      },
      { amount: "10", employee_name: "" },
      fields,
    );
    assert.equal(merged.employee_name, "Ali");
    assert.equal(merged.position, "Rider");
    assert.equal(merged.sponsor, "MG");
    assert.equal(merged.pay_through, "Salary");
    assert.equal(merged.bank_number, "****1234");
    assert.equal(merged.amount, "10");
  });

  it("lets a typed value win over the snapshot", () => {
    const merged = mergeFieldValuesForSend(
      { employee_name: "Ali", position: "Rider" },
      { employee_name: "Override", position: "" },
      fields,
    );
    assert.equal(merged.employee_name, "Override");
    assert.equal(merged.position, "Rider");
  });

  it("keeps missing extras empty so send can proceed when they are optional", () => {
    const merged = mergeFieldValuesForSend(
      { employee_name: "Ali", position: "", sponsor: null as unknown as string },
      {},
      fields,
    );
    assert.equal(merged.employee_name, "Ali");
    assert.equal(merged.position ?? "", "");
    assert.equal(firstMissingRequiredKey(merged, [{ field_key: "position", is_required: false }]), null);
  });

  it("replaces the previous rider's leftover values when the next snapshot is empty", () => {
    const merged = applyEmployeeSnapshotChange(
      { employee_name: "Sara" },
      /**
       * The form still holds rider A's snapshot values. With nothing in `touched`
       * — nobody typed — every one of them is rider A's leftover and must be
       * replaced, including the keys the new snapshot does not carry.
       */
      { employee_name: "Ali", pay_through: "Salary", bank_number: "****1234", amount: "" },
      fields,
      new Set<string>(),
    );
    assert.equal(merged.employee_name, "Sara");
    assert.equal(merged.pay_through, "");
    assert.equal(merged.bank_number, "");
    assert.equal(merged.amount, "");
  });

  it("keeps an operator override when the rider changes", () => {
    const merged = applyEmployeeSnapshotChange(
      { employee_name: "Sara", position: "Captain" },
      { employee_name: "Ali", position: "Rider" },
      fields,
      // `employee_name` is the only key a human typed.
      new Set(["employee_name"]),
    );
    assert.equal(merged.employee_name, "Ali");
    assert.equal(merged.position, "Captain");
  });

  it("clears a touched key when the next rider has no value for it", () => {
    const merged = applyEmployeeSnapshotChange(
      {},
      { bank_number: "typed" },
      fields,
      // Hidden controls are reported as touched by the caller; a data key is not.
      new Set<string>(),
    );
    assert.equal(merged.bank_number, "");
  });

  it("does not look like unknown_fn or a bucket miss", () => {
    assert.equal(classifyEsignResolveError("unknown_id"), "unknown_id");
    assert.notEqual(classifyEsignResolveError("unknown_id"), "unknown_fn");
    assert.notEqual(classifyEsignUploadError("unknown_id"), "storage_bucket_missing");
  });
});
