import { setRequestLocale } from "next-intl/server";
import { ServiceShell } from "@/features/fleet/service/service-shell";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/require-permission";

export default async function FleetServicePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await requirePermission(locale, "service.view");

  return (
    <ServiceShell
      canManage={hasPermissionInSet(session.permissions, "service.manage", session.isSuperAdmin)}
      canExport={hasPermissionInSet(session.permissions, "service.export", session.isSuperAdmin)}
    />
  );
}

