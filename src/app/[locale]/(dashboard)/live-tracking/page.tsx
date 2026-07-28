import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { logAdminPageView } from "@/lib/audit/log-admin-activity";
import { LiveTrackingPageShell } from "@/features/live-tracking/live-tracking-page-shell";

export default async function LiveTrackingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "drivers.view");
  void logAdminPageView("/live-tracking", "LiveTrackingPage");

  return <LiveTrackingPageShell />;
}
