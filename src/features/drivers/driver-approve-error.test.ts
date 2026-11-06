import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DriverApproveError, isDriverApproveError } from "./driver-approve-error";

/**
 * An approval refusal has to survive the React Query boundary with its details
 * intact: the panel needs the field list to open the Identity card, and a plain
 * `Error(message)` would drop it.
 */
describe("DriverApproveError", () => {
  it("carries the code and the fields an intake still owes", () => {
    const error = new DriverApproveError("missing_profile_fields", [
      "civil_id",
      "phone",
      "passport_number",
    ]);
    assert.equal(error.name, "DriverApproveError");
    assert.equal(error.message, "missing_profile_fields");
    assert.deepEqual(error.fields, ["civil_id", "phone", "passport_number"]);
    assert.equal(isDriverApproveError(error), true);
  });

  it("has an empty field list for a refusal that names no fields", () => {
    assert.deepEqual(new DriverApproveError("employee_id_exists").fields, []);
  });

  it("recognises only its own instances", () => {
    assert.equal(isDriverApproveError(new Error("missing_profile_fields")), false);
    assert.equal(isDriverApproveError(null), false);
    assert.equal(isDriverApproveError({ code: "missing_profile_fields" }), false);
  });
});
