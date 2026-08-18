import { setRequestLocale } from "next-intl/server";
import { requireSuperAdmin } from "@/lib/auth/require-super-admin";
import { getAllAdminRoles } from "@/lib/auth/get-role-permissions";
import { AccessRequestsPanel } from "@/features/settings/access-requests-panel";
import { listPendingStaffAccessRequests } from "@/features/settings/access-requests-actions";

export default async function AccessRequestsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireSuperAdmin(locale);
  const allRoles = await getAllAdminRoles();

  const pendingUsers = await listPendingStaffAccessRequests();

  const assignableRoles = allRoles.filter((r) => !r.isSuperAdmin);

  return (
    <AccessRequestsPanel
      pendingUsers={pendingUsers ?? []}
      assignableRoles={assignableRoles}
    />
  );
}
