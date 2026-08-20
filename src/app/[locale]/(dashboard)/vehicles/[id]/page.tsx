import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { VehicleDetailPageShell } from "@/features/vehicles/vehicle-detail-page-shell";
import { getVehicle, listVehicleTypes } from "@/features/vehicles/vehicles-actions";

export default async function VehicleDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ edit?: string }>;
}) {
  const { locale, id } = await params;
  const query = await searchParams;
  setRequestLocale(locale);
  await requirePermission(locale, "vehicles.view");

  const [vehicle, types] = await Promise.all([getVehicle(id), listVehicleTypes()]);
  if (!vehicle) notFound();

  return <VehicleDetailPageShell vehicle={vehicle} types={types} editOpen={query.edit === "1"} />;
}
