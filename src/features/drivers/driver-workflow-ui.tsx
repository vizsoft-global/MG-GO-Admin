"use client";

import { StatusPill } from "@/components/dashboard/status-pill";
import { Badge } from "@/components/ui/badge";
import { resolveStatusVariant } from "@/lib/ui/resolve-status-variant";
import type { DriverWorkflowStatus } from "./types";

export function isLinkedDriver(driver: {
  linked: boolean;
  linked_profile_id?: string | null;
}): boolean {
  return driver.linked || Boolean(driver.linked_profile_id);
}

export function resolveWorkflowPillStatus(driver: {
  linked: boolean;
  linked_profile_id?: string | null;
  account_status: string;
  workflow_status: DriverWorkflowStatus;
  is_blocked?: boolean;
}): string {
  if (driver.is_blocked) return "blocked";
  if (isLinkedDriver(driver)) return driver.account_status;
  if (driver.workflow_status === "draft") return "draft";
  return "pending";
}

/**
 * Blocking revokes the device session (`set_driver_blocked`), so a blocked
 * driver has no app access to report — "Mobile app linked: Yes" would state the
 * opposite of what the block did.
 */
export function showsMobileAppLink(driver: { is_blocked?: boolean }): boolean {
  return !driver.is_blocked;
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
