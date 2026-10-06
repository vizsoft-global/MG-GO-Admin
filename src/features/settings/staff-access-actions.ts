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
import {
  APP_ACCESS_CATALOG,
  diffAccess,
  modulesSelectedCount,
  parseStaffDepartment,
  ticksToAppAccess,
  type StaffDepartment,
} from "@/lib/auth/app-access";
import { logAdminActivity } from "@/lib/audit/log-admin-activity";

export type StaffLastChanged = {
  by: string | null;
  at: string | null;
};

export type RequestTypeGrant = {
  requestType: string;
  accessLevel: "view_only" | "approver";
};

export type RequestTypeOption = {
  key: string;
  labelEn: string;
  labelAr: string | null;
};

export type StaffAccessListRow = {
  id: string;
  fullName: string | null;
  email: string | null;
  accessKind: StaffAccessKind | null;
  roleId: string | null;
  roleName: string | null;
  roleSlug: string | null;
  isSuperAdmin: boolean;
  tickCount: number;
  modulesSelected: number;
  staffDepartment: StaffDepartment | null;
  slugs: string[];
  lastChanged: StaffLastChanged;
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
  staffDepartment: StaffDepartment | null;
  requestTypes: RequestTypeGrant[];
  lastChanged: StaffLastChanged;
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

async function lastChangedByEntities(
  supabase: Awaited<ReturnType<typeof createClient>>,
  entityIds: string[],
): Promise<Map<string, StaffLastChanged>> {
  const map = new Map<string, StaffLastChanged>();
  if (entityIds.length === 0) return map;

  const { data: logs } = await supabase
    .from("admin_activity_logs")
    .select("entity_id, admin_user_id, created_at")
    .eq("entity_type", "staff_access")
    .eq("success", true)
    .in("entity_id", entityIds)
    .order("created_at", { ascending: false })
    .limit(400);

  const actorIds = new Set<string>();
  for (const row of logs ?? []) {
    if (!row.entity_id || map.has(row.entity_id)) continue;
    map.set(row.entity_id, { by: null, at: row.created_at });
    if (row.admin_user_id) actorIds.add(row.admin_user_id);
  }

  if (actorIds.size === 0) return map;

  const { data: actors } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .in("id", [...actorIds]);

  const names = new Map(
    (actors ?? []).map((row) => [row.id, row.full_name ?? row.email ?? null] as const),
  );

  for (const row of logs ?? []) {
    if (!row.entity_id) continue;
    const current = map.get(row.entity_id);
    if (!current || current.by || current.at !== row.created_at) continue;
    map.set(row.entity_id, {
      at: row.created_at,
      by: row.admin_user_id ? (names.get(row.admin_user_id) ?? null) : null,
    });
  }

  return map;
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
      "id, full_name, email, access_kind, staff_department, admin_role_id, updated_at, admin_roles(name, slug, is_super_admin)",
    )
    .eq("role", "staff")
    .eq("approval_status", "approved")
    .is("archived_at", null)
    .order("full_name", { ascending: true, nullsFirst: false });

  if (error) return { error: error.message };

  const ids = (data ?? []).map((row) => row.id);
  const slugsByUser = new Map<string, string[]>();
  if (ids.length > 0) {
    const { data: ticks } = await supabase
      .from("admin_user_permissions")
      .select("user_id, permission_slug")
      .in("user_id", ids);
    for (const row of ticks ?? []) {
      const list = slugsByUser.get(row.user_id) ?? [];
      if (isStaffMatrixSlug(row.permission_slug)) list.push(row.permission_slug);
      slugsByUser.set(row.user_id, list);
    }
  }

  const lastChanged = await lastChangedByEntities(supabase, ids);

  return {
    rows: (data ?? []).map((row) => {
      const role = row.admin_roles as {
        name: string;
        slug: string;
        is_super_admin: boolean;
      } | null;
      const slugs = slugsByUser.get(row.id) ?? [];
      const fullAccess = role?.is_super_admin === true || parseStaffAccessKind(row.access_kind) === "manager";
      return {
        id: row.id,
        fullName: row.full_name,
        email: row.email,
        accessKind: parseStaffAccessKind(row.access_kind),
        roleId: row.admin_role_id,
        roleName: role?.name ?? null,
        roleSlug: role?.slug ?? null,
        isSuperAdmin: role?.is_super_admin === true,
        tickCount: slugs.length,
        modulesSelected: fullAccess ? APP_ACCESS_CATALOG.length : modulesSelectedCount(slugs),
        staffDepartment: parseStaffDepartment(row.staff_department),
        slugs,
        lastChanged: lastChanged.get(row.id) ?? { by: null, at: null },
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
    .select(
      "id, full_name, email, access_kind, staff_department, admin_role_id, admin_roles(name, is_super_admin)",
    )
    .eq("id", userId)
    .eq("role", "staff")
    .maybeSingle();

  if (error || !data) return { error: "user_not_found" };

  const role = data.admin_roles as { name: string; is_super_admin: boolean } | null;
  const { data: ticks } = await supabase
    .from("admin_user_permissions")
    .select("permission_slug")
    .eq("user_id", userId);

  const { data: grants } = await supabase
    .from("request_staff_access")
    .select("request_type, access_level")
    .eq("profile_id", userId);

  const lastChanged = await lastChangedByEntities(supabase, [userId]);

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
      staffDepartment: parseStaffDepartment(data.staff_department),
      requestTypes: (grants ?? []).map((row) => ({
        requestType: row.request_type,
        accessLevel: row.access_level === "approver" ? "approver" : "view_only",
      })),
      lastChanged: lastChanged.get(userId) ?? { by: null, at: null },
    },
  };
}

export async function listRequestTypeOptions(): Promise<{
  error?: string;
  rows?: RequestTypeOption[];
}> {
  const auth = await requireSuperAdmin();
  if ("error" in auth) return auth;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("request_type_definitions")
    .select("key, label_en, label_ar, is_active, sort_order")
    .eq("is_active", true)
    .order("sort_order");

  if (error) return { error: error.message };

  return {
    rows: (data ?? []).map((row) => ({
      key: row.key,
      labelEn: row.label_en,
      labelAr: row.label_ar,
    })),
  };
}

export async function saveStaffAccess(input: {
  userId: string;
  accessKind: StaffAccessKind;
  slugs: string[];
  department?: StaffDepartment | null;
  requestTypes?: RequestTypeGrant[];
}): Promise<{ error?: string; success?: boolean }> {
  const auth = await requireSuperAdmin();
  if ("error" in auth) return auth;

  const kind = parseStaffAccessKind(input.accessKind);
  if (!kind) return { error: "invalid_kind" };
  if (input.department !== undefined && input.department !== null && !parseStaffDepartment(input.department)) {
    return { error: "invalid_department" };
  }

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, access_kind, staff_department, role")
    .eq("id", input.userId)
    .eq("role", "staff")
    .maybeSingle();

  if (!profile) return { error: "user_not_found" };

  const { data: previousTicks } = await supabase
    .from("admin_user_permissions")
    .select("permission_slug")
    .eq("user_id", input.userId);

  const slugs = kind === "user" ? matrixSlugs(input.slugs) : [];
  const beforeAccess = ticksToAppAccess(
    (previousTicks ?? []).map((row) => row.permission_slug).filter(isStaffMatrixSlug),
  );
  const afterAccess = ticksToAppAccess(slugs);
  const accessDiff = diffAccess(beforeAccess, afterAccess);

  const profilePatch: {
    access_kind: StaffAccessKind;
    updated_at: string;
    staff_department?: string | null;
  } = {
    access_kind: kind,
    updated_at: new Date().toISOString(),
  };
  if (input.department !== undefined) {
    profilePatch.staff_department = input.department;
  }

  const { error: kindError } = await supabase
    .from("profiles")
    .update(profilePatch)
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

  if (input.requestTypes) {
    const { error: clearTypes } = await supabase
      .from("request_staff_access")
      .delete()
      .eq("profile_id", input.userId);
    if (clearTypes) return { error: clearTypes.message };

    const rows = input.requestTypes.filter(
      (row) => row.accessLevel === "view_only" || row.accessLevel === "approver",
    );
    if (rows.length > 0) {
      const { error: insertTypes } = await supabase.from("request_staff_access").insert(
        rows.map((row) => ({
          profile_id: input.userId,
          request_type: row.requestType,
          access_level: row.accessLevel,
        })),
      );
      if (insertTypes) return { error: insertTypes.message };
    }
  }

  void logAdminActivity({
    action: "update",
    entityType: "staff_access",
    entityId: input.userId,
    pagePath: `/settings/roles?user=${input.userId}`,
    context: {
      access_kind: kind,
      tick_count: slugs.length,
      previous_kind: profile.access_kind,
      department: input.department ?? profile.staff_department,
      diff: {
        added: accessDiff.addedApps,
        removed: accessDiff.removedApps,
        levelChanges: accessDiff.levelChanges,
        changeCount: accessDiff.changeCount,
      },
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

export async function getUserTicksForCopy(sourceUserId: string): Promise<{
  error?: string;
  slugs?: string[];
  accessKind?: StaffAccessKind;
  requestTypes?: RequestTypeGrant[];
}> {
  const auth = await requireSuperAdmin();
  if ("error" in auth) return auth;

  const loaded = await getStaffAccess(sourceUserId);
  if (loaded.error || !loaded.detail) return { error: loaded.error ?? "user_not_found" };

  return {
    slugs: loaded.detail.slugs,
    accessKind: loaded.detail.accessKind,
    requestTypes: loaded.detail.requestTypes,
  };
}
