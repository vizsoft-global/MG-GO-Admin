import { PERMISSION_CATALOG } from "@/lib/auth/permission-catalog";

export const PERMISSIONS = Object.fromEntries(
  PERMISSION_CATALOG.map((e) => [e.slug, e.slug]),
) as {
  [K in (typeof PERMISSION_CATALOG)[number]["slug"]]: K;
};

export type Permission = (typeof PERMISSION_CATALOG)[number]["slug"];

export type AdminApprovalStatus = "pending" | "approved" | "rejected";

export type AuthProfile = {
  id: string;
  role: "rider" | "staff";
  adminRoleId: string | null;
  approvalStatus: AdminApprovalStatus;
  isSuperAdmin: boolean;
  archivedAt: string | null;
};

export function hasPermissionInSet(
  permissions: ReadonlySet<string>,
  permission: Permission,
  isSuperAdmin: boolean,
): boolean {
  if (isSuperAdmin) return true;
  return permissions.has(permission);
}

/** View restaurants on /restaurants or legacy DPD earnings screens. */
export const RESTAURANTS_VIEW_PERMISSIONS = [
  "restaurants.view",
  "earnings.view",
] as const satisfies readonly Permission[];

/** Create/update/delete restaurants. */
export const RESTAURANTS_MANAGE_PERMISSIONS = [
  "restaurants.manage",
  "earnings.manage",
] as const satisfies readonly Permission[];

export function hasAnyPermissionInSet(
  permissions: ReadonlySet<string>,
  permissionList: readonly Permission[],
  isSuperAdmin: boolean,
): boolean {
  if (isSuperAdmin) return true;
  return permissionList.some((p) => permissions.has(p));
}

export function canViewRestaurants(
  permissions: ReadonlySet<string>,
  isSuperAdmin: boolean,
): boolean {
  return hasAnyPermissionInSet(
    permissions,
    RESTAURANTS_VIEW_PERMISSIONS,
    isSuperAdmin,
  );
}

export function canManageRestaurants(
  permissions: ReadonlySet<string>,
  isSuperAdmin: boolean,
): boolean {
  return hasAnyPermissionInSet(
    permissions,
    RESTAURANTS_MANAGE_PERMISSIONS,
    isSuperAdmin,
  );
}

export function canAccessAdminPanel(profile: AuthProfile): boolean {
  return (
    profile.role === "staff" &&
    profile.archivedAt === null &&
    profile.approvalStatus === "approved" &&
    profile.adminRoleId !== null
  );
}

export function needsPendingApproval(profile: AuthProfile): boolean {
  return profile.approvalStatus === "pending";
}

export function isRejected(profile: AuthProfile): boolean {
  return profile.approvalStatus === "rejected";
}
