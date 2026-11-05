import { setRequestLocale } from "next-intl/server";
import { AccidentsPageShell } from "@/features/fleet/accidents/accidents-page-shell";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/require-permission";

/**
 * Accident case list. One page: KPI strip, the three case tabs, the filters, the
 * grouped table and the Excel export. The permission is the existing fleet pair —
 * `vehicles.view` reads and exports, `vehicles.manage` writes. No new slug.
 */
export default async function FleetAccidentPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await requirePermission(locale, "vehicles.view");
  const canManage = hasPermissionInSet(
    session.permissions,
    "vehicles.manage",
    session.isSuperAdmin,
  );

  return <AccidentsPageShell canManage={canManage} canExport />;
}

