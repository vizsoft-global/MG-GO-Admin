import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { getAppSettings } from "@/lib/branding/get-app-settings";
import { DriverAppSettingsPanel } from "@/features/settings/driver-app-settings-panel";

export default async function DriverAppSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "settings.manage");

  const settings = await getAppSettings();

  return (
    <DriverAppSettingsPanel
      driverAppTitle={settings.driverAppTitle}
      driverAppLogoUrl={settings.driverAppLogoUrl}
      driverAppSplashUrl={settings.driverAppSplashUrl}
      driverAppIconUrl={settings.driverAppIconUrl}
      driverAppMaintenanceMode={settings.driverAppMaintenanceMode}
      driverAppMaintenanceMessage={settings.driverAppMaintenanceMessage}
      driverAppDeliveryProximityMeters={settings.driverAppDeliveryProximityMeters}
    />
  );
}
