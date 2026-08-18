import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isAdminAccessRequestProfile } from "./access-request-eligibility";

describe("isAdminAccessRequestProfile", () => {
  it("keeps pending staff who are not drivers", () => {
    assert.equal(
      isAdminAccessRequestProfile({
        role: "staff",
        approval_status: "pending",
        isDriver: false,
      }),
      true,
    );
  });

  it("drops rider accounts even if they are pending", () => {
    assert.equal(
      isAdminAccessRequestProfile({
        role: "rider",
        approval_status: "pending",
      }),
      false,
    );
  });

  it("drops a staff row that already has a drivers record", () => {
    assert.equal(
      isAdminAccessRequestProfile({
        role: "staff",
        approval_status: "pending",
        isDriver: true,
      }),
      false,
    );
  });

  it("drops approved staff", () => {
    assert.equal(
      isAdminAccessRequestProfile({
        role: "staff",
        approval_status: "approved",
      }),
      false,
    );
  });
});
