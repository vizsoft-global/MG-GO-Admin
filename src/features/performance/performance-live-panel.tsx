"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import {
  ExternalLink,
  Handshake,
  Loader2,
  Map as MapIcon,
  Radio,
  Trophy,
  Truck,
} from "lucide-react";
import { AppEmptyState } from "@/components/app/app-empty-state";
import { KpiGrid } from "@/components/dashboard/kpi-grid";
import { StatusPill } from "@/components/dashboard/status-pill";
import { Link } from "@/i18n/navigation";
import { useDriverLocationsRealtime } from "@/features/locations/use-driver-locations-realtime";
import { queryKeys } from "@/lib/query/query-keys";
import { useRealtimeInvalidator } from "@/lib/realtime/use-realtime-invalidator";
import { DpdDistributionCard } from "./dpd-distribution-card";
import { kuwaitToday } from "./performance-formulas";
import { useDpdLiveSnapshot, useRecentDeliveriesFeed } from "./use-performance";

export function PerformanceLivePanel() {
  const t = useTranslations("pages.performance");
  const tl = useTranslations("pages.performance.live");
  const today = kuwaitToday();

  const { locations, isLoading: locLoading } = useDriverLocationsRealtime();
  const { data: feed, isLoading: feedLoading } = useRecentDeliveriesFeed(40, {
    refetchInterval: 30_000,
  });
  const { data: snapshot, isLoading: snapLoading } = useDpdLiveSnapshot(today);

  useRealtimeInvalidator({
    channel: "admin-performance-live",
    tables: [
      { table: "deliveries" },
      { table: "drivers" },
      { table: "attendance_logs" },
    ],
    invalidateKeys: [
      queryKeys.performance.recentDeliveries(40),
      queryKeys.performance.liveSnapshot(today),
      queryKeys.performance.all(),
    ],
  });

  const onDuty = useMemo(
    () =>
      locations
        .filter((l) => l.isOnDuty)
        .sort((a, b) => a.driverName.localeCompare(b.driverName)),
    [locations],
  );

  const sortedFeed = useMemo(() => {
    const rows = [...(feed ?? [])];
    rows.sort((a, b) => {
      const at = a.delivered_at ?? a.created_at;
      const bt = b.delivered_at ?? b.created_at;
      return bt.localeCompare(at);
    });
    return rows;
  }, [feed]);

  const deliveries = snapshot?.deliveries;
  const roster = snapshot?.roster;
  const alerts = snapshot?.alerts;
  const alertTotal =
    (alerts?.out_of_zone ?? 0) + (alerts?.gps_offline ?? 0);
  const leaderboard = snapshot?.leaderboard ?? [];

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <KpiGrid
        compact
        items={[
          {
            label: tl("kpiCreated"),
            value: deliveries?.created ?? "—",
            accent: "primary",
          },
          {
            label: tl("kpiInTransit"),
            value: deliveries?.in_transit ?? "—",
          },
          {
            label: tl("kpiUnderReview"),
            value: (deliveries?.under_review ?? 0) + (deliveries?.pending ?? 0),
            caption: tl("kpiUnderReviewHint"),
          },
          {
            label: tl("kpiVerified"),
            value: deliveries?.verified ?? "—",
            accent: "success",
          },
          {
            label: tl("kpiOnDuty"),
            value: roster ? `${roster.on_duty}/${roster.active_drivers}` : "—",
            caption: roster
              ? tl("kpiOnDutyHint", { live: roster.tracking_live })
              : undefined,
          },
          {
            label: tl("kpiAlerts"),
            value: alerts ? alertTotal : "—",
            accent: alertTotal > 0 ? "danger" : "default",
            caption: alerts
              ? tl("kpiAlertsHint", {
                  outOfZone: alerts.out_of_zone,
                  offline: alerts.gps_offline,
                })
              : undefined,
          },
        ]}
      />

      <div className="grid gap-2 lg:grid-cols-2 lg:items-stretch">
        <div className="flex h-[min(300px,34dvh)] flex-col rounded-xl border border-border bg-card shadow-sm">
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
            <div className="flex items-center gap-2">
              <Trophy className="size-4 text-amber-600" />
              <h3 className="text-sm font-semibold">{tl("leaderboardTitle")}</h3>
            </div>
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {tl("leaderboardLegend")}
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {snapLoading && leaderboard.length === 0 ? (
              <div className="flex justify-center py-10">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : leaderboard.length === 0 ? (
              <AppEmptyState
                title={tl("leaderboardEmpty")}
                description={tl("leaderboardEmptyHint")}
              />
            ) : (
              <ol className="divide-y divide-border">
                {leaderboard.map((row, index) => (
                  <li
                    key={row.driver_id}
                    className="flex items-center gap-3 px-4 py-2 transition-colors hover:bg-muted/20"
                  >
                    <span className="w-5 shrink-0 text-center text-xs font-semibold tabular-nums text-muted-foreground">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {row.driver_name}
                      </p>
                      <p className="truncate text-[10px] text-muted-foreground">
                        {row.driver_code}
                        {row.zone_name ? ` · ${row.zone_name}` : ""}
                        {row.partner_name ? ` · ${row.partner_name}` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-emerald-800">
                        {row.verified}
                      </span>
                      <span className="text-[11px] tabular-nums text-muted-foreground">
                        {tl("submittedShort", { count: row.submitted })}
                      </span>
                      <Link
                        href={`/drivers/${row.driver_id}`}
                        className="inline-flex items-center rounded-md p-1 text-primary transition-colors hover:bg-primary/10"
                        aria-label={t("viewDetails")}
                        title={t("viewDetails")}
                      >
                        <ExternalLink className="size-3.5" />
                      </Link>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>

        <div className="grid h-[min(300px,34dvh)] gap-2 sm:grid-cols-2">
          <DpdDistributionCard
            title={tl("zonesTitle")}
            icon={MapIcon}
            rows={snapshot?.zones ?? []}
          />
          <DpdDistributionCard
            title={tl("partnersTitle")}
            icon={Handshake}
            rows={snapshot?.partners ?? []}
          />
        </div>
      </div>

      <div className="grid gap-2 lg:grid-cols-2 lg:items-stretch">
        <div className="flex h-[min(260px,30dvh)] flex-col rounded-xl border border-border bg-card shadow-sm">
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
            <div className="flex items-center gap-2">
              <Radio className="size-4 text-emerald-600" />
              <h3 className="text-sm font-semibold">{t("liveOnDutyTitle")}</h3>
              <span className="rounded-md border border-emerald-200 bg-emerald-50 px-1.5 text-[10px] font-semibold text-emerald-800">
                {t("liveBadge")}
              </span>
            </div>
            <span className="text-sm font-semibold tabular-nums text-foreground">
              {onDuty.length}
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {locLoading && onDuty.length === 0 ? (
              <div className="flex justify-center py-10">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : onDuty.length === 0 ? (
              <AppEmptyState
                title={t("liveOnDutyEmpty")}
                description={t("liveOnDutyEmptyHint")}
              />
            ) : (
              <ul className="divide-y divide-border">
                {onDuty.map((d) => (
                  <li
                    key={d.driverId}
                    className="flex items-center justify-between gap-3 px-4 py-2.5 transition-colors hover:bg-muted/20"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {d.driverName}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {d.driverCode}
                        {d.restaurantName ? ` · ${d.restaurantName}` : ""}
                      </p>
                      <Link
                        href={`/drivers/${d.driverId}`}
                        className="inline-flex items-center gap-1 text-[10px] text-primary hover:bg-primary/10"
                      >
                        <ExternalLink className="size-3" />
                        {t("viewDetails")}
                      </Link>
                    </div>
                    <StatusPill variant="success">{t("onDuty")}</StatusPill>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="flex h-[min(260px,30dvh)] flex-col rounded-xl border border-border bg-card shadow-sm">
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
            <div className="flex items-center gap-2">
              <Truck className="size-4 text-primary" />
              <h3 className="text-sm font-semibold">
                {t("liveDeliveriesTitle")}
              </h3>
              <span className="rounded-md border border-emerald-200 bg-emerald-50 px-1.5 text-[10px] font-semibold text-emerald-800">
                {t("liveBadge")}
              </span>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {feedLoading && sortedFeed.length === 0 ? (
              <div className="flex justify-center py-10">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : sortedFeed.length === 0 ? (
              <AppEmptyState
                title={t("liveDeliveriesEmpty")}
                description={t("liveDeliveriesEmptyHint")}
              />
            ) : (
              <ul className="divide-y divide-border">
                {sortedFeed.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-center justify-between gap-3 px-4 py-2.5 transition-colors hover:bg-muted/20"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {item.driver_name}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {item.driver_code}
                        {item.partner_name ? ` · ${item.partner_name}` : ""}
                        {item.zone_name ? ` · ${item.zone_name}` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <StatusPill
                        variant={
                          item.status === "verified"
                            ? "success"
                            : item.status === "rejected" ||
                                item.status === "cancelled"
                              ? "danger"
                              : "neutral"
                        }
                      >
                        {item.status}
                      </StatusPill>
                      <span className="text-[10px] tabular-nums text-muted-foreground">
                        {new Date(
                          item.delivered_at ?? item.created_at,
                        ).toLocaleString()}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {snapshot ? (
        <p className="text-[10px] text-muted-foreground">
          {tl("scoreToday", {
            score: snapshot.score.avg_overall ?? "—",
            checkedIn: snapshot.roster.checked_in,
          })}
        </p>
      ) : null}
    </div>
  );
}
