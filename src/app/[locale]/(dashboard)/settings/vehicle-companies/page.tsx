import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { VehicleCompaniesPanel } from "@/features/vehicles/vehicle-companies-panel";
import { listVehicleCompaniesWithUsage } from "@/features/vehicles/vehicle-companies-actions";

export default async function VehicleCompaniesSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "vehicles.manage");

  const companies = await listVehicleCompaniesWithUsage();
  return <VehicleCompaniesPanel companies={companies} />;
}
