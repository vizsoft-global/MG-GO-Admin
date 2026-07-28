import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { DriverGroupDetailPageShell } from "@/features/driver-groups/driver-group-detail-page-shell";

export default async function DriverGroupDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "driver_groups.view");
  return <DriverGroupDetailPageShell groupId={id} />;
}
