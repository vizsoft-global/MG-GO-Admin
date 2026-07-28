import { createClient } from "@/lib/supabase/server";

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
    const supabase = await createClient();
    const { data: roles, error } = await supabase
      .from("admin_roles")
      .select("id, slug, name, is_system, is_super_admin")
      .order("name");

    if (error || !roles) return [];

    const { data: perms } = await supabase
      .from("admin_role_permissions")
      .select("role_id, permission_slug");

    const byRole = new Map<string, string[]>();
    for (const row of perms ?? []) {
      const list = byRole.get(row.role_id) ?? [];
      list.push(row.permission_slug);
      byRole.set(row.role_id, list);
    }

    return roles.map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      isSystem: r.is_system,
      isSuperAdmin: r.is_super_admin,
      permissions: byRole.get(r.id) ?? [],
    }));
  } catch {
    return [];
  }
}

/** Loaded per request with the caller's session (not globally cached — RLS needs auth). */
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
