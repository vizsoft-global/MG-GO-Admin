"use server";

import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { getPresignedGetUrl } from "@/lib/storage/r2-client";
import { isAllowedStorageKey } from "@/lib/storage/r2-keys";

/** `drivers/{uuid}/login_verification/...` — readable with drivers.view */
const LOGIN_VERIFICATION_KEY =
  /^drivers\/[0-9a-f-]{36}\/login_verification\//i;

function canReadStorageKey(
  key: string,
  permissions: Set<string>,
  isSuperAdmin: boolean,
): boolean {
  if (key.startsWith("drivers/")) {
    if (LOGIN_VERIFICATION_KEY.test(key)) {
      return (
        hasPermissionInSet(permissions, "drivers.view", isSuperAdmin) ||
        hasPermissionInSet(permissions, "drivers.manage", isSuperAdmin)
      );
    }
    return hasPermissionInSet(permissions, "drivers.manage", isSuperAdmin);
  }
  if (key.startsWith("driver-avatars/")) {
    return (
      hasPermissionInSet(permissions, "drivers.view", isSuperAdmin) ||
      hasPermissionInSet(permissions, "drivers.manage", isSuperAdmin)
    );
  }
  if (key.startsWith("partners/")) {
    return (
      hasPermissionInSet(permissions, "partners.view", isSuperAdmin) ||
      hasPermissionInSet(permissions, "partners.manage", isSuperAdmin)
    );
  }
  if (key.startsWith("notifications/")) {
    return hasPermissionInSet(permissions, "notifications.view", isSuperAdmin);
  }
  return false;
}

export async function getSignedStorageUrl(
  key: string,
): Promise<{ url?: string; error?: string }> {
  const session = await getSessionUser();
  if (!session) return { error: "not_authorized" };

  const normalized = key.trim().replace(/^\/+/, "");
  if (!isAllowedStorageKey(normalized)) {
    return { error: "invalid_key" };
  }

  if (!canReadStorageKey(normalized, session.permissions, session.isSuperAdmin)) {
    return { error: "not_authorized" };
  }

  try {
    const url = await getPresignedGetUrl(normalized);
    return { url };
  } catch {
    return { error: "sign_failed" };
  }
}
