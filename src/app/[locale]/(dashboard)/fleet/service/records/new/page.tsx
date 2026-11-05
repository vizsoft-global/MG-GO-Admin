import { setRequestLocale } from "next-intl/server";
import { ServiceRecordForm } from "@/features/fleet/service/service-record-form";
import { requirePermission } from "@/lib/auth/require-permission";

export default async function NewServiceRecordPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ vehicleId?: string }>;
}) {
  const { locale } = await params;
  const { vehicleId } = await searchParams;
  setRequestLocale(locale);
  await requirePermission(locale, "service.manage");

  return <ServiceRecordForm initialVehicleId={vehicleId ?? ""} />;
}
