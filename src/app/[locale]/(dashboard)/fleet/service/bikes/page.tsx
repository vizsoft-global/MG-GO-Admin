import { setRequestLocale } from "next-intl/server";
import { ServiceBikeShell } from "@/features/fleet/service/service-maintenance-bike-shell";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/require-permission";

export default async function FleetServiceBikesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await requirePermission(locale, "service.view");

  return (
    <ServiceBikeShell
      canManage={hasPermissionInSet(session.permissions, "service.manage", session.isSuperAdmin)}
      canExport={hasPermissionInSet(session.permissions, "service.export", session.isSuperAdmin)}
    />
  );
}
