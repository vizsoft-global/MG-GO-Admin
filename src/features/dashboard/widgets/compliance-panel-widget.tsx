"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { ShieldAlert } from "lucide-react";
import { StatusPill } from "@/components/dashboard/status-pill";
import { buildGpsCompliance } from "@/features/locations/location-dashboard-helpers";
import { useDriverLocationsRealtime } from "@/features/locations/use-driver-locations-realtime";
import type { DashboardSnapshot } from "../types";
import { DashboardWidget } from "./dashboard-widget";

export function CompliancePanelWidget({ snapshot }: { snapshot: DashboardSnapshot }) {
  const t = useTranslations("pages.dashboard");
  const { locations } = useDriverLocationsRealtime();

  const items = useMemo(() => {
    const liveIds = new Set(locations.map((l) => l.driverId));
    const onDutyWithoutGps = snapshot.workforceQueue
      .filter((row) => row.shiftLabel === "on_duty" && row.linkedProfileId)
      .filter((row) => !liveIds.has(row.linkedProfileId!))
      .map((row) => ({
        driverId: row.linkedProfileId!,
        driverName: row.driverName,
        driverCode: row.driverCode,
      }));

    return buildGpsCompliance(locations, onDutyWithoutGps);
  }, [locations, snapshot.workforceQueue]);

  return (
    <DashboardWidget title={t("widgetCompliance")}>
      <ul className="divide-y divide-border">
        {items.length === 0 ? (
          <li className="px-4 py-6 text-center text-xs text-muted-foreground">
            {t("noComplianceIssues")}
          </li>
        ) : null}
        {items.map((item) => (
          <li key={item.id} className="flex items-start gap-3 px-4 py-3">
            <ShieldAlert
              className={`mt-0.5 size-4 shrink-0 ${item.severity === "danger" ? "text-destructive" : "text-warning"}`}
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">
                {item.driverName}{" "}
                <span className="text-muted-foreground">#{item.driverCode}</span>
              </p>
              <p className="text-xs text-muted-foreground">
                {t(`compliance.${item.issueKey}`)}
              </p>
            </div>
            <StatusPill variant={item.severity === "danger" ? "danger" : "warning"}>
              {t(`complianceSeverity.${item.severity}`)}
            </StatusPill>
          </li>
        ))}
      </ul>
    </DashboardWidget>
  );
}
