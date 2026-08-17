"use client";

/**
 * The dockable insights column.
 *
 * Three reference blocks, adapted: the segmented "Status Performance Overview" becomes a
 * status distribution bar; the US choropleth becomes a compact zone list (a Kuwait-zone
 * choropleth would be strictly worse than a bar list at this zone count, and the map is
 * already drawing the zones); the KPI tiles stay tiles. The event feed is the piece the
 * reference lacks and ops actually needs.
 */

import { useMemo, type WheelEvent } from "react";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Gauge,
  MapPinOff,
  Package,
  Signal,
  Timer,
  TrendingUp,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { FleetEventFeed } from "./fleet-event-feed";
import {
  FLEET_DISTRIBUTION_BUCKETS,
  fleetStatusTone,
  type FleetDistributionBucket,
  type FleetTone,
} from "./fleet-status";
import { FLEET_TONE_BAR, FLEET_TONE_DOT } from "./fleet-tone";
import { useFleetSnapshot } from "./use-fleet";

const BUCKET_TONE: Record<FleetDistributionBucket, FleetTone> = {
  moving: fleetStatusTone("moving"),
  on_delivery: fleetStatusTone("on_delivery"),
  idle: fleetStatusTone("idle"),
  offline: fleetStatusTone("offline"),
  alert: "danger",
};

const BUCKET_LABEL_KEY: Record<FleetDistributionBucket, string> = {
  moving: "status.moving",
  on_delivery: "status.on_delivery",
  idle: "status.idle",
  offline: "status.offline",
  alert: "kpis.alerts",
};

/** The stacked bar is status only. Alert is a KPI overlay, not an exclusive slice. */
const STATUS_BAR_BUCKETS = FLEET_DISTRIBUTION_BUCKETS.filter(
  (bucket): bucket is Exclude<FleetDistributionBucket, "alert"> => bucket !== "alert",
);

function stopWheelFromReachingMap(event: WheelEvent) {
  event.stopPropagation();
}

