import "server-only";

import { cookies } from "next/headers";
import { loadMutationSession, type EpochSession } from "@/lib/auth/epoch-session";
import type { Permission } from "@/lib/auth/permissions";
import { STAFF_SESSION_COOKIE, verifyStaffSessionCookie } from "@/lib/firebase/session";
import { staffDb } from "@/lib/firebase/staff-db";

/**
 * Write gate. Verifies the session cookie with checkRevoked true, then reads a
 * fresh profile and fresh ticks. The epoch cache is not consulted.
 */
export async function requireMutationAuth(
  permission?: Permission,
): Promise<{ session: EpochSession } | { error: "not_authorized" | "not_configured" }> {
  const cookieStore = await cookies();
  const cookie = cookieStore.get(STAFF_SESSION_COOKIE)?.value;
  const probe = await verifyStaffSessionCookie(cookie, { checkRevoked: true });
  if (probe.unavailable || !probe.uid) {
    return { error: "not_authorized" };
  }
  const db = await staffDb();
  if (!db) return { error: "not_configured" };
  const loaded = await loadMutationSession(db, probe, permission);
  if (loaded.unavailable || loaded.revoked || loaded.denied || !loaded.session) {
    return { error: "not_authorized" };
  }
  return { session: loaded.session };
}
