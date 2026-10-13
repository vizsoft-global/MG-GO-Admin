"use server";

import { updateTag } from "next/cache";
import type { Firestore } from "firebase-admin/firestore";
import { logAdminMutation } from "@/lib/audit/log-admin-activity";
import { callAdminFunction } from "@/lib/firebase/callable";
import { writeWithEpochCounters } from "@/lib/auth/auth-epochs";
import type { EpochCounters } from "@/lib/auth/epoch-cache";
import { getSessionUser } from "@/lib/auth/get-session";
import { requireMutationAuth } from "@/lib/auth/require-mutation-auth";
import { CATALOG_SLUG_SET, isValidRoleSlug } from "@/lib/auth/permission-catalog";
import { COLLECTIONS } from "@/lib/firebase/db";
import { staffDb } from "@/lib/firebase/staff-db";

type RoleRow = {
  id: string;
  slug: string;
  name: string;
  is_system: boolean;
  is_super_admin: boolean;
};

async function requireRolesRead() {
  const session = await getSessionUser();
  if (!session?.isSuperAdmin) {
    return { error: "not_authorized" as const };
  }
  return { session };
}

async function requireRolesManager() {
  const auth = await requireMutationAuth();
  if ("error" in auth) return auth;
  if (!auth.session.isSuperAdmin) {
    return { error: "not_authorized" as const };
  }
  return { session: auth.session };
}

function filterValidPermissions(permissionSlugs: string[]): string[] {
  return permissionSlugs.filter((s) => CATALOG_SLUG_SET.has(s));
}

async function getRoleByIdInternal(db: Firestore, roleId: string): Promise<RoleRow | null> {
  const snap = await db.collection(COLLECTIONS.adminRoles).doc(roleId).get();
  if (!snap.exists) return null;
  const data = snap.data() ?? {};
  return {
    id: snap.id,
    slug: typeof data.slug === "string" ? data.slug : "",
    name: typeof data.name === "string" ? data.name : "",
    is_system: data.is_system === true,
    is_super_admin: data.is_super_admin === true,
  };
}

async function readRoleSlugs(db: Firestore, roleId: string): Promise<string[]> {
  const snap = await db.collection(COLLECTIONS.adminRolePermissions).doc(roleId).get();
  const slugs = snap.data()?.permission_slugs;
  return Array.isArray(slugs) ? slugs.filter((slug): slug is string => typeof slug === "string") : [];
}

async function writeRoleSlugs(
  db: Firestore,
  roleId: string,
  slugs: string[],
): Promise<EpochCounters | null> {
  try {
    const written = await writeWithEpochCounters(db, "access", ({ tx }) => {
      tx.set(
        db.collection(COLLECTIONS.adminRolePermissions).doc(roleId),
        { permission_slugs: slugs },
        { merge: true },
      );
    });
    return written.epochs;
  } catch {
    return null;
  }
}

async function syncClaimsForRole(db: Firestore, roleId: string): Promise<void> {
  const snap = await db
    .collection(COLLECTIONS.profiles)
    .where("admin_role_id", "==", roleId)
    .get();
  await Promise.all(
    snap.docs.map(async (doc) => {
      try {
        await callAdminFunction("syncStaffClaims", { uid: doc.id });
      } catch {
        // Claims refresh is best-effort; the permission rows are already saved.
      }
    }),
  );
}

export async function getRoleUsageCounts(): Promise<
  { roleId: string; userCount: number }[]
> {
  const db = await staffDb();
  if (!db) return [];

  const snap = await db
    .collection(COLLECTIONS.profiles)
    .where("admin_role_id", "!=", null)
    .orderBy("admin_role_id")
    .get();
  const counts = new Map<string, number>();
  for (const doc of snap.docs) {
    const roleId = doc.data().admin_role_id;
    if (typeof roleId !== "string" || !roleId) continue;
    counts.set(roleId, (counts.get(roleId) ?? 0) + 1);
  }

  return Array.from(counts.entries()).map(([roleId, userCount]) => ({
    roleId,
    userCount,
  }));
}

