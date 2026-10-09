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
  "approval_status" | "admin_role_id" | "archived_at" | "role"
>;

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
          },
          failed: false,
        };
      });

    return await withDeadline(op, MIDDLEWARE_QUERY_BUDGET_MS, () => FAILED as GuardedRead<ProxyProfileRow>);
  } catch {
    return FAILED as GuardedRead<ProxyProfileRow>;
  }
}
