import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { getAppSettings } from "@/lib/branding/get-app-settings";
import { DriverAppSettingsPanel } from "@/features/settings/driver-app-settings-panel";
import { HomeBannersPanel } from "@/features/settings/home-banners-panel";
import { listHomeBanners } from "@/features/settings/home-banners-actions";

export default async function DriverAppSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "settings.manage");

  const settings = await getAppSettings();
  const homeBanners = await listHomeBanners();

  return (
    <div className="space-y-4">
      <DriverAppSettingsPanel
        driverAppTitle={settings.driverAppTitle}
        driverAppLogoUrl={settings.driverAppLogoUrl}
        driverAppSplashUrl={settings.driverAppSplashUrl}
        driverAppIconUrl={settings.driverAppIconUrl}
        driverAppMaintenanceMode={settings.driverAppMaintenanceMode}
        driverAppMaintenanceMessage={settings.driverAppMaintenanceMessage}
        driverAppLoginVerificationExemptAll={
          settings.driverAppLoginVerificationExemptAll
        }
        driverAppDeliveryProximityMeters={settings.driverAppDeliveryProximityMeters}
      />
      <HomeBannersPanel banners={homeBanners.banners} lookups={homeBanners.lookups} />
    </div>
  );
}
