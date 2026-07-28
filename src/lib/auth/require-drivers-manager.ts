import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";

export async function requireDriversManagerApi(): Promise<
  | { session: NonNullable<Awaited<ReturnType<typeof getSessionUser>>> }
  | { error: "not_authorized" }
> {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, "drivers.manage", session.isSuperAdmin)
  ) {
    return { error: "not_authorized" };
  }
  return { session };
}
