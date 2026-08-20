import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { VehicleTypesPanel } from "@/features/vehicles/vehicle-types-panel";
import { listVehicleTypes } from "@/features/vehicles/vehicles-actions";

export default async function VehicleTypesSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "vehicles.manage");

  const types = await listVehicleTypes();
  return <VehicleTypesPanel types={types} />;
}
