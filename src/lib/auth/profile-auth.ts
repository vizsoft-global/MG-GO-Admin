import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Profile } from "@/types/database";
import {
  PERMISSIONS,
  type AdminApprovalStatus,
  type AuthProfile,
  canAccessAdminPanel,
} from "@/lib/auth/permissions";

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

export async function enrichSessionPermissions(
  supabase: SupabaseClient<Database>,
  adminRoleId: string | null,
  isSuperAdmin: boolean,
) {
  if (!adminRoleId) {
    return new Set<string>();
  }

  if (isSuperAdmin) {
    const { data } = await supabase.from("admin_permissions").select("slug");
    if (data?.length) {
      return new Set(data.map((row) => row.slug));
    }
    return new Set(Object.values(PERMISSIONS));
  }

  const { data } = await supabase
    .from("admin_role_permissions")
    .select("permission_slug")
    .eq("role_id", adminRoleId);

  return new Set(data?.map((row) => row.permission_slug) ?? []);
}

export { canAccessAdminPanel };
