import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { logAdminPageView } from "@/lib/audit/log-admin-activity";
import { LiveTrackingPageShell } from "@/features/live-tracking/live-tracking-page-shell";

export default async function LiveTrackingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await requirePermission(locale, "drivers.view");
  void logAdminPageView("/live-tracking", "LiveTrackingPage");

  // Live and History stay on drivers.view; only the Activity tab needs the wider
  // audit permission, so it is hidden rather than 403-ing the whole page.
  const canViewActivity = hasPermissionInSet(
    session.permissions,
    "driver_ops.view",
    session.isSuperAdmin,
  );

  return <LiveTrackingPageShell canViewActivity={canViewActivity} />;
}
