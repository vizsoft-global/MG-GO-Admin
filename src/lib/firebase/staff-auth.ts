import { getFirebaseAuth } from "./admin";

/**
 * Staff email/password sign-in against Identity Toolkit, server-side.
 *
 * The login form is a Next server action, so there is no browser Firebase
 * client in the flow: we call the REST endpoint with the web API key to mint an
 * ID token, then exchange it for a session cookie in `session.ts`. Keeping it
 * server-side means the password never reaches a client SDK and the cookie is
 * set by the same response that authenticates the admin.
 *
 * Error strings are mapped to the same codes the Supabase path returned, so the
 * login form's messages do not change.
 */

export type StaffSignInResult =
  | { ok: true; idToken: string; uid: string }
  | { ok: false; error: string };

function identityToolkitUrl(method: string): string | null {
  const key = process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.trim();
  if (!key) return null;
  return `https://identitytoolkit.googleapis.com/v1/accounts:${method}?key=${key}`;
}

function mapIdentityError(message: string): string {
  const m = message.toUpperCase();
  if (m.includes("EMAIL_NOT_FOUND") || m.includes("INVALID_PASSWORD") || m.includes("INVALID_LOGIN_CREDENTIALS")) {
    return "invalid_credentials";
  }
  if (m.includes("USER_DISABLED")) return "not_authorized";
  if (m.includes("INVALID_EMAIL")) return "invalid_email";
  if (m.includes("TOO_MANY_ATTEMPTS")) return "rate_limited";
  if (m.includes("PASSWORD_LOGIN_DISABLED")) return "invalid_credentials";
  return "invalid_credentials";
}

export async function signInStaffWithPassword(
  email: string,
  password: string,
): Promise<StaffSignInResult> {
  const url = identityToolkitUrl("signInWithPassword");
  if (!url) return { ok: false, error: "not_configured" };

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);

  if (!response) return { ok: false, error: "unavailable" };

  const body = (await response.json().catch(() => null)) as
    | { idToken?: string; localId?: string; error?: { message?: string } }
    | null;

  if (!response.ok || !body?.idToken || !body.localId) {
    return {
      ok: false,
      error: mapIdentityError(body?.error?.message ?? ""),
    };
  }

  return { ok: true, idToken: body.idToken, uid: body.localId };
}

export async function sendStaffPasswordReset(
  email: string,
  continueUrl?: string,
): Promise<{ ok: boolean }> {
  const url = identityToolkitUrl("sendOobCode");
  if (!url) return { ok: false };

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // `continueUrl` is only honoured for a domain whitelisted in the Firebase
    // console; `canHandleCodeInApp` is deliberately not set, so the default
    // action page still handles the code and then forwards to our page.
    body: JSON.stringify({
      requestType: "PASSWORD_RESET",
      email,
      ...(continueUrl ? { continueUrl } : {}),
    }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);

  return { ok: response?.ok === true };
}

export type PasswordResetResult =
  | { ok: true; idToken: string; uid: string }
  | { ok: false; error: string };

/**
 * Completes a reset from the emailed `oobCode`.
 *
 * The code is the proof of the mailbox, so this is the only place a new
 * password can be set without a session. It returns a fresh ID token, which the
 * caller exchanges for a session cookie — the reset link is a login, and
 * refusing to sign the admin in after a successful reset would make them type
 * the password they just chose a second time.
 */
export async function resetPasswordWithCode(
  oobCode: string,
  newPassword: string,
): Promise<PasswordResetResult> {
  const url = identityToolkitUrl("resetPassword");
  if (!url) return { ok: false, error: "not_configured" };

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ oobCode, newPassword }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);

  if (!response) return { ok: false, error: "unavailable" };

  const body = (await response.json().catch(() => null)) as
    | { idToken?: string; localId?: string; email?: string; error?: { message?: string } }
    | null;

  if (!response.ok || !body?.idToken || !body.localId) {
    const message = body?.error?.message ?? "";
    if (message.includes("EXPIRED_OOB_CODE")) return { ok: false, error: "expired_code" };
    if (message.includes("INVALID_OOB_CODE")) return { ok: false, error: "invalid_code" };
    if (message.includes("WEAK_PASSWORD") || message.includes("PASSWORD_DOES_NOT_MEET")) {
      return { ok: false, error: "weak_password" };
    }
    return { ok: false, error: "reset_failed" };
  }

  return { ok: true, idToken: body.idToken, uid: body.localId };
}

/** Server-side password change for the signed-in staff user. */
export async function setStaffPassword(uid: string, password: string): Promise<boolean> {
  const auth = await getFirebaseAuth();
  if (!auth) return false;
  await auth.updateUser(uid, { password });
  return true;
}

/** Ends every refresh token for the user — used on sign-out and staff revoke. */
export async function revokeStaffSessions(uid: string): Promise<void> {
  const auth = await getFirebaseAuth();
  if (!auth) return;
  await auth.revokeRefreshTokens(uid);
}
