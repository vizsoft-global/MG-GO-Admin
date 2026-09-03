import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { probeUser } from "@/lib/supabase/auth-probe";
import { withDeadline } from "@/lib/supabase/deadline";
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

const SESSION_BUDGET_MS = 8_000;

async function loadSessionOutcome(): Promise<SessionOutcome> {
  try {
    return await loadSessionOutcomeUnsafe();
  } catch {
    return { session: null, unavailable: true };
  }
}

async function loadSessionOutcomeUnsafe(): Promise<SessionOutcome> {
  const supabase = await createClient({ timeoutMs: SESSION_BUDGET_MS });
  const { user, unavailable } = await probeUser(supabase, {
    timeoutMs: SESSION_BUDGET_MS,
  });

  if (!user) {
    return { session: null, unavailable };
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select(
      "*, admin_role_id, approval_status, approved_at, approved_by, admin_roles(is_super_admin, slug)",
    )
    .eq("id", user.id)
    .maybeSingle();

  // A failed read is not a missing row. Treating it as absent would redirect
  // a valid admin to /login — the same logout-on-blip the proxy already avoids.
  if (profileError) {
    return { session: null, unavailable: true };
  }

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

/**
 * The session gate runs on every dashboard render, so it needs a ceiling. A
 * timeout must report `unavailable` rather than a null session: the caller
 * treats an absent session as grounds to redirect to /login, and a slow
 * backend is not evidence that anyone signed out.
 */
export const getSessionOutcome = cache(() =>
  withDeadline(loadSessionOutcome(), SESSION_BUDGET_MS, () => ({
    session: null,
    unavailable: true,
  })),
);

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
