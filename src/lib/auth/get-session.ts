import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { probeUser } from "@/lib/supabase/auth-probe";
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

export type SessionOutcome = {
  session: SessionUser | null;
  /** The auth backend could not be reached — treat as unknown, not signed out. */
  unavailable: boolean;
};

async function loadSessionOutcome(): Promise<SessionOutcome> {
  const supabase = await createClient();
  const { user, unavailable } = await probeUser(supabase);

  if (!user) {
    return { session: null, unavailable };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "*, admin_role_id, approval_status, approved_at, approved_by, admin_roles(is_super_admin, slug)",
    )
    .eq("id", user.id)
    .single();

  if (!profile) {
    return { session: null, unavailable: false };
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
      return { session: null, unavailable: false };
    }
  }

  const permissions = await enrichSessionPermissions(
    supabase,
    enriched.admin_role_id,
    isSuperAdmin,
  );

  return {
    session: {
      id: user.id,
      email: user.email ?? enriched.email,
      profile: enriched,
      permissions,
      isSuperAdmin,
      adminRoleSlug: profileRow.admin_roles?.slug ?? "operator",
    },
    unavailable: false,
  };
}

export const getSessionOutcome = cache(loadSessionOutcome);

export async function getSessionUser(): Promise<SessionUser | null> {
  return (await getSessionOutcome()).session;
}

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
