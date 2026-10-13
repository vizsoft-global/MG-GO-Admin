import { setRequestLocale } from "next-intl/server";
import { FleetLedgerListShell } from "@/features/fleet/fleet-ledger-list-shell";
import { requirePermission } from "@/lib/auth/require-permission";

export default async function FleetServicePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "vehicles.view");
  return <FleetLedgerListShell kind="service" />;
}
