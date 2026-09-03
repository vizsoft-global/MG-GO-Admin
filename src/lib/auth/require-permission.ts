import { redirect } from "@/i18n/navigation";
import { getSessionOutcome } from "./get-session";
import { hasPermissionInSet, type Permission } from "./permissions";

export async function requireAuth(locale: string) {
  const { session, unavailable } = await getSessionOutcome();

  // The auth backend did not answer, so the session is unproven rather than
  // absent. Redirecting to /login here is a logout caused by a backend blip;
  // throwing hands the request to the locale error boundary, which keeps the
  // admin signed in and offers a retry.
  if (!session && unavailable) {
    throw new Error("auth_backend_unavailable");
  }

  if (!session) {
    redirect({ href: "/login", locale });
    throw new Error("Unauthenticated");
  }
  if (session.profile.approval_status === "pending") {
    redirect({ href: "/pending-approval", locale });
  }
  if (session.profile.approval_status === "rejected") {
    redirect({ href: "/login?error=not_authorized", locale });
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
