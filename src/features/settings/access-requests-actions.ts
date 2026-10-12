"use server";

import { updateTag } from "next/cache";
import { writeWithEpoch } from "@/lib/auth/auth-epochs";
import { requireMutationAuth } from "@/lib/auth/require-mutation-auth";
import { callAdminFunction } from "@/lib/firebase/callable";
import { revokeStaffAccess } from "@/lib/firebase/staff-auth";
import { isAdminAccessRequestProfile } from "./access-request-eligibility";
import {
  expandRoleSlugsToUserTicks,
  isStaffMatrixSlug,
  parseStaffAccessKind,
  type StaffAccessKind,
} from "@/lib/auth/staff-access";
import { APP_SETTINGS_DOC_ID, COLLECTIONS } from "@/lib/firebase/db";
import { staffDb } from "@/lib/firebase/staff-db";

export type PendingStaffAccessRequest = {
  id: string;
  email: string | null;
  full_name: string | null;
  created_at: string;
};

function iso(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  if (
    typeof value === "object" &&
    "toDate" in value &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return null;
}

async function requireSuperAdmin() {
  const auth = await requireMutationAuth();
  if ("error" in auth) return auth;
  if (!auth.session.isSuperAdmin) {
    return { error: "not_authorized" as const };
  }
  return { session: auth.session };
}

export async function approveUser(
  userId: string,
  roleId: string,
  accessKind: StaffAccessKind = "user",
): Promise<{ error?: string; success?: boolean }> {
  const auth = await requireSuperAdmin();
  if ("error" in auth) return auth;

  const db = await staffDb();
  if (!db) return { error: "save_failed" };

  const roleSnap = await db.collection(COLLECTIONS.adminRoles).doc(roleId).get();
  const role = roleSnap.data();
  if (!roleSnap.exists || role?.is_super_admin === true) {
    return { error: "invalid_role" };
  }

  const profileSnap = await db.collection(COLLECTIONS.profiles).doc(userId).get();
  const profile = profileSnap.data();
  const driverSnap = await db.collection(COLLECTIONS.drivers).doc(userId).get();
  const email = typeof profile?.email === "string" ? profile.email : "";

  if (
    !email ||
    !isAdminAccessRequestProfile({
      role: typeof profile?.role === "string" ? profile.role : "",
      approval_status: typeof profile?.approval_status === "string" ? profile.approval_status : "",
      isDriver: driverSnap.exists,
    })
  ) {
    return { error: "user_not_found" };
  }

  const kind = parseStaffAccessKind(accessKind) ?? "user";
  const approvedAt = new Date();

  let ticks: string[] = [];
  if (kind === "user") {
    const rolePerms = await db.collection(COLLECTIONS.adminRolePermissions).doc(roleId).get();
    const raw = rolePerms.data()?.permission_slugs;
    const source = Array.isArray(raw) ? raw.filter((slug): slug is string => typeof slug === "string") : [];
    ticks = [...expandRoleSlugsToUserTicks(source)].filter(isStaffMatrixSlug);
  }
  const allowEmail = email.toLowerCase();

  try {
    await writeWithEpoch(db, "access", ({ tx }) => {
      tx.set(
        db.collection(COLLECTIONS.profiles).doc(userId),
        {
          admin_role_id: roleId,
          approval_status: "approved",
          role: "staff",
          access_kind: kind,
          approved_at: approvedAt,
          approved_by: auth.session.id,
          updated_at: approvedAt,
        },
        { merge: true },
      );
      tx.set(
        db.collection(COLLECTIONS.adminUserPermissions).doc(userId),
        { permission_slugs: ticks },
        { merge: true },
      );
      tx.set(
        db.collection(COLLECTIONS.adminAllowlist).doc(encodeURIComponent(allowEmail)),
        { email: allowEmail, role: "staff" },
        { merge: true },
      );
    });
  } catch {
    return { error: "save_failed" };
  }

  try {
    await callAdminFunction("syncStaffClaims", { uid: userId });
  } catch {
    // Approval is already saved; claims refresh must not report it as failed.
  }
  updateTag("admin-roles");
  return { success: true };
}

export async function rejectUser(userId: string): Promise<{ error?: string; success?: boolean }> {
  const auth = await requireSuperAdmin();
  if ("error" in auth) return auth;

  const db = await staffDb();
  if (!db) return { error: "save_failed" };

  const profileSnap = await db.collection(COLLECTIONS.profiles).doc(userId).get();
  const profile = profileSnap.data();
  const driverSnap = await db.collection(COLLECTIONS.drivers).doc(userId).get();

  if (
    !profile ||
    !isAdminAccessRequestProfile({
      role: typeof profile.role === "string" ? profile.role : "",
      approval_status: typeof profile.approval_status === "string" ? profile.approval_status : "",
      isDriver: driverSnap.exists,
    })
  ) {
    return { error: "user_not_found" };
  }

  try {
    await revokeStaffAccess(userId, "access_request_rejected");
  } catch {
    return { error: "save_failed" };
  }

  return { success: true };
}

export async function listPendingStaffAccessRequests(limit?: number): Promise<
  PendingStaffAccessRequest[]
> {
  const db = await staffDb();
  if (!db) return [];

  let query = db
    .collection(COLLECTIONS.profiles)
    .where("role", "==", "staff")
    .where("approval_status", "==", "pending")
    .orderBy("created_at", "desc");
  if (limit != null) query = query.limit(limit);

  const pending = await query.get();
  if (pending.empty) return [];

  const driverSnaps = await db.getAll(
    ...pending.docs.map((doc) => db.collection(COLLECTIONS.drivers).doc(doc.id)),
  );
  const driverIds = new Set(driverSnaps.filter((snap) => snap.exists).map((snap) => snap.id));

  return pending.docs
    .filter((doc) => {
      const data = doc.data();
      return isAdminAccessRequestProfile({
        role: typeof data.role === "string" ? data.role : "",
        approval_status: typeof data.approval_status === "string" ? data.approval_status : "",
        isDriver: driverIds.has(doc.id),
      });
    })
    .map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        email: typeof data.email === "string" ? data.email : null,
        full_name: typeof data.full_name === "string" ? data.full_name : null,
        created_at: iso(data.created_at) ?? "",
      };
    });
}

export async function setMaintenanceMode(
  enabled: boolean,
): Promise<{ error?: string; success?: boolean }> {
  const auth = await requireSuperAdmin();
  if ("error" in auth) return auth;

  const db = await staffDb();
  if (!db) return { error: "save_failed" };

  try {
    await writeWithEpoch(db, "settings", ({ tx }) => {
      tx.set(
        db.collection(COLLECTIONS.appSettings).doc(APP_SETTINGS_DOC_ID),
        {
          maintenance_mode: enabled,
          updated_at: new Date(),
          updated_by: auth.session.id,
        },
        { merge: true },
      );
    });
  } catch {
    return { error: "save_failed" };
  }

  updateTag("app-settings");
  updateTag("app-ops-settings");
  return { success: true };
}
