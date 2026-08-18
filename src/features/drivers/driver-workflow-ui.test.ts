import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  blockActionToastKind,
  resolveWorkflowPillStatus,
  showsMobileAppLink,
} from "./driver-workflow-ui";

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

  it("shows Blocked instead of Active when the linked driver is blocked", () => {
    assert.equal(
      resolveWorkflowPillStatus({
        linked: true,
        account_status: "active",
        workflow_status: "approved",
        is_blocked: true,
      }),
      "blocked",
    );
  });
});

describe("showsMobileAppLink", () => {
  it("hides app linkage for a blocked driver, whose session was revoked", () => {
    assert.equal(showsMobileAppLink({ is_blocked: true }), false);
  });

  it("keeps it for everyone else, including a driver who never linked", () => {
    assert.equal(showsMobileAppLink({ is_blocked: false }), true);
    assert.equal(showsMobileAppLink({}), true);
  });
});

describe("blockActionToastKind", () => {
  it("treats a successful block as a warning, not a green success tick", () => {
    assert.equal(blockActionToastKind(true), "warning");
  });

  it("treats unblock as a success", () => {
    assert.equal(blockActionToastKind(false), "success");
  });
});
