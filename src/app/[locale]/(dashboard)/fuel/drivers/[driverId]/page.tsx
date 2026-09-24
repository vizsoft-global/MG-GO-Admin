import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { FuelDriverPageShell } from "@/features/fuel/fuel-driver-page-shell";
import { requirePermission } from "@/lib/auth/require-permission";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function FuelDriverPage({
  params,
}: {
  params: Promise<{ locale: string; driverId: string }>;
}) {
  const { locale, driverId } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "fuel.view");
  if (!UUID.test(driverId)) notFound();
  return <FuelDriverPageShell driverId={driverId} />;
}
