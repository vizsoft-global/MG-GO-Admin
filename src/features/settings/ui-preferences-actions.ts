"use server";

import { logAdminMutation } from "@/lib/audit/log-admin-activity";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import {
  normalizeListColumnPreference,
  resolveUiPreference,
} from "@/lib/ui-preferences/merge";
import {
  type EffectiveUiPreference,
  type ListColumnPreference,
} from "@/lib/ui-preferences/types";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database";

async function requirePanelUser() {
  const session = await getSessionUser();
  if (!session) return null;
  return session;
}

async function requireSettingsManage() {
  const session = await getSessionUser();
  if (
    !session ||
    !(
      hasPermissionInSet(session.permissions, "settings.manage", session.isSuperAdmin) ||
      hasPermissionInSet(session.permissions, "drivers.manage", session.isSuperAdmin)
    )
  ) {
    return null;
  }
  return session;
}

export async function getEffectiveUiPreference(
  preferenceKey: string,
  knownIds: string[],
  systemDefault: ListColumnPreference,
): Promise<EffectiveUiPreference<ListColumnPreference>> {
  const session = await requirePanelUser();
  if (!session) {
    return resolveUiPreference({
      system: systemDefault,
      role: null,
      user: null,
    });
  }

  const supabase = await createClient();
  const roleId = session.profile.admin_role_id;

  const [userRes, roleRes] = await Promise.all([
    supabase
      .from("admin_ui_preferences")
      .select("value")
      .eq("user_id", session.id)
      .eq("preference_key", preferenceKey)
      .maybeSingle(),
    roleId
      ? supabase
          .from("admin_role_ui_defaults")
          .select("value")
          .eq("role_id", roleId)
          .eq("preference_key", preferenceKey)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const roleNorm = roleRes.data?.value
    ? normalizeListColumnPreference(roleRes.data.value, knownIds, systemDefault)
    : null;
  const userNorm = userRes.data?.value
    ? normalizeListColumnPreference(userRes.data.value, knownIds, systemDefault)
    : null;

  return resolveUiPreference({
    system: systemDefault,
    role: roleNorm,
    user: userNorm,
  });
}

export async function saveUserUiPreference(
  preferenceKey: string,
  value: ListColumnPreference,
): Promise<{ success?: boolean; error?: string }> {
  const session = await requirePanelUser();
  if (!session) return { error: "not_authorized" };

  const supabase = await createClient();
  const { error } = await supabase.from("admin_ui_preferences").upsert(
    {
      user_id: session.id,
      preference_key: preferenceKey,
      value: value as unknown as Json,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,preference_key" },
  );
  if (error) return { error: "save_failed" };
  return { success: true };
}

export async function clearUserUiPreference(
  preferenceKey: string,
): Promise<{ success?: boolean; error?: string }> {
  const session = await requirePanelUser();
  if (!session) return { error: "not_authorized" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("admin_ui_preferences")
    .delete()
    .eq("user_id", session.id)
    .eq("preference_key", preferenceKey);
  if (error) return { error: "save_failed" };
  return { success: true };
}

export async function getRoleUiDefault(
  roleId: string,
  preferenceKey: string,
): Promise<ListColumnPreference | null> {
  const session = await requireSettingsManage();
  if (!session) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("admin_role_ui_defaults")
    .select("value")
    .eq("role_id", roleId)
    .eq("preference_key", preferenceKey)
    .maybeSingle();
  if (!data?.value || typeof data.value !== "object") return null;
  const v = data.value as Record<string, unknown>;
  if (!Array.isArray(v.order) || !Array.isArray(v.visible)) return null;
  return {
    order: v.order.map(String),
    visible: v.visible.map(String),
    sort:
      v.sort && typeof v.sort === "object" && !Array.isArray(v.sort)
        ? {
            id: String((v.sort as { id?: unknown }).id ?? ""),
            dir: (v.sort as { dir?: string }).dir === "desc" ? "desc" : "asc",
          }
        : null,
  };
}

export async function saveRoleUiDefault(
  roleId: string,
  preferenceKey: string,
  value: ListColumnPreference,
): Promise<{ success?: boolean; error?: string }> {
  const session = await requireSettingsManage();
  if (!session) return { error: "not_authorized" };

  const supabase = await createClient();
  const { error } = await supabase.from("admin_role_ui_defaults").upsert(
    {
      role_id: roleId,
      preference_key: preferenceKey,
      value: value as unknown as Json,
      updated_at: new Date().toISOString(),
      updated_by: session.id,
    },
    { onConflict: "role_id,preference_key" },
  );
  if (error) return { error: "save_failed" };

  void logAdminMutation({
    action: "update",
    entityType: "admin_role_ui_default",
    entityId: roleId,
    routeName: "saveRoleUiDefault",
    after: { preference_key: preferenceKey },
  });
  return { success: true };
}
