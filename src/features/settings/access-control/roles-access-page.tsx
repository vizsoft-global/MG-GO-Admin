"use client";

import type { AdminRoleRow } from "@/lib/auth/get-role-permissions";
import type {
  RequestTypeOption,
  StaffAccessListRow,
} from "@/features/settings/staff-access-actions";
import { AccessControlShell } from "./access-control-shell";

export function RolesAccessPage({
  userId,
  rows,
  loadError,
  roles,
  requestTypes,
}: {
  userId?: string | null;
  rows: StaffAccessListRow[];
  loadError?: string;
  roles: AdminRoleRow[];
  requestTypes: RequestTypeOption[];
}) {
  return (
    <AccessControlShell
      rows={rows}
      loadError={loadError}
      roles={roles}
      requestTypes={requestTypes}
      initialUserId={userId}
    />
  );
}
