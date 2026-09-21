"use server";

import { updateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/get-session";
import { CATALOG_SLUG_SET } from "@/lib/auth/permission-catalog";
import {
  expandRoleSlugsToUserTicks,
  isStaffMatrixSlug,
  parseStaffAccessKind,
  type StaffAccessKind,
} from "@/lib/auth/staff-access";
import { logAdminActivity } from "@/lib/audit/log-admin-activity";

export type StaffAccessListRow = {
  id: string;
  fullName: string | null;
  email: string | null;
  accessKind: StaffAccessKind | null;
  roleName: string | null;
  roleSlug: string | null;
  isSuperAdmin: boolean;
  tickCount: number;
  updatedAt: string;
};

export type StaffAccessDetail = {
  id: string;
  fullName: string | null;
  email: string | null;
  accessKind: StaffAccessKind;
  roleId: string | null;
  roleName: string | null;
  isSuperAdmin: boolean;
  slugs: string[];
};

async function requireSuperAdmin() {
  const session = await getSessionUser();
  if (!session?.isSuperAdmin) {
    return { error: "not_authorized" as const };
  }
  return { session };
}

function matrixSlugs(slugs: string[]): string[] {
  return [...new Set(slugs.filter((slug) => CATALOG_SLUG_SET.has(slug) && isStaffMatrixSlug(slug)))];
}

export async function listStaffAccess(): Promise<{
  error?: string;
  rows?: StaffAccessListRow[];
}> {
  const auth = await requireSuperAdmin();
  if ("error" in auth) return auth;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select(
      "id, full_name, email, access_kind, admin_role_id, updated_at, admin_roles(name, slug, is_super_admin)",
    )
    .eq("role", "staff")
    .eq("approval_status", "approved")
    .is("archived_at", null)
    .order("full_name", { ascending: true, nullsFirst: false });

  if (error) return { error: error.message };

  const ids = (data ?? []).map((row) => row.id);
  const tickCounts = new Map<string, number>();
  if (ids.length > 0) {
    const { data: ticks, error: tickError } = await supabase
      .from("admin_user_permissions")
      .select("user_id")
      .in("user_id", ids);
    if (!tickError) {
      for (const row of ticks ?? []) {
        tickCounts.set(row.user_id, (tickCounts.get(row.user_id) ?? 0) + 1);
      }
    }
  }

  return {
    rows: (data ?? []).map((row) => {
      const role = row.admin_roles as {
        name: string;
        slug: string;
        is_super_admin: boolean;
      } | null;
      return {
        id: row.id,
        fullName: row.full_name,
        email: row.email,
        accessKind: parseStaffAccessKind(row.access_kind),
        roleName: role?.name ?? null,
        roleSlug: role?.slug ?? null,
        isSuperAdmin: role?.is_super_admin === true,
        tickCount: tickCounts.get(row.id) ?? 0,
        updatedAt: row.updated_at,
      };
    }),
  };
}

export async function getStaffAccess(userId: string): Promise<{
  error?: string;
  detail?: StaffAccessDetail;
}> {
  const auth = await requireSuperAdmin();
  if ("error" in auth) return auth;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, email, access_kind, admin_role_id, admin_roles(name, is_super_admin)")
    .eq("id", userId)
    .eq("role", "staff")
    .maybeSingle();

  if (error || !data) return { error: "user_not_found" };

  const role = data.admin_roles as { name: string; is_super_admin: boolean } | null;
  const { data: ticks } = await supabase
    .from("admin_user_permissions")
    .select("permission_slug")
    .eq("user_id", userId);

  return {
    detail: {
      id: data.id,
      fullName: data.full_name,
      email: data.email,
      accessKind: parseStaffAccessKind(data.access_kind) ?? "user",
      roleId: data.admin_role_id,
      roleName: role?.name ?? null,
      isSuperAdmin: role?.is_super_admin === true,
      slugs: (ticks ?? []).map((row) => row.permission_slug).filter(isStaffMatrixSlug),
    },
  };
}

export async function saveStaffAccess(input: {
  userId: string;
  accessKind: StaffAccessKind;
  slugs: string[];
}): Promise<{ error?: string; success?: boolean }> {
  const auth = await requireSuperAdmin();
  if ("error" in auth) return auth;

  const kind = parseStaffAccessKind(input.accessKind);
  if (!kind) return { error: "invalid_kind" };

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, access_kind, role")
    .eq("id", input.userId)
    .eq("role", "staff")
    .maybeSingle();

  if (!profile) return { error: "user_not_found" };

  const slugs = kind === "user" ? matrixSlugs(input.slugs) : [];

  const { error: kindError } = await supabase
    .from("profiles")
    .update({
      access_kind: kind,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.userId);

  if (kindError) return { error: kindError.message };

  const { error: deleteError } = await supabase
    .from("admin_user_permissions")
    .delete()
    .eq("user_id", input.userId);

  if (deleteError) return { error: deleteError.message };

  if (slugs.length > 0) {
    const { error: insertError } = await supabase.from("admin_user_permissions").insert(
      slugs.map((permission_slug) => ({
        user_id: input.userId,
        permission_slug,
      })),
    );
    if (insertError) return { error: insertError.message };
  }

  void logAdminActivity({
    action: "update",
    entityType: "staff_access",
    entityId: input.userId,
    pagePath: `/settings/staff-access/${input.userId}`,
    context: {
      access_kind: kind,
      tick_count: slugs.length,
      previous_kind: profile.access_kind,
    },
  });

  updateTag("admin-roles");
  return { success: true };
}

export async function copyRoleTemplateTicks(roleId: string): Promise<{
  error?: string;
  slugs?: string[];
}> {
  const auth = await requireSuperAdmin();
  if ("error" in auth) return auth;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("admin_role_permissions")
    .select("permission_slug")
    .eq("role_id", roleId);

  if (error) return { error: error.message };

  return {
    slugs: [...expandRoleSlugsToUserTicks((data ?? []).map((row) => row.permission_slug))].filter(
      isStaffMatrixSlug,
    ),
  };
}