export async function updateRolePermissions(
  roleId: string,
  permissionSlugs: string[],
): Promise<{ error?: string; success?: boolean; epochs?: EpochCounters }> {
  const auth = await requireRolesManager();
  if ("error" in auth) return auth;

  const filtered = filterValidPermissions(permissionSlugs);
  const db = await staffDb();
  if (!db) return { error: "save_failed" };

  const role = await getRoleByIdInternal(db, roleId);
  if (!role) return { error: "role_not_found" };
  if (role.is_super_admin) return { error: "cannot_edit_super_admin" };

  const beforeSlugs = await readRoleSlugs(db, roleId);
  const epochs = await writeRoleSlugs(db, roleId, filtered);
  if (!epochs) return { error: "save_failed" };

  await syncClaimsForRole(db, roleId);
  updateTag("admin-roles");
  void logAdminMutation({
    action: "update",
    entityType: "admin_role",
    entityId: roleId,
    routeName: "updateRolePermissions",
    before: { permissions: beforeSlugs },
    after: { permissions: filtered },
  });
  return { success: true, epochs };
}

async function saveRolePermissionsWithoutCache(
  db: Firestore,
  roleId: string,
  permissionSlugs: string[],
): Promise<{ error?: string; epochs?: EpochCounters }> {
  const filtered = filterValidPermissions(permissionSlugs);
  const role = await getRoleByIdInternal(db, roleId);
  if (!role) return { error: "role_not_found" };
  if (role.is_super_admin) return { error: "cannot_edit_super_admin" };

  const epochs = await writeRoleSlugs(db, roleId, filtered);
  if (!epochs) return { error: "save_failed" };
  await syncClaimsForRole(db, roleId);
  return { epochs };
}

export async function updateMultipleRolePermissions(
  updates: { roleId: string; permissionSlugs: string[] }[],
): Promise<{ error?: string; success?: boolean; epochs?: EpochCounters }> {
  const auth = await requireRolesManager();
  if ("error" in auth) return auth;

  if (updates.length === 0) {
    return { success: true };
  }

  const db = await staffDb();
  if (!db) return { error: "save_failed" };

  let epochs: EpochCounters | undefined;
  for (const { roleId, permissionSlugs } of updates) {
    const result = await saveRolePermissionsWithoutCache(db, roleId, permissionSlugs);
    if (result.error) return result;
    epochs = result.epochs;
  }

  updateTag("admin-roles");
  void logAdminMutation({
    action: "update",
    entityType: "admin_roles",
    routeName: "updateMultipleRolePermissions",
    context: { role_count: updates.length },
  });
  return { success: true, epochs };
}

export async function createCustomRole(
  name: string,
  slug: string,
  permissionSlugs: string[],
): Promise<{ error?: string; success?: boolean; roleId?: string; epochs?: EpochCounters }> {
  const auth = await requireRolesManager();
  if ("error" in auth) return auth;

  const trimmedName = name.trim();
  const normalizedSlug = slug.trim().toLowerCase();

  if (!trimmedName) return { error: "invalid_name" };
  if (!isValidRoleSlug(normalizedSlug)) return { error: "invalid_slug" };

  const reserved = new Set(["super_admin", "administrator", "operator"]);
  if (reserved.has(normalizedSlug)) return { error: "slug_reserved" };

  const db = await staffDb();
  if (!db) return { error: "save_failed" };

  const existing = await db
    .collection(COLLECTIONS.adminRoles)
    .where("slug", "==", normalizedSlug)
    .limit(1)
    .get();
  if (!existing.empty) return { error: "slug_exists" };

  const roleId = crypto.randomUUID();
  try {
    await writeWithEpochCounters(db, "access", ({ tx }) => {
      tx.set(db.collection(COLLECTIONS.adminRoles).doc(roleId), {
        id: roleId,
        name: trimmedName,
        slug: normalizedSlug,
        is_system: false,
        is_super_admin: false,
      });
    });
  } catch {
    return { error: "save_failed" };
  }

  const result = await updateRolePermissions(roleId, permissionSlugs);
  if (result.error) return result;

  void logAdminMutation({
    action: "create",
    entityType: "admin_role",
    entityId: roleId,
    routeName: "createCustomRole",
    after: { name: trimmedName, slug: normalizedSlug },
  });

  return { success: true, roleId, epochs: result.epochs };
}

