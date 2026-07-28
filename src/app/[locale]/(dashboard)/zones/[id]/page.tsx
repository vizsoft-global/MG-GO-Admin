import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { ZoneDetailPageShell } from "@/features/zones/zone-detail-page-shell";

export default async function ZoneDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "zones.view");

  return <ZoneDetailPageShell id={id} />;
}
