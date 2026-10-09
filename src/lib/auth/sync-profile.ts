import type { Firestore, Transaction } from "firebase-admin/firestore";
import { canAccessAdminPanel } from "@/lib/auth/permissions";
import { toAuthProfile, type EnrichedProfile } from "@/lib/auth/profile-auth";
import { getAppOpsSettings } from "@/lib/auth/app-settings";
import { COLLECTIONS } from "@/lib/firebase/db";
import type { AdminRoleDoc, ProfileDoc } from "@/lib/firebase/types";

export async function syncAdminProfile(
  db: Firestore,
  user: { id: string; email?: string | null },
  locale = "en",
  fullName?: string | null,
): Promise<
  | { ok: true; approvalStatus: "pending" | "approved" | "rejected" }
  | { ok: false; reason: "not_authorized" | "no_profile" }
> {
  if (!user.email) {
    return { ok: false, reason: "not_authorized" };
  }

  const email = user.email.toLowerCase();
  const ops = await getAppOpsSettings();

  const profileRef = db.collection(COLLECTIONS.profiles).doc(user.id);
  const existingSnap = await profileRef.get();
  const existing = (existingSnap.data() ?? null) as ProfileDoc | null;

  if (existing?.approval_status === "rejected") {
    return { ok: false, reason: "not_authorized" };
  }

  const allowlistSnap = await db.collection(COLLECTIONS.adminAllowlist).doc(email).get();
  const allowlistRole = (allowlistSnap.data()?.role as string | undefined) ?? null;

  const isExistingApproved = existing?.approval_status === "approved" && existing.admin_role_id;

  if (!allowlistRole && !isExistingApproved && ops.superAdminClaimed) {
    if (!existing) {
      await profileRef.set(
        {
          id: user.id,
          email,
          full_name: fullName ?? null,
          role: "staff",
          locale,
          approval_status: "pending",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { merge: true },
      );
      return { ok: true, approvalStatus: "pending" };
    }
  }

  const role = allowlistRole ?? existing?.role ?? "staff";

  await profileRef.set(
    {
      id: user.id,
      email,
      full_name: fullName ?? existing?.full_name ?? null,
      avatar_url: existing?.avatar_url ?? null,
      role,
      locale: existing?.locale ?? locale,
      admin_role_id: existing?.admin_role_id ?? null,
      approval_status: existing?.approval_status ?? "pending",
      updated_at: new Date().toISOString(),
    },
    { merge: true },
  );

  const profileSnap = await profileRef.get();
  if (!profileSnap.exists) {
    return { ok: false, reason: "no_profile" };
  }

  const enriched = { id: user.id, ...(profileSnap.data() ?? {}) } as EnrichedProfile;
  const isSuperAdmin = await resolveIsSuperAdmin(db, enriched.admin_role_id);
  const authProfile = toAuthProfile(enriched, isSuperAdmin);

  if (enriched.approval_status === "pending") {
    return { ok: true, approvalStatus: "pending" };
  }

  if (!canAccessAdminPanel(authProfile)) {
    return { ok: false, reason: "not_authorized" };
  }

  return { ok: true, approvalStatus: "approved" };
}

export async function resolveIsSuperAdmin(
  db: Firestore,
  roleId: string | null,
): Promise<boolean> {
  if (!roleId) return false;
  const snap = await db.collection(COLLECTIONS.adminRoles).doc(roleId).get();
  return (snap.data() as AdminRoleDoc | undefined)?.is_super_admin === true;
}

/**
 * Claims the super admin in one transaction.
 *
 * `super_admin_claimed` and `super_admin_user_id` are one fact, so they move
 * together — a crash between the two writes would leave the panel convinced a
 * claim happened while no user holds it, which locks out the claim page for
 * everyone.
 */
export async function claimSuperAdminAtomic(
  db: Firestore,
  userId: string,
): Promise<boolean> {
  const settingsRef = db.collection(COLLECTIONS.appSettings).doc("1");
  const profileRef = db.collection(COLLECTIONS.profiles).doc(userId);

  return db.runTransaction(async (tx: Transaction) => {
    const settingsSnap = await tx.get(settingsRef);
    const claimed = settingsSnap.data()?.super_admin_claimed === true;
    if (claimed) return false;

    tx.set(
      settingsRef,
      {
        super_admin_claimed: true,
        super_admin_user_id: userId,
        updated_at: new Date().toISOString(),
      },
      { merge: true },
    );
    tx.set(profileRef, { access_kind: "manager", updated_at: new Date().toISOString() }, { merge: true });
    return true;
  });
}
