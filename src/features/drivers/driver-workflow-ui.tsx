"use client";

import { StatusPill } from "@/components/dashboard/status-pill";
import { Badge } from "@/components/ui/badge";
import { resolveStatusVariant } from "@/lib/ui/resolve-status-variant";
import type { DriverWorkflowStatus } from "./types";

export function resolveWorkflowPillStatus(driver: {
  linked: boolean;
  account_status: string;
  workflow_status: DriverWorkflowStatus;
}): string {
  if (driver.linked) return driver.account_status;
  if (driver.workflow_status === "draft") return "draft";
  return "pending";
}

export function WorkflowStatusPill({
  status,
  label,
}: {
  status: string;
  label: string;
}) {
  return (
    <StatusPill variant={resolveStatusVariant(status)} dot>
      {label}
    </StatusPill>
  );
}

export function LinkedBadge({
  linked,
  yesLabel,
  noLabel,
}: {
  linked: boolean;
  yesLabel: string;
  noLabel: string;
}) {
  return (
    <Badge
      variant={linked ? "default" : "secondary"}
      className="rounded-md font-normal"
    >
      {linked ? yesLabel : noLabel}
    </Badge>
  );
}
