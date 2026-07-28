import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";

export async function requireReleasesManagerApi(): Promise<
  | { session: NonNullable<Awaited<ReturnType<typeof getSessionUser>>> }
  | { error: "not_authorized" }
> {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, "releases.manage", session.isSuperAdmin)
  ) {
    return { error: "not_authorized" };
  }
  return { session };
}
