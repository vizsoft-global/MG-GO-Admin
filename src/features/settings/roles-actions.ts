"use server";

import { updateTag } from "next/cache";
import { logAdminMutation } from "@/lib/audit/log-admin-activity";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/get-session";
import { CATALOG_SLUG_SET, isValidRoleSlug } from "@/lib/auth/permission-catalog";

async function requireRolesManager() {
  const session = await getSessionUser();
  if (!session?.isSuperAdmin) {
    return { error: "not_authorized" as const };
  }
  return { session };
}

function filterValidPermissions(permissionSlugs: string[]): string[] {
  return permissionSlugs.filter((s) => CATALOG_SLUG_SET.has(s));
}

async function getRoleByIdInternal(
  supabase: Awaited<ReturnType<typeof createClient>>,
  roleId: string,
) {
  return supabase
    .from("admin_roles")
    .select("id, slug, name, is_system, is_super_admin")
    .eq("id", roleId)
    .maybeSingle();
}

export async function getRoleUsageCounts(): Promise<
  { roleId: string; userCount: number }[]
> {
  const supabase = await createClient();
  const { data: profiles } = await supabase
    .from("profiles")
    .select("admin_role_id")
    .not("admin_role_id", "is", null);

  const counts = new Map<string, number>();
  for (const row of profiles ?? []) {
    if (!row.admin_role_id) continue;
    counts.set(row.admin_role_id, (counts.get(row.admin_role_id) ?? 0) + 1);
  }

  return Array.from(counts.entries()).map(([roleId, userCount]) => ({
    roleId,
    userCount,
  }));
}

export async function updateRolePermissions(
  roleId: string,
  permissionSlugs: string[],
): Promise<{ error?: string; success?: boolean }> {
  const auth = await requireRolesManager();
  if ("error" in auth) return auth;

  const filtered = filterValidPermissions(permissionSlugs);
  const supabase = await createClient();

  const { data: role } = await getRoleByIdInternal(supabase, roleId);

  if (!role) {
    return { error: "role_not_found" };
  }

  if (role.is_super_admin) {
    return { error: "cannot_edit_super_admin" };
  }

  const { data: beforePerms } = await supabase
    .from("admin_role_permissions")
    .select("permission_slug")
    .eq("role_id", roleId);
  const beforeSlugs = (beforePerms ?? []).map((p) => p.permission_slug);

  await supabase.from("admin_role_permissions").delete().eq("role_id", roleId);

  if (filtered.length > 0) {
    const { error } = await supabase.from("admin_role_permissions").insert(
      filtered.map((permission_slug) => ({
        role_id: roleId,
        permission_slug,
      })),
    );

    if (error) {
      return { error: "save_failed" };
    }
  }

  updateTag("admin-roles");
  void logAdminMutation({
    action: "update",
    entityType: "admin_role",
    entityId: roleId,
    routeName: "updateRolePermissions",
    before: { permissions: beforeSlugs },
    after: { permissions: filtered },
  });
  return { success: true };
}

async function saveRolePermissionsWithoutCache(
  supabase: Awaited<ReturnType<typeof createClient>>,
  roleId: string,
  permissionSlugs: string[],
): Promise<{ error?: string }> {
  const filtered = filterValidPermissions(permissionSlugs);

  const { data: role } = await getRoleByIdInternal(supabase, roleId);
  if (!role) return { error: "role_not_found" };
  if (role.is_super_admin) return { error: "cannot_edit_super_admin" };

  await supabase.from("admin_role_permissions").delete().eq("role_id", roleId);

  if (filtered.length > 0) {
    const { error } = await supabase.from("admin_role_permissions").insert(
      filtered.map((permission_slug) => ({
        role_id: roleId,
        permission_slug,
      })),
    );
    if (error) return { error: "save_failed" };
  }

  return {};
}

export async function updateMultipleRolePermissions(
  updates: { roleId: string; permissionSlugs: string[] }[],
): Promise<{ error?: string; success?: boolean }> {
  const auth = await requireRolesManager();
  if ("error" in auth) return auth;

  if (updates.length === 0) {
    return { success: true };
  }

  const supabase = await createClient();

  for (const { roleId, permissionSlugs } of updates) {
    const result = await saveRolePermissionsWithoutCache(
      supabase,
      roleId,
      permissionSlugs,
    );
    if (result.error) return result;
  }

  updateTag("admin-roles");
  void logAdminMutation({
    action: "update",
    entityType: "admin_roles",
    routeName: "updateMultipleRolePermissions",
    context: { role_count: updates.length },
  });
  return { success: true };
}

