import { setRequestLocale } from "next-intl/server";
import { FleetRjPageShell } from "@/features/fleet/fleet-rj-page-shell";
import { requireAnyPermission } from "@/lib/auth/require-permission";

export default async function FleetRjPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAnyPermission(locale, ["fuel.view", "asset_requests.view"]);
  return <FleetRjPageShell />;
}
