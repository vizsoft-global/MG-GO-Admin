#!/usr/bin/env node
/**
 * Grant the same admin panel access `fullaccess@vizsoft.in` holds to a list of staff.
 *
 * Dry-run by default. `--apply` writes:
 *   - profiles/{uid}: role=staff, approved, access_kind=manager, same admin_role_id
 *   - auth_epochs/current.access += 1 (drops every cached session within 5s)
 *
 * Usage:
 *   node scripts/admin-grant-full-access.mjs
 *   node scripts/admin-grant-full-access.mjs --apply
 */
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { loadEnv, loadServiceAccount, assertProd } from "./perf-env.mjs";

const REFERENCE_EMAIL = "fullaccess@vizsoft.in";
const TARGET_EMAILS = [
  "chethan@vizsoft.in",
  "vijay@mg-kwt.com",
  "shimal@mg-kwt.com",
  "admin@vizsoft.in",
  "saleh.ahmed@mg-kwt.com",
  "robin@mg-kwt.com",
  "razan@mg-kwt.com",
  "qa@mg-kwd.com",
  "mustafa@injazflow.com",
  "mohamed.hassan@injazflow.com",
  "mahadkalanzi@mg-kwt.com",
  "hrishikesh@mg-kwt.com",
  "hamza@mg-kwt.com",
  "aliatef@mg-kwt.com",
  "ahmedali@injazflow.com",
];

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

async function findByEmail(email) {
  try {
    return await auth.getUserByEmail(email);
  } catch (error) {
    if (error?.code === "auth/user-not-found") return null;
    throw error;
  }
}

const reference = await findByEmail(REFERENCE_EMAIL);
if (!reference) {
  console.error(`Reference user ${REFERENCE_EMAIL} not found — aborting.`);
  process.exit(1);
}
const referenceProfile = (await db.doc(`profiles/${reference.uid}`).get()).data() ?? {};
const referenceRoleId = referenceProfile.admin_role_id ?? null;
const referenceRole = referenceRoleId
  ? ((await db.doc(`admin_roles/${referenceRoleId}`).get()).data() ?? {})
  : {};
const referenceTickDoc = await db.doc(`admin_user_permissions/${reference.uid}`).get();
const referenceTicks = Array.isArray(referenceTickDoc.get("permission_slugs"))
  ? referenceTickDoc.get("permission_slugs")
  : [];

console.log("Reference access");
console.log(
  JSON.stringify(
    {
      email: REFERENCE_EMAIL,
      uid: reference.uid,
      disabled: reference.disabled,
      role: referenceProfile.role ?? null,
      approval_status: referenceProfile.approval_status ?? null,
      access_kind: referenceProfile.access_kind ?? null,
      admin_role_id: referenceRoleId,
      admin_role_slug: referenceRole.slug ?? null,
      admin_role_super: referenceRole.is_super_admin ?? null,
      archived_at: referenceProfile.archived_at ?? null,
      user_tick_count: referenceTicks.length,
    },
    null,
    2,
  ),
);

const changes = [];
for (const email of TARGET_EMAILS) {
  const user = await findByEmail(email);
  if (!user) {
    changes.push({ email, uid: null, action: "missing_auth_user" });
    continue;
  }
  const snap = await db.doc(`profiles/${user.uid}`).get();
  const profile = snap.data() ?? {};
  changes.push({
    email,
    uid: user.uid,
    action: "grant",
    disabled: user.disabled,
    before: {
      role: profile.role ?? null,
      approval_status: profile.approval_status ?? null,
      access_kind: profile.access_kind ?? null,
      admin_role_id: profile.admin_role_id ?? null,
      archived_at: profile.archived_at ?? null,
    },
  });
}

console.log(`\nTargets (${changes.length})`);
for (const row of changes) {
  console.log(
    `${row.action.padEnd(18)} ${row.email.padEnd(30)} ${row.uid ?? "-"} ${
      row.before ? JSON.stringify(row.before) : ""
    }`,
  );
}

if (!apply) {
  console.log("\nDry run. Re-run with --apply to write.");
  process.exit(0);
}

let granted = 0;
let skipped = 0;
for (const row of changes) {
  if (!row.uid) {
    skipped += 1;
    continue;
  }
  if (row.disabled) {
    await auth.updateUser(row.uid, { disabled: false });
  }
  await db.doc(`profiles/${row.uid}`).set(
    {
      role: "staff",
      approval_status: "approved",
      approved_at: new Date().toISOString(),
      admin_role_id: referenceRoleId,
      access_kind: "manager",
      archived_at: null,
      updated_at: new Date().toISOString(),
    },
    { merge: true },
  );
  granted += 1;
  console.log(`granted ${row.email}`);
}

if (granted > 0) {
  await db.doc("auth_epochs/current").set(
    { access: FieldValue.increment(1), updated_at: new Date().toISOString() },
    { merge: true },
  );
  console.log(`auth_epochs/current.access bumped (${granted} grants)`);
}
console.log(`\nDone. granted=${granted} skipped=${skipped}`);
