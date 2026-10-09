"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { updateTag } from "next/cache";
import * as Sentry from "@sentry/nextjs";
import { getFirebaseAuth, getFirebaseFirestore } from "@/lib/firebase/admin";
import {
  SESSION_COOKIE_OPTIONS,
  SESSION_DURATION_MS,
  STAFF_SESSION_COOKIE,
  createStaffSessionCookie,
  verifyStaffSessionCookie,
} from "@/lib/firebase/session";
import {
  revokeStaffSessions,
  resetPasswordWithCode,
  sendStaffPasswordReset,
  setStaffPassword,
  signInStaffWithPassword,
} from "@/lib/firebase/staff-auth";
import { claimSuperAdminAtomic, syncAdminProfile } from "@/lib/auth/sync-profile";
import { getAppOpsSettings } from "@/lib/auth/app-settings";
import { logAdminAuthEvent } from "@/lib/audit/log-admin-activity";

/** Mints the session cookie from a fresh ID token. */
async function establishSession(idToken: string): Promise<boolean> {
  const cookie = await createStaffSessionCookie(idToken, SESSION_DURATION_MS);
  if (!cookie) return false;
  const jar = await cookies();
  jar.set(STAFF_SESSION_COOKIE, cookie, {
    ...SESSION_COOKIE_OPTIONS,
    maxAge: Math.floor(SESSION_DURATION_MS / 1000),
  });
  return true;
}

export async function signInWithEmail(
  locale: string,
  formData: FormData,
): Promise<{ error?: string }> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "missing_fields" };
  }

  const result = await signInStaffWithPassword(email, password);

  if (!result.ok) {
    void logAdminAuthEvent({
      action: "auth",
      routeName: "signInWithEmail",
      success: false,
      context: { email },
      errorMessage: result.error,
    });
    return { error: result.error };
  }

  const db = await getFirebaseFirestore();
  if (!db) {
    return { error: "invalid_credentials" };
  }

  const sync = await syncAdminProfile(db, { id: result.uid, email }, locale);

  if (!sync.ok) {
    void logAdminAuthEvent({
      action: "auth",
      routeName: "signInWithEmail",
      success: false,
      context: { email, reason: sync.reason },
      adminUserId: result.uid,
    });
    return { error: sync.reason === "not_authorized" ? "not_authorized" : "invalid_credentials" };
  }

  // Only mint the cookie once the profile says this account may enter. Ordering
  // it the other way would hand a session to a rejected account and let the
  // proxy do the refusing.
  if (!(await establishSession(result.idToken))) {
    return { error: "invalid_credentials" };
  }

  void logAdminAuthEvent({
    action: "auth",
    routeName: "signInWithEmail",
    success: true,
    context: { email, approvalStatus: sync.approvalStatus },
    adminUserId: result.uid,
  });

  const ops = await getAppOpsSettings();

  if (!ops.superAdminClaimed) {
    redirect(`/${locale}/setup/claim-super-admin`);
  }

  if (sync.approvalStatus === "pending") {
    redirect(`/${locale}/pending-approval`);
  }

  redirect(`/${locale}/dashboard`);
}

export async function signUp(
  locale: string,
  formData: FormData,
): Promise<{ error?: string; needsConfirmation?: boolean }> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const fullName = String(formData.get("fullName") ?? "").trim();

  if (!email || !password || !fullName) {
    return { error: "missing_fields" };
  }

  const auth = await getFirebaseAuth();
  if (!auth) return { error: "signup_failed" };

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  let uid: string;
  try {
    const user = await auth.createUser({
      email,
      password,
      displayName: fullName,
      emailVerified: false,
    });
    uid = user.uid;
  } catch (error) {
    const code = (error as { code?: string })?.code ?? "";
    if (code.includes("email-already-exists")) return { error: "email_exists" };
    if (code.includes("invalid-email")) return { error: "invalid_email" };
    if (code.includes("invalid-password") || code.includes("weak-password")) {
      return { error: "weak_password" };
    }
    return { error: "signup_failed" };
  }

  const db = await getFirebaseFirestore();
  if (!db) return { error: "signup_failed" };

  // The pending staff profile is written here, which is what the Postgres
  // on_auth_user_created trigger used to do.
  await db.collection("profiles").doc(uid).set(
    {
      id: uid,
      email,
      full_name: fullName,
      role: "staff",
      locale,
      approval_status: "pending",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { merge: true },
  );

  void logAdminAuthEvent({
    action: "auth",
    routeName: "signUp",
    success: true,
    context: { email, appUrl },
    adminUserId: uid,
  });

  return { needsConfirmation: true };
}

