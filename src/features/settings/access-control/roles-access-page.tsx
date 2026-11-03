"use client";

import type { AdminRoleRow } from "@/lib/auth/get-role-permissions";
import type {
  RequestTypeOption,
  StaffAccessListRow,
} from "@/features/settings/staff-access-actions";
import { AccessControlShell } from "./access-control-shell";
import type { PermissionRow } from "@/features/settings/roles-permissions-panel";

export function RolesAccessPage({
  userId,
  rows,
  loadError,
  roles,
  requestTypes,
  tab,
  permissions,
  usageCounts,
  nowMs,
}: {
  userId?: string | null;
  rows: StaffAccessListRow[];
  loadError?: string;
  roles: AdminRoleRow[];
  requestTypes: RequestTypeOption[];
  tab?: "staff" | "roles";
  permissions?: PermissionRow[];
  usageCounts?: { roleId: string; userCount: number }[];
  nowMs: number;
}) {
  return (
    <AccessControlShell
      rows={rows}
      loadError={loadError}
      roles={roles}
      requestTypes={requestTypes}
      initialUserId={userId}
      initialTab={tab ?? "staff"}
      permissions={permissions}
      usageCounts={usageCounts}
      nowMs={nowMs}
    />
  );
}
