import { setRequestLocale } from "next-intl/server";
import { AccidentForm } from "@/features/fleet/accidents/accident-form";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/require-permission";

/** `?vehicleId=…` comes from the vehicle detail Accident tab. */
export default async function NewAccidentPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ vehicleId?: string }>;
}) {
  const { locale } = await params;
  const { vehicleId } = await searchParams;
  setRequestLocale(locale);
  const session = await requirePermission(locale, "vehicles.manage");
  const canManage = hasPermissionInSet(
    session.permissions,
    "vehicles.manage",
    session.isSuperAdmin,
  );

  return <AccidentForm initialVehicleId={vehicleId ?? ""} canManage={canManage} />;
}
