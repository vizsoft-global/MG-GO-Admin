"use client";

import { useAuth } from "@/contexts/auth-context";
import type { Permission } from "@/lib/auth/permissions";
import type { ResourceCrudModule } from "@/lib/auth/staff-access";

export function useResourceVerbs(module: ResourceCrudModule) {
  const { can } = useAuth();
  return {
    canView: can(`${module}.view` as Permission),
    canCreate: can(`${module}.create` as Permission),
    canEdit: can(`${module}.edit` as Permission),
    canDelete: can(`${module}.delete` as Permission),
    canManage: can(`${module}.manage` as Permission),
  };
}
