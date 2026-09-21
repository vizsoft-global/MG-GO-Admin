import { setRequestLocale } from "next-intl/server";
import { requireSuperAdmin } from "@/lib/auth/require-super-admin";
import { logAdminPageView } from "@/lib/audit/log-admin-activity";
import { syncAdminPermissionsFromCatalog } from "@/lib/auth/sync-admin-permissions";
import { listStaffAccess } from "@/features/settings/staff-access-actions";
import { StaffAccessListShell } from "@/features/settings/staff-access-page-shell";

export default async function StaffAccessPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireSuperAdmin(locale);
  void logAdminPageView("/settings/staff-access", "StaffAccessPage");
  await syncAdminPermissionsFromCatalog();

  const listed = await listStaffAccess();

  return <StaffAccessListShell rows={listed.rows ?? []} loadError={listed.error} />;
}
