import { createHash } from "node:crypto";
import type { SessionOutcome, SessionUser } from "@/lib/auth/get-session";

type MemoryEntry = {
  session: SessionUser;
  storedAt: number;
};

const STORE = new Map<string, MemoryEntry>();
const TTL_MS = 5 * 60_000;
const MAX_ENTRIES = 200;

export function cookieMemoryKey(cookie: string): string {
  return createHash("sha256").update(cookie).digest("hex");
}

function cloneSession(session: SessionUser): SessionUser {
  return {
    ...session,
    permissions: new Set(session.permissions),
    epochs: { ...session.epochs },
  };
}

function evict(): void {
  const now = Date.now();
  for (const [key, entry] of STORE) {
    if (now - entry.storedAt > TTL_MS) STORE.delete(key);
  }
  while (STORE.size > MAX_ENTRIES) {
    const oldest = STORE.keys().next().value;
    if (oldest === undefined) break;
    STORE.delete(oldest);
  }
}

export function rememberReadSession(cookie: string, session: SessionUser): void {
  if (!cookie || !session.id) return;
  evict();
  STORE.set(cookieMemoryKey(cookie), { session: cloneSession(session), storedAt: Date.now() });
}

export function recallReadSession(cookie: string): SessionUser | null {
  if (!cookie) return null;
  const entry = STORE.get(cookieMemoryKey(cookie));
  if (!entry) return null;
  if (Date.now() - entry.storedAt > TTL_MS) {
    STORE.delete(cookieMemoryKey(cookie));
    return null;
  }
  return cloneSession(entry.session);
}

/**
 * A timed-out Auth/Firestore hop must not wipe a cookie we already verified
 * on this isolate. A real logout (`unavailable: false`, no session) wins.
 */
export function applyRememberedSession(
  outcome: SessionOutcome,
  remembered: SessionUser | null,
): SessionOutcome {
  if (outcome.session) return { ...outcome, unavailable: false };
  if (outcome.notAuthorized) return outcome;
  if (remembered && outcome.unavailable) {
    return { session: remembered, unavailable: false, notAuthorized: false };
  }
  return outcome;
}

export function clearReadSessionMemory(): void {
  STORE.clear();
}
