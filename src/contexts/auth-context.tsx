"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { AppRole } from "@/types/database";
import {
  hasPermissionInSet,
  type Permission,
  type AdminApprovalStatus,
} from "@/lib/auth/permissions";

type AuthContextValue = {
  userId: string;
  email: string | null;
  fullName: string | null;
  role: AppRole;
  locale: string;
  adminRoleId: string | null;
  approvalStatus: AdminApprovalStatus;
  isSuperAdmin: boolean;
  adminRoleSlug: string;
  permissions: string[];
  can: (permission: Permission) => boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: Omit<AuthContextValue, "can">;
}) {
  const permissionSet = useMemo(() => new Set(value.permissions), [value.permissions]);

  const can = (permission: Permission) =>
    hasPermissionInSet(permissionSet, permission, value.isSuperAdmin);

  return (
    <AuthContext.Provider value={{ ...value, can }}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
