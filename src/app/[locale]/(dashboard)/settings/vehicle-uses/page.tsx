import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { VehicleUseTypesPanel } from "@/features/vehicles/vehicle-use-types-panel";
import { listVehicleUseTypesWithUsage } from "@/features/vehicles/vehicle-use-types-actions";

export default async function VehicleUsesSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "settings.manage");

  const types = await listVehicleUseTypesWithUsage();
  return <VehicleUseTypesPanel types={types} />;
}
