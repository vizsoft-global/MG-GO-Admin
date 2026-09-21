import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Profile } from "@/types/database";
import {
  PERMISSIONS,
  type AdminApprovalStatus,
  type AuthProfile,
  canAccessAdminPanel,
} from "@/lib/auth/permissions";
import {
  parseStaffAccessKind,
  resolveSessionPermissionSlugs,
} from "@/lib/auth/staff-access";

export type EnrichedProfile = Profile & {
  admin_role_id: string | null;
  approval_status: AdminApprovalStatus;
  approved_at: string | null;
  approved_by: string | null;
};

export function toAuthProfile(
  profile: EnrichedProfile,
  isSuperAdmin: boolean,
): AuthProfile {
  return {
    id: profile.id,
    role: profile.role,
    adminRoleId: profile.admin_role_id,
    approvalStatus: profile.approval_status,
    isSuperAdmin,
    archivedAt: profile.archived_at,
  };
}

async function loadCatalogSlugs(
  supabase: SupabaseClient<Database>,
): Promise<string[]> {
  const { data } = await supabase.from("admin_permissions").select("slug");
  if (data?.length) return data.map((row) => row.slug);
  return Object.values(PERMISSIONS);
}

async function loadRoleSlugs(
  supabase: SupabaseClient<Database>,
  adminRoleId: string,
): Promise<string[]> {
  const { data } = await supabase
    .from("admin_role_permissions")
    .select("permission_slug")
    .eq("role_id", adminRoleId);
  return data?.map((row) => row.permission_slug) ?? [];
}

async function loadUserTicks(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<string[] | null> {
  const { data, error } = await supabase
    .from("admin_user_permissions")
    .select("permission_slug")
    .eq("user_id", userId);
  if (error) return null;
  return data?.map((row) => row.permission_slug) ?? [];
}

export async function enrichSessionPermissions(
  supabase: SupabaseClient<Database>,
  adminRoleId: string | null,
  isSuperAdmin: boolean,
  accessKindRaw?: string | null,
  userId?: string,
) {
  if (!adminRoleId) {
    return new Set<string>();
  }

  const accessKind = parseStaffAccessKind(accessKindRaw);
  const catalogSlugs = await loadCatalogSlugs(supabase);

  if (isSuperAdmin || accessKind === "manager") {
    return resolveSessionPermissionSlugs({
      isSuperAdmin,
      accessKind: accessKind ?? (isSuperAdmin ? "manager" : null),
      userTicks: [],
      roleSlugs: [],
      catalogSlugs,
    });
  }

  if (accessKind === "user" && userId) {
    const userTicks = await loadUserTicks(supabase, userId);
    if (userTicks) {
      return resolveSessionPermissionSlugs({
        isSuperAdmin,
        accessKind,
        userTicks,
        roleSlugs: [],
        catalogSlugs,
      });
    }
  }

  const roleSlugs = await loadRoleSlugs(supabase, adminRoleId);
  return resolveSessionPermissionSlugs({
    isSuperAdmin,
    accessKind,
    userTicks: null,
    roleSlugs,
    catalogSlugs,
  });
}

export { canAccessAdminPanel };
