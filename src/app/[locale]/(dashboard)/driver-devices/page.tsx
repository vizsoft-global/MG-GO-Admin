import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { DriverDevicesPageShell } from "@/features/driver-devices/driver-devices-page-shell";

export default async function DriverDevicesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "driver_devices.view");

  return <DriverDevicesPageShell />;
}