export async function claimSuperAdmin(locale: string): Promise<{ error?: string }> {
  const jar = await cookies();
  const cookie = jar.get(STAFF_SESSION_COOKIE)?.value;
  const probe = await verifyStaffSessionCookie(cookie);

  if (!probe.uid) {
    return { error: "not_authenticated" };
  }

  const db = await getFirebaseFirestore();
  if (!db) {
    return { error: "claim_failed" };
  }

  const claimed = await claimSuperAdminAtomic(db, probe.uid);
  if (!claimed) {
    return { error: "claim_failed" };
  }

  // Claims are what the proxy and the session read, so they move in the same
  // step as the Firestore write — a claim the panel cannot see is not a claim.
  const auth = await getFirebaseAuth();
  if (auth) {
    await auth.setCustomUserClaims(probe.uid, {
      staff: true,
      superAdmin: true,
      roleId: null,
    });
  }

  updateTag("app-settings");
  updateTag("app-ops-settings");
  updateTag("admin-roles");

  redirect(`/${locale}/dashboard`);
}

export async function requestPasswordReset(
  locale: string,
  formData: FormData,
): Promise<{ error?: string; success?: boolean }> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email) {
    return { error: "missing_fields" };
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const sent = await sendStaffPasswordReset(
    email,
    `${appUrl}/${locale}/reset-password`,
  );
  if (!sent.ok) {
    return { error: "reset_failed" };
  }

  return { success: true };
}

/**
 * Sets a password either from an emailed `oobCode` or from an existing session.
 *
 * Both paths end in a minted session cookie, so a completed reset signs the
 * admin in rather than bouncing them to a login form to re-enter the password
 * they just chose.
 */
export async function updatePassword(
  locale: string,
  formData: FormData,
): Promise<{ error?: string; success?: boolean }> {
  const password = String(formData.get("password") ?? "");
  if (password.length < 8) {
    return { error: "weak_password" };
  }

  const oobCode = String(formData.get("oobCode") ?? "").trim();

  if (oobCode) {
    const result = await resetPasswordWithCode(oobCode, password);
    if (!result.ok) {
      return { error: result.error };
    }

    if (!(await establishSession(result.idToken))) {
      return { error: "update_failed" };
    }

    redirect(`/${locale}/dashboard`);
  }

  const jar = await cookies();
  const cookie = jar.get(STAFF_SESSION_COOKIE)?.value;
  const probe = await verifyStaffSessionCookie(cookie);

  if (!probe.uid) {
    return { error: "update_failed" };
  }

  const ok = await setStaffPassword(probe.uid, password);
  if (!ok) {
    return { error: "update_failed" };
  }

  return { success: true };
}

export async function signOut(locale: string) {
  const jar = await cookies();
  const cookie = jar.get(STAFF_SESSION_COOKIE)?.value;
  const probe = await verifyStaffSessionCookie(cookie);

  // Revoking refresh tokens is what makes sign-out mean something: clearing the
  // cookie alone leaves a valid session for anyone holding a copy of it.
  if (probe.uid) {
    await revokeStaffSessions(probe.uid);
  }

  jar.delete(STAFF_SESSION_COOKIE);
  Sentry.setUser(null);
  redirect(`/${locale}/login`);
}
