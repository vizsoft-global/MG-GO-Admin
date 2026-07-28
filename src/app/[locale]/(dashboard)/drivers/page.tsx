import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { logAdminPageView } from "@/lib/audit/log-admin-activity";
import { DriversPageShell } from "@/features/drivers/drivers-page-shell";

export default async function DriversPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "drivers.view");
  void logAdminPageView("/drivers", "DriversPage");

  return <DriversPageShell />;
}
