import { setRequestLocale } from "next-intl/server";

import { requirePermission } from "@/lib/auth/require-permission";
import { logAdminPageView } from "@/lib/audit/log-admin-activity";
import { FleetProvider } from "@/features/live-tracking-v2/use-fleet";
import { FleetCanvas } from "@/features/live-tracking-v2/fleet-canvas";

/**
 * A sibling route, deliberately not nested under `live-tracking/`, so it cannot inherit
 * or perturb that route's layout. Same permission gate as v1 (`drivers.view`): this is
 * the same information, rendered differently. Gate is live_tracking.view so
 * Staff Access can hide the maps without taking Drivers away.
 */
export default async function LiveTrackingV2Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "live_tracking.view");
  void logAdminPageView("/live-tracking-v2", "LiveTrackingV2Page");

  return (
    <FleetProvider>
      <FleetCanvas />
    </FleetProvider>
  );
}
