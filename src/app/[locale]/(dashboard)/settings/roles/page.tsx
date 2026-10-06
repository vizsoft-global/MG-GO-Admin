import { setRequestLocale } from "next-intl/server";
import { requireSuperAdmin } from "@/lib/auth/require-super-admin";
import { logAdminPageView } from "@/lib/audit/log-admin-activity";
import { getAllAdminRoles } from "@/lib/auth/get-role-permissions";
import { syncAdminPermissionsFromCatalog } from "@/lib/auth/sync-admin-permissions";
import { createClient } from "@/lib/supabase/server";
import { getRoleUsageCounts } from "@/features/settings/roles-actions";
import {
  listRequestTypeOptions,
  listStaffAccess,
} from "@/features/settings/staff-access-actions";
import { RolesAccessPage } from "@/features/settings/access-control/roles-access-page";

export default async function RolesPermissionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ user?: string; tab?: string }>;
}) {
  const { locale } = await params;
  const query = await searchParams;
  setRequestLocale(locale);
  await requireSuperAdmin(locale);
  void logAdminPageView("/settings/roles", "RolesPermissionsPage");

  await syncAdminPermissionsFromCatalog();

  const supabase = await createClient();
  const [allRoles, usageCounts, listed, requestTypes, permissionsResult] = await Promise.all([
    getAllAdminRoles(),
    getRoleUsageCounts(),
    listStaffAccess(),
    listRequestTypeOptions(),
    supabase.from("admin_permissions").select("slug, label, category").order("category").order("label"),
  ]);

  return (
    <div className="w-full min-w-0 max-w-none">
      <RolesAccessPage
        tab={query.tab === "roles" ? "roles" : "staff"}
        userId={query.user ?? null}
        rows={listed.rows ?? []}
        loadError={listed.error}
        roles={allRoles}
        requestTypes={requestTypes.rows ?? []}
        permissions={permissionsResult.data ?? []}
        usageCounts={usageCounts}
      />
    </div>
  );
}
