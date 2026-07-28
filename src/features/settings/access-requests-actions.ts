"use server";

import { updateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/get-session";

async function requireSuperAdmin() {
  const session = await getSessionUser();
  if (!session?.isSuperAdmin) {
    return { error: "not_authorized" as const };
  }
  return { session };
}

export async function approveUser(
  userId: string,
  roleId: string,
): Promise<{ error?: string; success?: boolean }> {
  const auth = await requireSuperAdmin();
  if ("error" in auth) return auth;

  const supabase = await createClient();

  const { data: role } = await supabase
    .from("admin_roles")
    .select("id, is_super_admin")
    .eq("id", roleId)
    .maybeSingle();

  if (!role || role.is_super_admin) {
    return { error: "invalid_role" };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("email, role, approval_status")
    .eq("id", userId)
    .maybeSingle();

  if (
    !profile?.email ||
    profile.role !== "staff" ||
    profile.approval_status !== "pending"
  ) {
    return { error: "user_not_found" };
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      admin_role_id: roleId,
      approval_status: "approved",
      role: "staff",
      approved_at: new Date().toISOString(),
      approved_by: auth.session.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId)
    .eq("role", "staff");

  if (error) {
    return { error: "save_failed" };
  }

  await supabase.from("admin_allowlist").upsert({
    email: profile.email.toLowerCase(),
    role: "staff",
  });

  updateTag("admin-roles");
  return { success: true };
}

export async function rejectUser(userId: string): Promise<{ error?: string; success?: boolean }> {
  const auth = await requireSuperAdmin();
  if ("error" in auth) return auth;

  const supabase = await createClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, approval_status")
    .eq("id", userId)
    .maybeSingle();

  if (
    !profile ||
    profile.role !== "staff" ||
    profile.approval_status !== "pending"
  ) {
    return { error: "user_not_found" };
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      approval_status: "rejected",
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId)
    .eq("role", "staff");

  if (error) {
    return { error: "save_failed" };
  }

  return { success: true };
}

export async function setMaintenanceMode(
  enabled: boolean,
): Promise<{ error?: string; success?: boolean }> {
  const auth = await requireSuperAdmin();
  if ("error" in auth) return auth;

  const supabase = await createClient();
  const { error } = await supabase
    .from("app_settings")
    .update({
      maintenance_mode: enabled,
      updated_at: new Date().toISOString(),
      updated_by: auth.session.id,
    })
    .eq("id", 1);

  if (error) {
    return { error: "save_failed" };
  }

  updateTag("app-settings");
  updateTag("app-ops-settings");
  return { success: true };
}
