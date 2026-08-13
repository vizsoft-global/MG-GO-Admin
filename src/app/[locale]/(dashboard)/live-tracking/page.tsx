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

  // Diagnostics reads client telemetry, which is a different surface again, so it
  // has its own slug rather than riding on driver_ops.view.
  const canViewTelemetry = hasPermissionInSet(
    session.permissions,
    "driver_telemetry.view",
    session.isSuperAdmin,
  );
  const canExportTelemetry = hasPermissionInSet(
    session.permissions,
    "driver_telemetry.export",
    session.isSuperAdmin,
  );

  return (
    <LiveTrackingPageShell
      canViewActivity={canViewActivity}
      canViewTelemetry={canViewTelemetry}
      canExportTelemetry={canExportTelemetry}
    />
  );
}