export async function duplicateRole(
  sourceRoleId: string,
  name: string,
  slug: string,
): Promise<{ error?: string; success?: boolean; roleId?: string; epochs?: EpochCounters }> {
  const auth = await requireRolesManager();
  if ("error" in auth) return auth;

  const db = await staffDb();
  if (!db) return { error: "save_failed" };

  const slugs = await readRoleSlugs(db, sourceRoleId);
  return createCustomRole(name, slug, slugs);
}

export async function copyRolePermissionsToEditor(
  sourceRoleId: string,
  targetRoleId: string,
): Promise<{ error?: string; permissions?: string[] }> {
  const auth = await requireRolesRead();
  if ("error" in auth) return auth;

  if (sourceRoleId === targetRoleId) {
    return { error: "same_role" };
  }

  const db = await staffDb();
  if (!db) return { error: "save_failed" };

  const target = await getRoleByIdInternal(db, targetRoleId);
  if (!target) return { error: "role_not_found" };
  if (target.is_super_admin) return { error: "cannot_edit_super_admin" };

  return { permissions: filterValidPermissions(await readRoleSlugs(db, sourceRoleId)) };
}

export async function applyCopyRolePermissions(
  sourceRoleId: string,
  targetRoleId: string,
): Promise<{ error?: string; success?: boolean; epochs?: EpochCounters }> {
  const copy = await copyRolePermissionsToEditor(sourceRoleId, targetRoleId);
  if (copy.error || !copy.permissions) return { error: copy.error ?? "copy_failed" };
  return updateRolePermissions(targetRoleId, copy.permissions);
}

export async function updateRoleMeta(
  roleId: string,
  name: string,
): Promise<{ error?: string; success?: boolean; epochs?: EpochCounters }> {
  const auth = await requireRolesManager();
  if ("error" in auth) return auth;

  const trimmedName = name.trim();
  if (!trimmedName) return { error: "invalid_name" };

  const db = await staffDb();
  if (!db) return { error: "save_failed" };

  const role = await getRoleByIdInternal(db, roleId);
  if (!role) return { error: "role_not_found" };
  if (role.is_super_admin || role.is_system) {
    return { error: "cannot_edit_system_role" };
  }

  let epochs: EpochCounters;
  try {
    const written = await writeWithEpochCounters(db, "access", ({ tx }) => {
      tx.set(
        db.collection(COLLECTIONS.adminRoles).doc(roleId),
        { name: trimmedName },
        { merge: true },
      );
    });
    epochs = written.epochs;
  } catch {
    return { error: "save_failed" };
  }

  updateTag("admin-roles");
  return { success: true, epochs };
}

export async function deleteCustomRole(
  roleId: string,
): Promise<{ error?: string; success?: boolean; epochs?: EpochCounters }> {
  const auth = await requireRolesManager();
  if ("error" in auth) return auth;

  const db = await staffDb();
  if (!db) return { error: "save_failed" };

  const role = await getRoleByIdInternal(db, roleId);
  if (!role) return { error: "role_not_found" };
  if (role.is_super_admin || role.is_system) {
    return { error: "cannot_delete_system_role" };
  }

  const countSnap = await db
    .collection(COLLECTIONS.profiles)
    .where("admin_role_id", "==", roleId)
    .count()
    .get();
  if (countSnap.data().count > 0) return { error: "role_in_use" };

  let epochs: EpochCounters;
  try {
    const written = await writeWithEpochCounters(db, "access", ({ tx }) => {
      tx.delete(db.collection(COLLECTIONS.adminRoles).doc(roleId));
      tx.delete(db.collection(COLLECTIONS.adminRolePermissions).doc(roleId));
    });
    epochs = written.epochs;
  } catch {
    return { error: "delete_failed" };
  }

  updateTag("admin-roles");
  void logAdminMutation({
    action: "delete",
    entityType: "admin_role",
    entityId: roleId,
    routeName: "deleteCustomRole",
    before: { slug: role.slug, name: role.name },
  });
  return { success: true, epochs };
}
