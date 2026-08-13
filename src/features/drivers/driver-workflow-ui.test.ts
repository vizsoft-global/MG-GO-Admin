import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveWorkflowPillStatus } from "./driver-workflow-ui";

describe("resolveWorkflowPillStatus", () => {
  it("uses Login Status for a linked driver so Details matches the account", () => {
    assert.equal(
      resolveWorkflowPillStatus({
        linked: true,
        account_status: "pending",
        workflow_status: "approved",
      }),
      "pending",
    );
  });

  it("uses Login Status when linked_profile_id is set even if the linked flag is false", () => {
    assert.equal(
      resolveWorkflowPillStatus({
        linked: false,
        linked_profile_id: "drv-1",
        account_status: "active",
        workflow_status: "approved",
      }),
      "active",
    );
  });

  it("shows Pending for an unlinked intake that is not a draft", () => {
    assert.equal(
      resolveWorkflowPillStatus({
        linked: false,
        account_status: "pending",
        workflow_status: "pending",
      }),
      "pending",
    );
  });
});
