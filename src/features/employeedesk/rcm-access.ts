import type { Permission } from "@/lib/auth/permissions";
import { hasPermissionInSet } from "@/lib/auth/permissions";

export const INCOMING_TYPE_KEYS = [
  "leave",
  "asset",
  "fuel",
  "fuel_refund",
  "loan",
  "complaint",
  "document",
  "salary_justification",
  "sick_leave",
] as const;

export type IncomingTypeKey = (typeof INCOMING_TYPE_KEYS)[number];

export const RCM_ADMIN_CHIPS = [
  { id: "templates", href: "/employeedesk/esign/templates" },
  { id: "all", href: "/employeedesk/all" },
  { id: "reports", href: "/employeedesk/reports" },
  { id: "audit", href: "/settings/logs?module=requests" },
  { id: "settings", href: "/employeedesk/settings" },
  { id: "visits", href: "/employeedesk/visits/calendar" },
] as const;

export function rcmAccessChips(
  permissions: ReadonlySet<Permission> | readonly Permission[],
  isSuperAdmin: boolean,
): { sender: boolean; receiver: boolean } {
  const set = permissions instanceof Set ? permissions : new Set(permissions);
  return {
    sender: hasPermissionInSet(set, "requests.manage", isSuperAdmin),
    receiver:
      hasPermissionInSet(set, "requests.approve", isSuperAdmin) ||
      hasPermissionInSet(set, "requests.view", isSuperAdmin),
  };
}

export function incomingPendingTotal(
  counts: Record<string, { pending?: number } | undefined>,
): number {
  return INCOMING_TYPE_KEYS.reduce(
    (sum, key) => sum + Number(counts[key]?.pending ?? 0),
    0,
  );
}

export type IncomingHubFilter = "all" | "due" | "forwarded";

export function incomingHubListFlags(filter: IncomingHubFilter): {
  assignedToMe: boolean;
  forwardedToMe: boolean;
  handledByMe: boolean;
  dueToday: boolean;
} {
  return {
    assignedToMe: filter === "all",
    forwardedToMe: filter === "forwarded",
    handledByMe: false,
    dueToday: filter === "due",
  };
}
