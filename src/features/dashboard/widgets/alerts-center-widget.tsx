"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";
import { StatusPill } from "@/components/dashboard/status-pill";
import { buildGpsAlerts } from "@/features/locations/location-dashboard-helpers";
import { useDriverLocationsRealtime } from "@/features/locations/use-driver-locations-realtime";
import { buildOperationalAlerts } from "../dashboard-mock-data";
import type { DashboardSnapshot } from "../types";
import { DashboardWidget } from "./dashboard-widget";

function alertVariant(severity: "info" | "warning" | "danger") {
  if (severity === "danger") return "danger" as const;
  if (severity === "warning") return "warning" as const;
  return "neutral" as const;
}

export function AlertsCenterWidget({ snapshot }: { snapshot: DashboardSnapshot }) {
  const t = useTranslations("pages.dashboard");
  const { locations } = useDriverLocationsRealtime();

  const alerts = useMemo(() => {
    const gps = buildGpsAlerts(locations);
    const operational = buildOperationalAlerts(snapshot);
    return [...gps, ...operational].slice(0, 8);
  }, [locations, snapshot]);

  return (
    <DashboardWidget title={t("widgetAlerts")}>
      <ul className="divide-y divide-border">
        {alerts.length === 0 ? (
          <li className="px-4 py-6 text-center text-xs text-muted-foreground">
            {t("noAlerts")}
          </li>
        ) : null}
        {alerts.map((alert) => (
          <li key={alert.id} className="flex items-start gap-3 px-4 py-3">
            <AlertTriangle
              className={`mt-0.5 size-4 shrink-0 ${alert.severity === "danger" ? "text-destructive" : alert.severity === "warning" ? "text-warning" : "text-muted-foreground"}`}
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium">{t(`alerts.${alert.messageKey}`)}</p>
                {alert.isLive ? (
                  <span className="rounded-full bg-success-bg px-1.5 py-0.5 text-[10px] font-medium text-success">
                    {t("liveBadge")}
                  </span>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground">{alert.detail}</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                {new Date(alert.at).toLocaleTimeString()}
              </p>
            </div>
            <StatusPill variant={alertVariant(alert.severity)}>
              {t(`alertSeverity.${alert.severity}`)}
            </StatusPill>
          </li>
        ))}
      </ul>
    </DashboardWidget>
  );
}
