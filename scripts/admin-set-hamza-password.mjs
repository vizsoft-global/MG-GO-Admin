#!/usr/bin/env node
/**
 * Inspect a staff auth user, set a temporary password, and prove the sign-in works.
 *
 * Dry-run by default (inspect only). `--apply` enables the account, sets the
 * password, bumps the access epoch and verifies via Identity Toolkit REST.
 *
 * Usage:
 *   node scripts/admin-set-hamza-password.mjs
 *   node scripts/admin-set-hamza-password.mjs --apply
 *   ADMIN_NEW_PASSWORD='...' node scripts/admin-set-hamza-password.mjs --apply
 */
import { randomBytes } from "node:crypto";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { loadEnv, loadServiceAccount, assertProd } from "./perf-env.mjs";

const EMAIL = "hamza@mg-kwt.com";
const apply = process.argv.includes("--apply");
const env = loadEnv();
const account = loadServiceAccount(env);
assertProd(account);

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: account.projectId,
      clientEmail: account.clientEmail,
      privateKey: account.privateKey,
    }),
    projectId: account.projectId,
  });
}

const auth = getAuth();
const db = getFirestore(undefined, "default");

function generatePassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = randomBytes(14);
  let out = "";
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  return `${out}!7`;
}

const password = (process.env.ADMIN_NEW_PASSWORD ?? "").trim() || generatePassword();

let user = null;
try {
  user = await auth.getUserByEmail(EMAIL);
} catch (error) {
  if (error?.code !== "auth/user-not-found") throw error;
}

console.log("Auth user");
console.log(
  JSON.stringify(
    {
      email: EMAIL,
      exists: Boolean(user),
      uid: user?.uid ?? null,
      disabled: user?.disabled ?? null,
      emailVerified: user?.emailVerified ?? null,
      providers: user?.providerData?.map((p) => p.providerId) ?? [],
      lastSignIn: user?.metadata?.lastSignInTime ?? null,
      createdAt: user?.metadata?.creationTime ?? null,
    },
    null,
    2,
  ),
);

if (user) {
  const profileSnap = await db.doc(`profiles/${user.uid}`).get();
  const profile = profileSnap.data() ?? {};
  const roleSnap = profile.admin_role_id
    ? await db.doc(`admin_roles/${profile.admin_role_id}`).get()
    : null;
  const tickDoc = await db.doc(`admin_user_permissions/${user.uid}`).get();
  const tickSlugs = Array.isArray(tickDoc.get("permission_slugs")) ? tickDoc.get("permission_slugs") : [];
  console.log("Profile");
  console.log(
    JSON.stringify(
      {
        role: profile.role ?? null,
        approval_status: profile.approval_status ?? null,
        access_kind: profile.access_kind ?? null,
        admin_role_id: profile.admin_role_id ?? null,
        admin_role_slug: roleSnap?.data()?.slug ?? null,
        archived_at: profile.archived_at ?? null,
        user_ticks: tickSlugs.length,
      },
      null,
      2,
    ),
  );
}

if (!user) {
  console.error("No auth user for this email — cannot set a password.");
  process.exit(1);
}

if (!apply) {
  console.log("\nDry run. Re-run with --apply to reset the password.");
  console.log(`Would set password: ${password}`);
  process.exit(0);
}

await auth.updateUser(user.uid, {
  password,
  disabled: false,
});
console.log("\nAuth user updated (password set, enabled).");

const profileRef = db.doc(`profiles/${user.uid}`);
const profileSnap = await profileRef.get();
if (profileSnap.exists) {
  const profile = profileSnap.data() ?? {};
  if (profile.approval_status !== "approved" || !profile.admin_role_id) {
    console.warn(
      `Profile is not approved/admin-role (approval=${profile.approval_status}, role=${profile.admin_role_id}).`,
    );
  }
  await profileRef.set({ updated_at: new Date().toISOString() }, { merge: true });
}
await db.doc("auth_epochs/current").set(
  { access: FieldValue.increment(1), updated_at: new Date().toISOString() },
  { merge: true },
);

const apiKey = env.NEXT_PUBLIC_FIREBASE_API_KEY;
const response = await fetch(
  `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password, returnSecureToken: true }),
  },
);
const body = await response.json();
if (response.ok) {
  console.log(`Sign-in verified for ${EMAIL} (uid ${body.localId}).`);
} else {
  console.error(`Sign-in FAILED: ${body?.error?.message ?? response.status}`);
}

console.log("\nCredentials");
console.log(`  Email:    ${EMAIL}`);
console.log(`  Password: ${password}`);
console.log("  Change it after the first sign-in.");