export function FleetInsightsPanel({
  collapsed,
  onCollapsedChange,
}: {
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
}) {
  const t = useTranslations("pages.liveTrackingV2");
  const snapshot = useFleetSnapshot();

  const total = useMemo(
    () =>
      STATUS_BAR_BUCKETS.reduce((sum, bucket) => sum + snapshot.counts[bucket], 0),
    [snapshot.counts],
  );

  if (collapsed) {
    return (
      <div className="fleet-overlay pointer-events-auto flex w-12 flex-col items-center gap-2 rounded-xl border p-1.5 shadow-sm">
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-8"
          aria-label={t("insights.expand")}
          onClick={() => onCollapsedChange?.(false)}
        >
          <ChevronLeft className="size-4 rtl:rotate-180" aria-hidden />
        </Button>
        <span className="flex flex-col items-center text-[10px] font-semibold tabular-nums">
          <Signal className="size-3.5 text-muted-foreground" aria-hidden />
          {snapshot.kpis.online}
        </span>
        <span className="flex flex-col items-center text-[10px] font-semibold tabular-nums text-rose-700">
          <AlertTriangle className="size-3.5" aria-hidden />
          {snapshot.kpis.alerts}
        </span>
      </div>
    );
  }

  return (
    <div
      className="fleet-overlay pointer-events-auto flex h-full min-h-0 w-[340px] flex-col rounded-xl border shadow-sm"
      onWheel={stopWheelFromReachingMap}
    >
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border/60 px-2">
        <TrendingUp className="size-3.5 text-muted-foreground" aria-hidden />
        <span className="text-xs font-semibold">{t("insights.heading")}</span>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="ms-auto size-7"
          aria-label={t("insights.collapse")}
          onClick={() => onCollapsedChange?.(true)}
        >
          <ChevronRight className="size-4 rtl:rotate-180" aria-hidden />
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <section className="shrink-0 border-b border-border/60 px-2 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t("insights.statusDistribution")}
          </p>
          <div className="mt-1.5 flex h-2 w-full overflow-hidden rounded-full bg-muted">
            {STATUS_BAR_BUCKETS.map((bucket) => {
              const count = snapshot.counts[bucket];
              if (count === 0) return null;
              return (
                <span
                  key={bucket}
                  className={cn("h-full transition-[width] duration-200 ease-out", FLEET_TONE_BAR[BUCKET_TONE[bucket]])}
                  style={{ width: `${total > 0 ? (count / total) * 100 : 0}%` }}
                />
              );
            })}
          </div>
          <ul className="mt-1.5 grid grid-cols-2 gap-x-2 gap-y-0.5">
            {FLEET_DISTRIBUTION_BUCKETS.map((bucket) => {
              const count =
                bucket === "alert" ? snapshot.kpis.alerts : snapshot.counts[bucket];
              const share =
                bucket === "alert" || total === 0 ? null : Math.round((count / total) * 100);
              return (
                <li
                  key={bucket}
                  className="flex items-center gap-1.5 text-[10px] text-muted-foreground"
                >
                  <span
                    className={cn("size-2 shrink-0 rounded-full", FLEET_TONE_DOT[BUCKET_TONE[bucket]])}
                    aria-hidden
                  />
                  <span className="truncate">{t(BUCKET_LABEL_KEY[bucket] as never)}</span>
                  <span className="ms-auto font-semibold tabular-nums text-foreground">
                    {count}
                  </span>
                  {share != null ? (
                    <span className="w-8 text-end tabular-nums">{share}%</span>
                  ) : (
                    <span className="w-8" />
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        <section className="shrink-0 border-b border-border/60 px-2 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t("insights.kpis")}
          </p>
          <div className="mt-1.5 grid grid-cols-3 gap-1">
            <Kpi icon={<Timer className="size-3" />} label={t("kpis.onDuty")} value={snapshot.kpis.onDuty} />
            <Kpi icon={<Signal className="size-3" />} label={t("kpis.online")} value={snapshot.kpis.online} />
            <Kpi
              icon={<Package className="size-3" />}
              label={t("kpis.inProgress")}
              value={snapshot.kpis.onDelivery}
            />
            <Kpi
              icon={<MapPinOff className="size-3" />}
              label={t("kpis.outOfZone")}
              value={snapshot.kpis.outOfZone}
              tone={snapshot.kpis.outOfZone > 0 ? "danger" : undefined}
            />
            <Kpi
              icon={<Gauge className="size-3" />}
              label={t("kpis.avgSpeed")}
              value={`${Math.round(snapshot.kpis.avgSpeedKmh)}`}
              suffix="km/h"
            />
            <Kpi
              icon={<AlertTriangle className="size-3" />}
              label={t("kpis.alerts")}
              value={snapshot.kpis.alerts}
              tone={snapshot.kpis.alerts > 0 ? "danger" : undefined}
            />
          </div>
        </section>

        <section className="max-h-[28%] shrink-0 overflow-y-auto overscroll-contain border-b border-border/60 px-2 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t("insights.zoneDistribution")}
          </p>
          {snapshot.zoneCounts.length === 0 ? (
            <p className="mt-1.5 text-[10px] text-muted-foreground">
              {t("insights.noZoneDrivers")}
            </p>
          ) : (
            <ul className="mt-1.5 space-y-1">
              {snapshot.zoneCounts.map((entry) => {
                const max = snapshot.zoneCounts[0]?.count || 1;
                return (
                  <li key={entry.zoneId ?? "none"} className="flex items-center gap-1.5">
                    <span className="w-24 truncate text-[10px]">{entry.zoneName}</span>
                    <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                      <span
                        className="fleet-progress-fill block h-full rounded-full"
                        style={{ width: `${(entry.count / max) * 100}%` }}
                      />
                    </span>
                    <span className="w-6 text-end text-[10px] font-semibold tabular-nums">
                      {entry.count}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <FleetEventFeed />
      </div>
    </div>
  );
}

function Kpi({
  icon,
  label,
  value,
  suffix,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  suffix?: string;
  tone?: FleetTone;
}) {
  return (
    <div className="rounded-md border border-border/60 bg-muted/30 px-1.5 py-1">
      <p className="flex items-center gap-1 text-[9px] leading-tight text-muted-foreground">
        <span className="shrink-0" aria-hidden>
          {icon}
        </span>
        <span className="truncate">{label}</span>
      </p>
      <p
        className={cn(
          "text-sm font-semibold leading-tight tabular-nums",
          tone === "danger" && "text-rose-700",
        )}
      >
        {value}
        {suffix ? (
          <span className="ms-0.5 text-[9px] font-medium text-muted-foreground">{suffix}</span>
        ) : null}
      </p>
    </div>
  );
}
