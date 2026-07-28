import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { DriverGroupsPageShell } from "@/features/driver-groups/driver-groups-page-shell";

export default async function DriverGroupsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "driver_groups.view");
  return <DriverGroupsPageShell />;
}
