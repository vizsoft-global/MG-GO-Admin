import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { DriverDetailPageShell } from "@/features/drivers/driver-detail-page-shell";

export default async function DriverDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "drivers.view");

  return <DriverDetailPageShell id={id} />;
}
