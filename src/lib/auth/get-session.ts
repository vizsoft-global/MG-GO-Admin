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
import { userFromLocalJwt } from "@/lib/auth/local-session";

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
  let { user, unavailable } = await probeUser(supabase, {
    timeoutMs: SESSION_BUDGET_MS,
  });

  // The probe's wall-clock budget includes event-loop stalls (Turbopack
  // compiling a first-hit route, a server-action RSC refresh). That is not
  // evidence GoTrue is down. Recover from the cookie JWT before painting
  // error.tsx — a signed-in admin navigating or applying an import must not
  // look like an outage.
  if (!user && unavailable) {
    const local = await supabase.auth.getSession();
    const recovered = userFromLocalJwt(local.data.session);
    if (recovered && local.data.session?.user) {
      user = local.data.session.user;
      unavailable = false;
    }
  }

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
 * Per-request cache only. Do not wrap the whole load in a second wall-clock
 * race: getUser + profile + permissions routinely exceed the probe budget
 * when the first hop is slow-but-successful, and that discarded a real
 * session (error.tsx on every first compile / post-action RSC refresh).
 * The fetch AbortSignal on createClient still bounds the network.
 */
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
