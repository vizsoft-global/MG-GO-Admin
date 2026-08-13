import type { DriverAccountStatus, DriverWorkflowStatus } from "./types";

/** Edit-form Operations Active/Inactive is stored as intake workflow_status. */
export function workflowFromAccountStatus(
  accountStatus: DriverAccountStatus,
): DriverWorkflowStatus {
  return accountStatus === "active" ? "approved" : "draft";
}

/** When Operations changes, which drivers.status to write — or null to leave it. */
export function accountStatusToSyncFromOperations(input: {
  linked: boolean;
  currentAccountStatus: DriverAccountStatus | null | undefined;
  operationsWorkflow: DriverWorkflowStatus;
}): DriverAccountStatus | null {
  if (!input.linked) return null;
  if (input.operationsWorkflow !== "draft") return "active";
  return "suspended";
}

/** Operations Inactive (and Pending) must stop an open duty/work-time session. */
export function accountStatusMustEndDuty(status: DriverAccountStatus): boolean {
  return status !== "active";
}
