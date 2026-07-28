import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { ZonesPageShell } from "@/features/zones/zones-page-shell";

export default async function ZonesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "zones.view");

  return <ZonesPageShell />;
}
