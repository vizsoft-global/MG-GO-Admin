import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { requireSuperAdmin } from "@/lib/auth/require-super-admin";
import { logAdminPageView } from "@/lib/audit/log-admin-activity";
import { getAllAdminRoles } from "@/lib/auth/get-role-permissions";
import { syncAdminPermissionsFromCatalog } from "@/lib/auth/sync-admin-permissions";
import { createClient } from "@/lib/supabase/server";
import { getStaffAccess } from "@/features/settings/staff-access-actions";
import { StaffAccessDetailShell } from "@/features/settings/staff-access-page-shell";

export default async function StaffAccessDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requireSuperAdmin(locale);
  void logAdminPageView(`/settings/staff-access/${id}`, "StaffAccessDetailPage");
  await syncAdminPermissionsFromCatalog();

  const [loaded, roles] = await Promise.all([getStaffAccess(id), getAllAdminRoles()]);
  if (!loaded.detail) notFound();

  const supabase = await createClient();
  const { data: permissions } = await supabase
    .from("admin_permissions")
    .select("slug, label, category")
    .order("category")
    .order("label");

  return (
    <StaffAccessDetailShell
      detail={loaded.detail}
      permissions={permissions ?? []}
      roles={roles.filter((role) => !role.isSuperAdmin)}
    />
  );
}
