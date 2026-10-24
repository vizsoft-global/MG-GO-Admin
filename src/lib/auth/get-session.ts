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
import {
  applyRememberedSession,
  recallReadSession,
  rememberReadSession,
} from "@/lib/auth/session-memory";
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
 * A cold Admin init plus `verifySessionCookie` routinely exceeds 15s after a
 * Server Action RSC refresh; one retry with a longer budget is cheaper than
 * throwing the locale error card.
 */
const PAGE_SESSION_VERIFY_MS = 20_000;
const PAGE_SESSION_RETRY_MS = 25_000;

async function cookieValue(): Promise<string> {
  const cookieStore = await cookies();
  return cookieStore.get(STAFF_SESSION_COOKIE)?.value ?? "";
}

function finishOutcome(cookie: string, outcome: SessionOutcome): SessionOutcome {
  const applied = applyRememberedSession(outcome, recallReadSession(cookie));
  if (applied.session && cookie) rememberReadSession(cookie, applied.session);
  return applied;
}

async function loadSessionOutcome(): Promise<SessionOutcome> {
  try {
    return await loadSessionOutcomeUnsafe();
  } catch {
    const cookie = await cookieValue().catch(() => "");
    return finishOutcome(cookie, { session: null, unavailable: true, notAuthorized: false });
  }
}

async function loadSessionOutcomeUnsafe(): Promise<SessionOutcome> {
  const cookie = await cookieValue();

  let probe = await verifyStaffSessionCookie(cookie, {
    timeoutMs: PAGE_SESSION_VERIFY_MS,
    checkRevoked: false,
  });
  if (!probe.uid && probe.unavailable && cookie) {
    probe = await verifyStaffSessionCookie(cookie, {
      timeoutMs: PAGE_SESSION_RETRY_MS,
      checkRevoked: false,
    });
  }

  // The verifier did not answer, so the session is unproven rather than absent.
  // A cookie this isolate already verified is restored instead of throwing.
  if (!probe.uid) {
    return finishOutcome(cookie, {
      session: null,
      unavailable: probe.unavailable,
      notAuthorized: false,
    });
  }

  const db = await getFirebaseFirestore();
  if (!db) {
    return finishOutcome(cookie, { session: null, unavailable: true, notAuthorized: false });
  }

  try {
    const loaded = await loadReadSession(asEpochReader(db), getEpochCache(), probe);
    return finishOutcome(cookie, {
      session: loaded.session,
      unavailable: loaded.unavailable,
      notAuthorized: loaded.notAuthorized,
    });
  } catch {
    return finishOutcome(cookie, { session: null, unavailable: true, notAuthorized: false });
  }
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
