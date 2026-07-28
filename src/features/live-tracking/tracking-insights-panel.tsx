"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, BatteryLow, Gauge, Timer } from "lucide-react";
import type { DriverLiveLocation } from "@/features/locations/types";
import { cn } from "@/lib/utils";
import { TrackingGlassCard } from "./tracking-shell";

const OVERSPEED_KMH = 80;

export function TrackingInsightsPanel({
  drivers,
  staleOnDutyCount = 0,
  className,
}: {
  drivers: DriverLiveLocation[];
  staleOnDutyCount?: number;
  className?: string;
}) {
  const t = useTranslations("pages.liveTracking");

  const insights = useMemo(() => {
    const overspeed = drivers.filter(
      (d) => d.speedMps != null && d.speedMps * 3.6 > OVERSPEED_KMH,
    ).length;
    const idle = drivers.filter((d) => d.trackingStatus === "idle").length;
    const batteryLow = drivers.filter(
      (d) => d.batteryPct != null && d.batteryPct < 20,
    ).length;
    const gpsAlerts = drivers.filter((d) => d.pinStatus === "alert").length;
    const outOfZone = drivers.filter((d) => d.zoneStatus === "out_of_zone").length;

    return [
      {
        id: "offline",
        icon: Timer,
        label: t("insightOffline"),
        count: staleOnDutyCount,
        tone: "text-slate-600 dark:text-slate-400",
      },
      {
        id: "outOfZone",
        icon: Timer,
        label: t("insightOutOfZone"),
        count: outOfZone,
        tone: "text-amber-600 dark:text-amber-400",
      },
      {
        id: "overspeed",
        icon: Gauge,
        label: t("insightOverspeed"),
        count: overspeed,
        tone: "text-rose-600 dark:text-rose-400",
      },
      {
        id: "idle",
        icon: AlertTriangle,
        label: t("insightIdle"),
        count: idle,
        tone: "text-slate-600 dark:text-slate-300",
      },
      {
        id: "battery",
        icon: BatteryLow,
        label: t("insightBattery"),
        count: batteryLow,
        tone: "text-orange-600 dark:text-orange-400",
      },
      {
        id: "gps",
        icon: AlertTriangle,
        label: t("insightGps"),
        count: gpsAlerts,
        tone: "text-rose-600 dark:text-rose-400",
      },
    ];
  }, [drivers, staleOnDutyCount, t]);

  return (
    <TrackingGlassCard
      className={cn(
        "border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900",
        className,
      )}
    >
      <div className="mb-1.5 flex items-center justify-between">
        <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
          {t("aiInsights")}
        </h3>
      </div>
      <ul className="grid grid-cols-6 gap-1.5">
        {insights.map((item) => (
          <li
            key={item.id}
            className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-1 text-xs transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800/60 dark:hover:bg-slate-800"
          >
            <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-white dark:bg-slate-900">
              <item.icon className={cnIcon(item.tone)} />
            </span>
            <span className="min-w-0 flex-1 truncate text-[10px] leading-tight text-slate-700 dark:text-slate-200">
              {item.label}
            </span>
            <span className={cnCount(item.count)}>{item.count}</span>
          </li>
        ))}
      </ul>
    </TrackingGlassCard>
  );
}

function cnIcon(tone: string) {
  return `h-3 w-3 shrink-0 ${tone}`;
}

function cnCount(count: number) {
  return `shrink-0 rounded-full bg-background px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
    count > 0 ? "text-foreground" : "text-muted-foreground"
  }`;
}
