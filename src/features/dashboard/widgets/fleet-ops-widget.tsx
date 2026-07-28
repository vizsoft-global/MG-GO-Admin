"use client";

import { useQuery } from "@tanstack/react-query";
import { Link } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { AlertTriangle, Radar, Timer, UserCheck } from "lucide-react";
import { MetricTile } from "@/components/ui/metric-tile";
import { fetchFleetOpsCounts } from "@/features/driver-tracking/tracking-read-actions";
import { DashboardWidget } from "./dashboard-widget";

export function FleetOpsWidget() {
  const t = useTranslations("pages.dashboard.fleetOps");
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard", "fleet-ops"],
    queryFn: fetchFleetOpsCounts,
    refetchInterval: 60_000,
  });

  const counts = data ?? {
    on_duty: 0,
    online_sessions: 0,
    unvalidated_today: 0,
    out_of_zone: 0,
  };

  return (
    <DashboardWidget
      title={t("title")}
      href="/live-tracking"
      viewAllLabel={t("openMap")}
      icon={Radar}
      tone="primary"
      className="min-h-0"
    >
      <div className="space-y-3 p-4">
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <MetricTile
            label={t("onDuty")}
            value={isLoading ? "…" : String(counts.on_duty)}
            icon={UserCheck}
            tone="success"
            className="p-2.5"
          />
          <MetricTile
            label={t("online")}
            value={isLoading ? "…" : String(counts.online_sessions)}
            icon={Timer}
            tone="primary"
            className="p-2.5"
          />
          <MetricTile
            label={t("unvalidated")}
            value={isLoading ? "…" : String(counts.unvalidated_today)}
            icon={AlertTriangle}
            tone={counts.unvalidated_today > 0 ? "warning" : "neutral"}
            className="p-2.5"
          />
          <MetricTile
            label={t("outOfZone")}
            value={isLoading ? "…" : String(counts.out_of_zone)}
            icon={Radar}
            tone={counts.out_of_zone > 0 ? "danger" : "neutral"}
            className="p-2.5"
          />
        </div>
        <div className="flex flex-wrap gap-3 border-t border-border pt-3 text-xs">
          <Link href="/attendance" className="font-medium text-primary hover:underline">
            {t("linkAttendance")}
          </Link>
          <Link href="/worktime" className="font-medium text-primary hover:underline">
            {t("linkWorktime")}
          </Link>
          <Link href="/driver-shifts" className="font-medium text-primary hover:underline">
            {t("linkShifts")}
          </Link>
        </div>
      </div>
    </DashboardWidget>
  );
}
