import { NextResponse, type NextRequest } from "next/server";
import {
  STAFF_SESSION_COOKIE,
  MIDDLEWARE_SESSION_BUDGET_MS,
  verifyStaffSessionCookie,
  type StaffProbe,
} from "@/lib/firebase/session";
import { getFirebaseFirestore } from "@/lib/firebase/admin";
import { APP_SETTINGS_DOC_ID, COLLECTIONS } from "@/lib/firebase/db";
import { MIDDLEWARE_QUERY_BUDGET_MS } from "@/lib/async/deadline";
import { withDeadline } from "@/lib/async/deadline";
import { AUTH_EPOCHS_DOC_ID, millisOf, sessionRevokedForRead } from "@/lib/auth/epoch-cache";
import type { ProfileDoc } from "@/lib/firebase/types";

export type StaffSessionContext = {
  response: NextResponse;
  probe: StaffProbe;
};

/** Identifies the caller from the session cookie. */
export async function updateStaffSession(
  request: NextRequest,
  response: NextResponse = NextResponse.next({ request }),
): Promise<StaffSessionContext> {
  const cookie = request.cookies.get(STAFF_SESSION_COOKIE)?.value;
  const probe = await verifyStaffSessionCookie(cookie, {
    timeoutMs: MIDDLEWARE_SESSION_BUDGET_MS,
    checkRevoked: false,
  });
  return { response, probe };
}

/**
 * A read that distinguishes "no document" from "could not read".
 *
 * A missing profile is grounds for signing an admin out, so a transient failure
 * that also reads as missing would be a logout caused by a backend blip. The
 * two outcomes have to be different types for that to be expressible.
 */
export type GuardedRead<T> =
  | { data: T | null; failed: false }
  | { data: null; failed: true };

const FAILED: GuardedRead<never> = { data: null, failed: true };

export type ProxyOpsSettings = {
  super_admin_claimed: boolean | null;
  maintenance_mode: boolean | null;
};

export async function readProxyOpsSettings(): Promise<GuardedRead<ProxyOpsSettings>> {
  try {
    const db = await getFirebaseFirestore();
    if (!db) return FAILED;

    const op = db
      .collection(COLLECTIONS.appSettings)
      .doc(APP_SETTINGS_DOC_ID)
      .get()
      .then((snap): GuardedRead<ProxyOpsSettings> => {
        const data = snap.data();
        if (!data) return { data: null, failed: false };
        return {
          data: {
            super_admin_claimed: data.super_admin_claimed ?? null,
            maintenance_mode: data.maintenance_mode ?? null,
          },
          failed: false,
        };
      });

    return await withDeadline(op, MIDDLEWARE_QUERY_BUDGET_MS, () => FAILED as GuardedRead<ProxyOpsSettings>);
  } catch {
    return FAILED as GuardedRead<ProxyOpsSettings>;
  }
}

export type ProxyProfileRow = Pick<
  ProfileDoc,
  "approval_status" | "admin_role_id" | "archived_at" | "role" | "sessions_revoked_at"
>;

export type ProxyGate = {
  ops: GuardedRead<ProxyOpsSettings>;
  profile: GuardedRead<ProxyProfileRow>;
  revoked: boolean;
};

const EMPTY_GATE: ProxyGate = { ops: FAILED, profile: FAILED, revoked: false };

/**
 * One getAll of the epoch doc, the profile, and app settings.
 * The epoch document is read even though the proxy does not cache roles: the
 * page cache keys off that same counter, and a split read would let a revoke
 * land between the two. A deadline here fails the profile and the settings
 * together, which is more fail-open than two independent reads.
 */
export async function readProxyGate(uid: string, authTimeMs: number | null): Promise<ProxyGate> {
  try {
    const db = await getFirebaseFirestore();
    if (!db) return EMPTY_GATE;

    const op = db
      .getAll(
        db.collection(COLLECTIONS.authEpochs).doc(AUTH_EPOCHS_DOC_ID),
        db.collection(COLLECTIONS.profiles).doc(uid),
        db.collection(COLLECTIONS.appSettings).doc(APP_SETTINGS_DOC_ID),
      )
      .then((snaps): ProxyGate => {
        const profileSnap = snaps[1];
        const settingsSnap = snaps[2];
        let profile: GuardedRead<ProxyProfileRow>;
        if (!profileSnap?.exists) {
          profile = { data: null, failed: false };
        } else {
          const data = profileSnap.data() as Partial<ProfileDoc>;
          profile = {
            data: {
              approval_status: data.approval_status ?? "pending",
              admin_role_id: data.admin_role_id ?? null,
              archived_at: data.archived_at ?? null,
              role: data.role ?? "staff",
              sessions_revoked_at: data.sessions_revoked_at ?? null,
            },
            failed: false,
          };
        }
        const settingsData = settingsSnap?.data();
        const ops: GuardedRead<ProxyOpsSettings> = settingsData
          ? {
              data: {
                super_admin_claimed: settingsData.super_admin_claimed ?? null,
                maintenance_mode: settingsData.maintenance_mode ?? null,
              },
              failed: false,
            }
          : { data: null, failed: false };
        const revoked =
          profile.failed === false &&
          sessionRevokedForRead(authTimeMs, millisOf(profile.data?.sessions_revoked_at));
        return { ops, profile, revoked };
      });

    return await withDeadline(op, MIDDLEWARE_QUERY_BUDGET_MS, () => EMPTY_GATE);
  } catch {
    return EMPTY_GATE;
  }
}

export async function readProxyProfile(uid: string): Promise<GuardedRead<ProxyProfileRow>> {
  try {
    const db = await getFirebaseFirestore();
    if (!db) return FAILED;

    const op = db
      .collection(COLLECTIONS.profiles)
      .doc(uid)
      .get()
      .then((snap): GuardedRead<ProxyProfileRow> => {
        if (!snap.exists) return { data: null, failed: false };
        const data = snap.data() as Partial<ProfileDoc>;
        return {
          data: {
            approval_status: data.approval_status ?? "pending",
            admin_role_id: data.admin_role_id ?? null,
            archived_at: data.archived_at ?? null,
            role: data.role ?? "staff",
            sessions_revoked_at: data.sessions_revoked_at ?? null,
          },
          failed: false,
        };
      });

    return await withDeadline(op, MIDDLEWARE_QUERY_BUDGET_MS, () => FAILED as GuardedRead<ProxyProfileRow>);
  } catch {
    return FAILED as GuardedRead<ProxyProfileRow>;
  }
}
