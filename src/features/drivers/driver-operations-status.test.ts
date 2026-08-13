import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  accountStatusMustEndDuty,
  accountStatusToSyncFromOperations,
  workflowFromAccountStatus,
} from "./driver-operations-status";

describe("workflowFromAccountStatus", () => {
  it("maps Active account to Operations Active (approved)", () => {
    assert.equal(workflowFromAccountStatus("active"), "approved");
  });

  it("maps Suspended/Pending account to Operations Inactive (draft)", () => {
    assert.equal(workflowFromAccountStatus("suspended"), "draft");
    assert.equal(workflowFromAccountStatus("pending"), "draft");
  });
});

describe("accountStatusToSyncFromOperations", () => {
  it("suspends a linked Active driver when Operations is set Inactive", () => {
    assert.equal(
      accountStatusToSyncFromOperations({
        linked: true,
        currentAccountStatus: "active",
        operationsWorkflow: "draft",
      }),
      "suspended",
    );
  });

  it("activates a linked Suspended driver when Operations is set Active", () => {
    assert.equal(
      accountStatusToSyncFromOperations({
        linked: true,
        currentAccountStatus: "suspended",
        operationsWorkflow: "approved",
      }),
      "active",
    );
  });

  it("activates a linked Pending driver when Operations is set Active", () => {
    assert.equal(
      accountStatusToSyncFromOperations({
        linked: true,
        currentAccountStatus: "pending",
        operationsWorkflow: "approved",
      }),
      "active",
    );
  });

  it("writes Active when Operations is Active even if current status was not loaded", () => {
    assert.equal(
      accountStatusToSyncFromOperations({
        linked: true,
        currentAccountStatus: null,
        operationsWorkflow: "approved",
      }),
      "active",
    );
  });

  it("re-asserts Active when Operations stays Active so Details cannot stay Pending", () => {
    assert.equal(
      accountStatusToSyncFromOperations({
        linked: true,
        currentAccountStatus: "active",
        operationsWorkflow: "approved",
      }),
      "active",
    );
  });

  it("suspends a linked Pending driver when Operations is set Inactive", () => {
    assert.equal(
      accountStatusToSyncFromOperations({
        linked: true,
        currentAccountStatus: "pending",
        operationsWorkflow: "draft",
      }),
      "suspended",
    );
  });

  it("Inactive/Suspended/Pending must end an active duty session", () => {
    assert.equal(accountStatusMustEndDuty("suspended"), true);
    assert.equal(accountStatusMustEndDuty("pending"), true);
    assert.equal(accountStatusMustEndDuty("active"), false);
  });

  it("does not write account status for unlinked intakes", () => {
    assert.equal(
      accountStatusToSyncFromOperations({
        linked: false,
        currentAccountStatus: "active",
        operationsWorkflow: "draft",
      }),
      null,
    );
  });
});
