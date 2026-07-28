import { setRequestLocale } from "next-intl/server";
import { requireSuperAdmin } from "@/lib/auth/require-super-admin";
import { getAppOpsSettings } from "@/lib/auth/app-settings";
import { MaintenancePanel } from "@/features/settings/maintenance-panel";

export default async function MaintenancePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireSuperAdmin(locale);
  const ops = await getAppOpsSettings();

  return <MaintenancePanel maintenanceMode={ops.maintenanceMode} />;
}
