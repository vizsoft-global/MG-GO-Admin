import { setRequestLocale } from "next-intl/server";
import { FleetRequestPageShell } from "@/features/fuel/fleet-request-page-shell";
import { requirePermission } from "@/lib/auth/require-permission";

export default async function AssetRequestsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "requests.view");
  return <FleetRequestPageShell type="asset" />;
}