export async function createCustomRole(
  name: string,
  slug: string,
  permissionSlugs: string[],
): Promise<{ error?: string; success?: boolean; roleId?: string }> {
  const auth = await requireRolesManager();
  if ("error" in auth) return auth;

  const trimmedName = name.trim();
  const normalizedSlug = slug.trim().toLowerCase();

  if (!trimmedName) return { error: "invalid_name" };
  if (!isValidRoleSlug(normalizedSlug)) return { error: "invalid_slug" };

  const reserved = new Set(["super_admin", "administrator", "operator"]);
  if (reserved.has(normalizedSlug)) return { error: "slug_reserved" };

  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("admin_roles")
    .select("id")
    .eq("slug", normalizedSlug)
    .maybeSingle();

  if (existing) return { error: "slug_exists" };

  const { data: role, error } = await supabase
    .from("admin_roles")
    .insert({
      name: trimmedName,
      slug: normalizedSlug,
      is_system: false,
      is_super_admin: false,
    })
    .select("id")
    .single();

  if (error || !role) {
    return { error: "save_failed" };
  }

  const result = await updateRolePermissions(role.id, permissionSlugs);
  if (result.error) return result;

  void logAdminMutation({
    action: "create",
    entityType: "admin_role",
    entityId: role.id,
    routeName: "createCustomRole",
    after: { name: trimmedName, slug: normalizedSlug },
  });

  return { success: true, roleId: role.id };
}

export async function duplicateRole(
  sourceRoleId: string,
  name: string,
  slug: string,
): Promise<{ error?: string; success?: boolean; roleId?: string }> {
  const auth = await requireRolesManager();
  if ("error" in auth) return auth;

  const supabase = await createClient();
  const { data: sourcePerms } = await supabase
    .from("admin_role_permissions")
    .select("permission_slug")
    .eq("role_id", sourceRoleId);

  const slugs = (sourcePerms ?? []).map((r) => r.permission_slug);
  return createCustomRole(name, slug, slugs);
}

export async function copyRolePermissionsToEditor(
  sourceRoleId: string,
  targetRoleId: string,
): Promise<{ error?: string; permissions?: string[] }> {
  const auth = await requireRolesManager();
  if ("error" in auth) return auth;

  if (sourceRoleId === targetRoleId) {
    return { error: "same_role" };
  }

  const supabase = await createClient();

  const { data: target } = await getRoleByIdInternal(supabase, targetRoleId);
  if (!target) return { error: "role_not_found" };
  if (target.is_super_admin) return { error: "cannot_edit_super_admin" };

  const { data: sourcePerms } = await supabase
    .from("admin_role_permissions")
    .select("permission_slug")
    .eq("role_id", sourceRoleId);

  return {
    permissions: filterValidPermissions(
      (sourcePerms ?? []).map((r) => r.permission_slug),
    ),
  };
}

export async function applyCopyRolePermissions(
  sourceRoleId: string,
  targetRoleId: string,
): Promise<{ error?: string; success?: boolean }> {
  const copy = await copyRolePermissionsToEditor(sourceRoleId, targetRoleId);
  if (copy.error || !copy.permissions) return { error: copy.error ?? "copy_failed" };
  return updateRolePermissions(targetRoleId, copy.permissions);
}

export async function updateRoleMeta(
  roleId: string,
  name: string,
): Promise<{ error?: string; success?: boolean }> {
  const auth = await requireRolesManager();
  if ("error" in auth) return auth;

  const trimmedName = name.trim();
  if (!trimmedName) return { error: "invalid_name" };

  const supabase = await createClient();
  const { data: role } = await getRoleByIdInternal(supabase, roleId);

  if (!role) return { error: "role_not_found" };
  if (role.is_super_admin || role.is_system) {
    return { error: "cannot_edit_system_role" };
  }

  const { error } = await supabase
    .from("admin_roles")
    .update({ name: trimmedName })
    .eq("id", roleId);

  if (error) return { error: "save_failed" };

  updateTag("admin-roles");
  return { success: true };
}

export async function deleteCustomRole(
  roleId: string,
): Promise<{ error?: string; success?: boolean }> {
  const auth = await requireRolesManager();
  if ("error" in auth) return auth;

  const supabase = await createClient();
  const { data: role } = await getRoleByIdInternal(supabase, roleId);

  if (!role) return { error: "role_not_found" };
  if (role.is_super_admin || role.is_system) {
    return { error: "cannot_delete_system_role" };
  }

  const { count } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("admin_role_id", roleId);

  if ((count ?? 0) > 0) {
    return { error: "role_in_use" };
  }

  const { error } = await supabase.from("admin_roles").delete().eq("id", roleId);

  if (error) return { error: "delete_failed" };

  updateTag("admin-roles");
  void logAdminMutation({
    action: "delete",
    entityType: "admin_role",
    entityId: roleId,
    routeName: "deleteCustomRole",
    before: { slug: role.slug, name: role.name },
  });
  return { success: true };
}
