import { getFirebaseAuth } from "./admin";
import { withDeadline } from "@/lib/async/deadline";

/** Firebase's conventional session-cookie name. */
export const STAFF_SESSION_COOKIE = "__session";

/** Firebase allows 5 minutes to 2 weeks. Five days matches the old session feel. */
export const SESSION_DURATION_MS = 5 * 24 * 60 * 60 * 1000;

/** Verification has to fit inside the proxy's 25s Routing-Middleware budget. */
export const MIDDLEWARE_SESSION_BUDGET_MS = 3_000;

export type StaffClaims = {
  staff?: boolean;
  superAdmin?: boolean;
  roleId?: string | null;
};

export type StaffProbe = {
  uid: string | null;
  claims: StaffClaims | null;
  /**
   * The session could not be verified — unproven, not absent. A verifier that
   * never answered must not be read as a signed-out admin.
   */
  unavailable: boolean;
  /** Session cookie `auth_time` in milliseconds. Null when the cookie was not verified. */
  authTimeMs: number | null;
};

export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};

/**
 * Exchanges a freshly minted ID token for a long-lived session cookie.
 *
 * Returns null when Firebase Admin is not configured; the caller decides
 * whether that is a 500 or an unauthenticated path.
 */
export async function createStaffSessionCookie(
  idToken: string,
  expiresInMs = SESSION_DURATION_MS,
): Promise<string | null> {
  const auth = await getFirebaseAuth();
  if (!auth) return null;
  return auth.createSessionCookie(idToken, { expiresIn: expiresInMs });
}

/**
 * Verifies the cookie. `checkRevoked` defaults to false: page and proxy reads
 * compare auth_time with sessions_revoked_at instead. Mutations pass
 * `checkRevoked: true` through requireMutationAuth.
 * A bad, expired or revoked cookie is a real "no session"; a stall is `unavailable`.
 */
export async function verifyStaffSessionCookie(
  cookie: string | undefined | null,
  options: { timeoutMs?: number; checkRevoked?: boolean } = {},
): Promise<StaffProbe> {
  const checkRevoked = options.checkRevoked === true;
  if (!cookie) return { uid: null, claims: null, unavailable: false, authTimeMs: null };

  const auth = await getFirebaseAuth();
  if (!auth) return { uid: null, claims: null, unavailable: true, authTimeMs: null };

  const attempt: Promise<StaffProbe> = auth
    .verifySessionCookie(cookie, checkRevoked)
    .then((decoded): StaffProbe => {
      const claims = decoded as unknown as StaffClaims & { uid: string };
      const authTime = (decoded as { auth_time?: number }).auth_time;
      return {
        uid: decoded.uid,
        claims,
        unavailable: false,
        authTimeMs: typeof authTime === "number" ? authTime * 1000 : null,
      };
    })
    .catch((error: unknown): StaffProbe => {
      // The verifier rejects a bad/expired/revoked cookie with a specific
      // Firebase error. Those are facts about the session.
      const code = (error as { code?: string })?.code ?? "";
      if (code.startsWith("auth/")) {
        return { uid: null, claims: null, unavailable: false, authTimeMs: null };
      }
      return { uid: null, claims: null, unavailable: true, authTimeMs: null };
    });

  const ms = options.timeoutMs;
  if (ms === undefined) return attempt;

  return withDeadline(attempt, ms, () => ({
    uid: null,
    claims: null,
    unavailable: true,
    authTimeMs: null,
  }));
}
