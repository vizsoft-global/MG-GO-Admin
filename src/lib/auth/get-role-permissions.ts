import { getFirebaseFirestore } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/db";
import type { AdminRoleDoc, PermissionArrayDoc } from "@/lib/firebase/types";

export type AdminRoleRow = {
  id: string;
  slug: string;
  name: string;
  isSystem: boolean;
  isSuperAdmin: boolean;
  permissions: string[];
};

async function fetchAllRoles(): Promise<AdminRoleRow[]> {
  try {
    const db = await getFirebaseFirestore();
    if (!db) return [];

    const rolesSnap = await db.collection(COLLECTIONS.adminRoles).orderBy("name").get();
    if (rolesSnap.empty) return [];

    // One array doc per role, so this is one read per role rather than one read
    // per (role, slug) pair.
    const permSnaps = await Promise.all(
      rolesSnap.docs.map((doc) =>
        db.collection(COLLECTIONS.adminRolePermissions).doc(doc.id).get(),
      ),
    );

    const byRole = new Map<string, string[]>();
    permSnaps.forEach((snap, index) => {
      const slugs = (snap.data() as PermissionArrayDoc | undefined)?.permission_slugs ?? [];
      byRole.set(rolesSnap.docs[index].id, slugs);
    });

    return rolesSnap.docs.map((doc) => {
      const role = { id: doc.id, ...(doc.data() ?? {}) } as AdminRoleDoc;
      return {
        id: doc.id,
        slug: role.slug,
        name: role.name,
        isSystem: role.is_system,
        isSuperAdmin: role.is_super_admin,
        permissions: byRole.get(doc.id) ?? [],
      };
    });
  } catch {
    return [];
  }
}

/** Loaded per request with the caller's session (not globally cached — rules need auth). */
export async function getAllAdminRoles(): Promise<AdminRoleRow[]> {
  return fetchAllRoles();
}

export async function getRoleById(roleId: string): Promise<AdminRoleRow | null> {
  const roles = await getAllAdminRoles();
  return roles.find((r) => r.id === roleId) ?? null;
}

export async function getPermissionsForRole(roleId: string): Promise<string[]> {
  const role = await getRoleById(roleId);
  if (!role) return [];
  if (role.isSuperAdmin) {
    const roles = await getAllAdminRoles();
    const superRole = roles.find((r) => r.isSuperAdmin);
    return superRole?.permissions ?? role.permissions;
  }
  return role.permissions;
}
