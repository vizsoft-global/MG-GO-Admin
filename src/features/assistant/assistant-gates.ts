import { getSessionUser, type SessionUser } from "@/lib/auth/get-session";
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

export async function requireAssistantModule(modulePermission: Permission): Promise<SessionUser> {
  const session = await getSessionUser();
  if (!session || !assistantModuleAllowed(session.permissions, session.isSuperAdmin, modulePermission)) {
    throw new Error("not_authorized");
  }
  return session;
}

export function canShowContact(session: SessionUser, modulePermission: Permission): boolean {
  return assistantModuleAllowed(session.permissions, session.isSuperAdmin, modulePermission);
}
