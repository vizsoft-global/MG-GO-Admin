import { cache } from "react";
import { cookies } from "next/headers";
import type { Firestore } from "firebase-admin/firestore";
import { getFirebaseFirestore } from "@/lib/firebase/admin";
import {
  MIDDLEWARE_SESSION_BUDGET_MS,
  STAFF_SESSION_COOKIE,
  verifyStaffSessionCookie,
} from "@/lib/firebase/session";
import { COLLECTIONS } from "@/lib/firebase/db";
import { withDeadline } from "@/lib/async/deadline";
import type { AdminRoleDoc, ProfileDoc } from "@/lib/firebase/types";
import { canAccessAdminPanel, type AdminApprovalStatus } from "@/lib/auth/permissions";
import {
  enrichSessionPermissions,
  toAuthProfile,
  type EnrichedProfile,
} from "@/lib/auth/profile-auth";
import { parseStaffAccessKind, type StaffAccessKind } from "@/lib/auth/staff-access";

export type SessionUser = {
  id: string;
  email: string | null;
  profile: EnrichedProfile;
  permissions: Set<string>;
  isSuperAdmin: boolean;
  isManager: boolean;
  accessKind: StaffAccessKind | null;
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
  const cookieStore = await cookies();
  const cookie = cookieStore.get(STAFF_SESSION_COOKIE)?.value;

  const probe = await verifyStaffSessionCookie(cookie, {
    timeoutMs: MIDDLEWARE_SESSION_BUDGET_MS,
  });

  // The verifier did not answer, so the session is unproven rather than absent.
  // Throwing would be a logout caused by a backend blip.
  if (!probe.uid) {
    return { session: null, unavailable: probe.unavailable };
  }

  const db = await getFirebaseFirestore();
  if (!db) {
    return { session: null, unavailable: true };
  }

  const profileSnap = await db.collection(COLLECTIONS.profiles).doc(probe.uid).get();

  if (!profileSnap.exists) {
    return { session: null, unavailable: false };
  }

  const profileRow = { id: probe.uid, ...(profileSnap.data() ?? {}) } as ProfileDoc;
  const enriched: EnrichedProfile = profileRow;

  const isSuperAdmin = probe.claims?.superAdmin === true;
  const accessKind = parseStaffAccessKind(profileRow.access_kind);
  const isManager = isSuperAdmin || accessKind === "manager";
  const authProfile = toAuthProfile(enriched, isSuperAdmin);

  if (!canAccessAdminPanel(authProfile) && enriched.approval_status !== "pending") {
    if (enriched.approval_status === "rejected") {
      return { session: null, unavailable: false };
    }
  }

  const [permissions, roleSlug] = await Promise.all([
    enrichSessionPermissions(
      db,
      enriched.admin_role_id,
      isSuperAdmin,
      accessKind,
      probe.uid,
    ),
    loadRoleSlug(db, enriched.admin_role_id),
  ]);

  return {
    session: {
      id: probe.uid,
      email: enriched.email,
      profile: enriched,
      permissions,
      isSuperAdmin,
      isManager,
      accessKind,
      adminRoleSlug: roleSlug ?? "operator",
    },
    unavailable: false,
  };
}

async function loadRoleSlug(
  db: Firestore,
  roleId: string | null,
): Promise<string | null> {
  if (!roleId) return null;
  const snap = await db.collection(COLLECTIONS.adminRoles).doc(roleId).get();
  return (snap.data() as AdminRoleDoc | undefined)?.slug ?? null;
}

/**
 * Per-request cache only. Do not wrap the whole load in a second wall-clock
 * race: verification, profile and permissions routinely exceed the verify
 * budget when the first hop is slow-but-successful, and that discarded a real
 * session (error.tsx on every first compile / post-action RSC refresh).
 */
export const getSessionOutcome = cache(loadSessionOutcome);

export async function getSessionUser(): Promise<SessionUser | null> {
  return (await getSessionOutcome()).session;
}

export async function getProfileForUser(userId: string): Promise<EnrichedProfile | null> {
  const db = await getFirebaseFirestore();
  if (!db) return null;
  const snap = await db.collection(COLLECTIONS.profiles).doc(userId).get();
  if (!snap.exists) return null;
  return { id: userId, ...(snap.data() ?? {}) } as EnrichedProfile;
}

/** Bounds a session load so a stalled Firestore read cannot hold the page. */
export function withSessionDeadline<T>(op: Promise<T>, fallback: () => T): Promise<T> {
  return withDeadline(op, SESSION_BUDGET_MS, fallback);
}

export type { AdminApprovalStatus };
