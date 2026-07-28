import { setRequestLocale } from "next-intl/server";
import { requireSuperAdmin } from "@/lib/auth/require-super-admin";
import { logAdminPageView } from "@/lib/audit/log-admin-activity";
import { getAllAdminRoles } from "@/lib/auth/get-role-permissions";
import { syncAdminPermissionsFromCatalog } from "@/lib/auth/sync-admin-permissions";
import { createClient } from "@/lib/supabase/server";
import { getRoleUsageCounts } from "@/features/settings/roles-actions";
import { RolesPermissionsPanel } from "@/features/settings/roles-permissions-panel";

export default async function RolesPermissionsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireSuperAdmin(locale);
  void logAdminPageView("/settings/roles", "RolesPermissionsPage");

  await syncAdminPermissionsFromCatalog();

  const supabase = await createClient();
  const [allRoles, usageCounts] = await Promise.all([
    getAllAdminRoles(),
    getRoleUsageCounts(),
  ]);

  const { data: permissions } = await supabase
    .from("admin_permissions")
    .select("slug, label, category")
    .order("category")
    .order("label");

  return (
    <div className="w-full min-w-0 max-w-none">
      <RolesPermissionsPanel
        roles={allRoles}
        permissions={permissions ?? []}
        usageCounts={usageCounts}
      />
    </div>
  );
}
