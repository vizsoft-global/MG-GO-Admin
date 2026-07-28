import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { DriverGroupCreatePageShell } from "@/features/driver-groups/driver-group-create-page-shell";

export default async function DriverGroupCreatePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "driver_groups.manage");
  return <DriverGroupCreatePageShell />;
}
