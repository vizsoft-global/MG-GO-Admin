import { redirect } from "@/i18n/navigation";
import { getAppOpsSettings } from "./app-settings";
import { getSessionOutcome, type SessionUser } from "./get-session";
import { hasPermissionInSet, type Permission } from "./permissions";
import { SessionUnprovenError } from "./session-unproven";
import { panelGate } from "./staff-entry";

export type PanelAuth =
  | { status: "ok"; session: SessionUser }
  | { status: "unavailable" };

/**
 * Dashboard layout uses this so an unproven cookie paints SessionRecover
 * instead of throwing into error.tsx. Pages still call requireAuth.
 */
export async function resolvePanelAuth(locale: string): Promise<PanelAuth> {
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
      return { status: "unavailable" };
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
    return { status: "unavailable" };
  }
  return { status: "ok", session };
}

export async function requireAuth(locale: string) {
  const auth = await resolvePanelAuth(locale);
  switch (auth.status) {
    case "ok":
      return auth.session;
    case "unavailable":
      throw new SessionUnprovenError();
    default: {
      const neverAuth: never = auth;
      throw new Error(`unhandled panel auth: ${String(neverAuth)}`);
    }
  }
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
