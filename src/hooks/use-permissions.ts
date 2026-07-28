"use client";

import { useAuth } from "@/contexts/auth-context";
import type { Permission } from "@/lib/auth/permissions";

export function usePermissions() {
  const auth = useAuth();

  return {
    role: auth.role,
    can: auth.can,
    canAll: (permissions: Permission[]) =>
      permissions.every((permission) => auth.can(permission)),
    canAny: (permissions: Permission[]) =>
      permissions.some((permission) => auth.can(permission)),
  };
}
