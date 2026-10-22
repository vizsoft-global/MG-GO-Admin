import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { logAdminPageView } from "@/lib/audit/log-admin-activity";
import { getAllAdminRoles } from "@/lib/auth/get-role-permissions";
import { syncAdminPermissionsFromCatalog } from "@/lib/auth/sync-admin-permissions";
import { redirect } from "@/i18n/navigation";
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
  await requirePermission(locale, "roles.manage");
  void logAdminPageView("/settings/roles", "RolesPermissionsPage");

  if (query.tab === "roles") {
    redirect({
      href: query.user ? `/settings/roles?user=${query.user}` : "/settings/roles",
      locale,
    });
  }

  await syncAdminPermissionsFromCatalog();

  const [allRoles, listed, requestTypes] = await Promise.all([
    getAllAdminRoles(),
    listStaffAccess(),
    listRequestTypeOptions(),
  ]);

  return (
    <div className="w-full min-w-0 max-w-none">
      <RolesAccessPage
        userId={query.user ?? null}
        rows={listed.rows ?? []}
        loadError={listed.error}
        roles={allRoles}
        requestTypes={requestTypes.rows ?? []}
      />
    </div>
  );
}
