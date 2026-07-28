"use client";

import type { ReactNode } from "react";
import { useAuth } from "@/contexts/auth-context";
import type { Permission } from "@/lib/auth/permissions";

export function PermissionGuard({
  permission,
  children,
  fallback = null,
}: {
  permission: Permission;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { can } = useAuth();

  if (!can(permission)) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}
