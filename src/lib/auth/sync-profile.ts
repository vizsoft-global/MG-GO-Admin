import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { canAccessAdminPanel } from "@/lib/auth/permissions";
import { toAuthProfile, type EnrichedProfile } from "@/lib/auth/profile-auth";
import { getAppOpsSettings } from "@/lib/auth/app-settings";

type Supabase = SupabaseClient<Database>;

export async function syncAdminProfile(
  supabase: Supabase,
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

  const { data: existingProfile } = await supabase
    .from("profiles")
    .select("*, admin_role_id, approval_status, approved_at, approved_by")
    .eq("id", user.id)
    .maybeSingle();

  const existing = existingProfile as EnrichedProfile | null;

  if (existing?.approval_status === "rejected") {
    return { ok: false, reason: "not_authorized" };
  }

  const { data: allowlist } = await supabase
    .from("admin_allowlist")
    .select("role")
    .eq("email", email)
    .maybeSingle();

  const isExistingApproved =
    existing?.approval_status === "approved" && existing.admin_role_id;

  if (!allowlist && !isExistingApproved && ops.superAdminClaimed) {
    if (!existing) {
      const { error: insertError } = await supabase.from("profiles").upsert({
        id: user.id,
        email,
        full_name: fullName ?? null,
        role: "staff",
        locale: locale,
        approval_status: "pending",
        updated_at: new Date().toISOString(),
      } as never);

      if (insertError) {
        return { ok: false, reason: "no_profile" };
      }
      return { ok: true, approvalStatus: "pending" };
    }
  }

  const role = allowlist?.role ?? existing?.role ?? "staff";

  const { error: upsertError } = await supabase.from("profiles").upsert({
    id: user.id,
    email,
    full_name: fullName ?? existing?.full_name ?? null,
    avatar_url: existing?.avatar_url ?? null,
    role,
    locale: existing?.locale ?? locale,
    admin_role_id: existing?.admin_role_id ?? null,
    approval_status: existing?.approval_status ?? "pending",
    updated_at: new Date().toISOString(),
  } as never);

  if (upsertError) {
    return { ok: false, reason: "no_profile" };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "*, admin_role_id, approval_status, approved_at, approved_by, admin_roles(is_super_admin)",
    )
    .eq("id", user.id)
    .single();

  if (!profile) {
    return { ok: false, reason: "no_profile" };
  }

  const enriched = profile as EnrichedProfile & {
    admin_roles: { is_super_admin: boolean } | null;
  };
  const isSuperAdmin = enriched.admin_roles?.is_super_admin === true;
  const authProfile = toAuthProfile(enriched, isSuperAdmin);

  if (enriched.approval_status === "pending") {
    return { ok: true, approvalStatus: "pending" };
  }

  if (!canAccessAdminPanel(authProfile)) {
    return { ok: false, reason: "not_authorized" };
  }

  return { ok: true, approvalStatus: "approved" };
}
