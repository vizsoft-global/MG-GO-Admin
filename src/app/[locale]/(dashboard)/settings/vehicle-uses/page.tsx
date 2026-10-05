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
  // Operations owns this list — it is reached from OperationsHub, whose card is
  // gated on `vehicles.manage`. Requiring `settings.manage` here would show the
  // tile to an operations user and then bounce them to /unauthorized.
  await requirePermission(locale, "vehicles.manage");

  const types = await listVehicleUseTypesWithUsage();
  return <VehicleUseTypesPanel types={types} />;
}
