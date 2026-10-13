import { redirect } from "@/i18n/navigation";
import { getAppOpsSettings } from "./app-settings";
import { getSessionOutcome } from "./get-session";
import { hasPermissionInSet, type Permission } from "./permissions";
import { panelGate } from "./staff-entry";

export async function requireAuth(locale: string) {
  const [{ session, unavailable, notAuthorized }, ops] = await Promise.all([
    getSessionOutcome(),
    getAppOpsSettings(),
  ]);

  const gate = panelGate({
    hasSession: session != null,
    unavailable,
    notAuthorized,
    approvalStatus: session?.profile.approval_status,
    adminRoleId: session?.profile.admin_role_id,
    archivedAt: session?.profile.archived_at,
    isSuperAdmin: session?.isSuperAdmin === true,
    unclaimedSuperAdmin: ops.unclaimedSuperAdmin,
    maintenanceMode: ops.maintenanceMode,
  });

  switch (gate) {
    case "unavailable":
      // The auth backend did not answer, so the session is unproven rather than
      // absent. Redirecting to /login here is a logout caused by a backend blip;
      // throwing hands the request to the locale error boundary, which keeps the
      // admin signed in and offers a retry.
      throw new Error("auth_backend_unavailable");
    case "not_authorized":
      redirect({ href: "/login?error=not_authorized", locale });
      break;
    case "login":
      redirect({ href: "/login", locale });
      break;
    case "claim":
      redirect({ href: "/setup/claim-super-admin", locale });
      break;
    case "pending":
      redirect({ href: "/pending-approval", locale });
      break;
    case "maintenance":
      redirect({ href: "/maintenance", locale });
      break;
    case "ok":
      break;
    default: {
      const neverGate: never = gate;
      throw new Error(`unhandled panel gate: ${String(neverGate)}`);
    }
  }

  if (!session) {
    throw new Error("Unauthenticated");
  }
  return session;
}

export async function requirePermission(locale: string, permission: Permission) {
  const session = await requireAuth(locale);
  if (
    !hasPermissionInSet(session.permissions, permission, session.isSuperAdmin)
  ) {
    redirect({ href: "/unauthorized", locale });
  }
  return session;
}

export async function requireAnyPermission(
  locale: string,
  permissions: readonly Permission[],
) {
  const session = await requireAuth(locale);
  const allowed = permissions.some((p) =>
    hasPermissionInSet(session.permissions, p, session.isSuperAdmin),
  );
  if (!allowed) {
    redirect({ href: "/unauthorized", locale });
  }
  return session;
}
