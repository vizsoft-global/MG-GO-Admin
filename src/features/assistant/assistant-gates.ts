import { hasPermissionInSet, type Permission } from "@/lib/auth/permissions";
import { ASSISTANT_V1_PERMISSION } from "./assistant-contract";

export function assistantModuleAllowed(
  permissions: ReadonlySet<string>,
  isSuperAdmin: boolean,
  modulePermission: Permission,
): boolean {
  return (
    hasPermissionInSet(permissions, ASSISTANT_V1_PERMISSION, isSuperAdmin) &&
    hasPermissionInSet(permissions, modulePermission, isSuperAdmin)
  );
}
