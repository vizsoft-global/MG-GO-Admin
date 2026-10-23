import { cache } from "react";
import { cookies } from "next/headers";
import { getFirebaseFirestore } from "@/lib/firebase/admin";
import {
  STAFF_SESSION_COOKIE,
  verifyStaffSessionCookie,
} from "@/lib/firebase/session";
import { COLLECTIONS } from "@/lib/firebase/db";
import { withDeadline } from "@/lib/async/deadline";
import type { EnrichedProfile } from "@/lib/auth/profile-auth";
import type { AdminApprovalStatus } from "@/lib/auth/permissions";
import { asEpochReader, getEpochCache, type EpochCounters } from "@/lib/auth/epoch-cache";
import { loadReadSession } from "@/lib/auth/epoch-session";
import type { StaffAccessKind } from "@/lib/auth/staff-access";

export type SessionUser = {
  id: string;
  email: string | null;
  profile: EnrichedProfile;
  permissions: Set<string>;
  isSuperAdmin: boolean;
  isManager: boolean;
  accessKind: StaffAccessKind | null;
  partnerProjectKey: string | null;
  adminRoleSlug: string;
  epochs: EpochCounters;
};

export type SessionOutcome = {
  session: SessionUser | null;
  /** The auth backend could not be reached — treat as unknown, not signed out. */
  unavailable: boolean;
  /** Profile exists but this account may not enter the panel. */
  notAuthorized: boolean;
};

const SESSION_BUDGET_MS = 8_000;

/**
 * Page and layout cookie verify. The proxy stays on the 3s middleware budget.
 * A cold Admin init plus `verifySessionCookie` routinely exceeds 3s, and that
 * path throws `auth_backend_unavailable` into the locale error boundary.
 */
const PAGE_SESSION_VERIFY_MS = 15_000;

async function loadSessionOutcome(): Promise<SessionOutcome> {
  try {
    return await loadSessionOutcomeUnsafe();
  } catch {
    return { session: null, unavailable: true, notAuthorized: false };
  }
}

async function loadSessionOutcomeUnsafe(): Promise<SessionOutcome> {
  const cookieStore = await cookies();
  const cookie = cookieStore.get(STAFF_SESSION_COOKIE)?.value;

  const probe = await verifyStaffSessionCookie(cookie, {
    timeoutMs: PAGE_SESSION_VERIFY_MS,
    checkRevoked: false,
  });

  // The verifier did not answer, so the session is unproven rather than absent.
  // Throwing would be a logout caused by a backend blip.
  if (!probe.uid) {
    return { session: null, unavailable: probe.unavailable, notAuthorized: false };
  }

  const db = await getFirebaseFirestore();
  if (!db) {
    return { session: null, unavailable: true, notAuthorized: false };
  }

  const loaded = await loadReadSession(asEpochReader(db), getEpochCache(), probe);
  return {
    session: loaded.session,
    unavailable: loaded.unavailable,
    notAuthorized: loaded.notAuthorized,
  };
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
