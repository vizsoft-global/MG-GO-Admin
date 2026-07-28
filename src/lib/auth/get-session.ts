import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/types/database";
import { canAccessAdminPanel, type AdminApprovalStatus } from "@/lib/auth/permissions";
import {
  enrichSessionPermissions,
  toAuthProfile,
  type EnrichedProfile,
} from "@/lib/auth/profile-auth";

export type SessionUser = {
  id: string;
  email: string | null;
  profile: EnrichedProfile;
  permissions: Set<string>;
  isSuperAdmin: boolean;
  adminRoleSlug: string;
};

async function loadSessionUser(): Promise<SessionUser | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "*, admin_role_id, approval_status, approved_at, approved_by, admin_roles(is_super_admin, slug)",
    )
    .eq("id", user.id)
    .single();

  if (!profile) {
    return null;
  }

  const profileRow = profile as EnrichedProfile &
    Profile & {
      admin_roles: { is_super_admin: boolean; slug: string } | null;
    };

  const enriched = profileRow;
  const isSuperAdmin = profileRow.admin_roles?.is_super_admin === true;
  const authProfile = toAuthProfile(enriched, isSuperAdmin);

  if (!canAccessAdminPanel(authProfile) && enriched.approval_status !== "pending") {
    if (enriched.approval_status === "rejected") {
      return null;
    }
  }

  const permissions = await enrichSessionPermissions(
    supabase,
    enriched.admin_role_id,
    isSuperAdmin,
  );

  return {
    id: user.id,
    email: user.email ?? enriched.email,
    profile: enriched,
    permissions,
    isSuperAdmin,
    adminRoleSlug: profileRow.admin_roles?.slug ?? "operator",
  };
}

export const getSessionUser = cache(loadSessionUser);

export async function getProfileForUser(userId: string): Promise<EnrichedProfile | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("*, admin_role_id, approval_status, approved_at, approved_by")
    .eq("id", userId)
    .maybeSingle();

  return (data as EnrichedProfile | null) ?? null;
}

export type { AdminApprovalStatus };
