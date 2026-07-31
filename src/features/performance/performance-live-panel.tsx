"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { ExternalLink, Loader2, Radio, Truck } from "lucide-react";
import { AppEmptyState } from "@/components/app/app-empty-state";
import { StatusPill } from "@/components/dashboard/status-pill";
import { Link } from "@/i18n/navigation";
import { useDriverLocationsRealtime } from "@/features/locations/use-driver-locations-realtime";
import { queryKeys } from "@/lib/query/query-keys";
import { useRealtimeInvalidator } from "@/lib/realtime/use-realtime-invalidator";
import { useRecentDeliveriesFeed } from "./use-performance";

export function PerformanceLivePanel() {
  const t = useTranslations("pages.performance");
  const { locations, isLoading: locLoading } = useDriverLocationsRealtime();
  const { data: feed, isLoading: feedLoading } = useRecentDeliveriesFeed(40, {
    refetchInterval: 30_000,
  });

  useRealtimeInvalidator({
    channel: "admin-performance-live",
    tables: [
      { table: "deliveries" },
      { table: "drivers" },
      { table: "attendance_logs" },
    ],
    invalidateKeys: [
      queryKeys.performance.recentDeliveries(40),
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

  return (
    <div className="grid gap-2 lg:grid-cols-2 lg:items-stretch">
      <div className="flex h-full flex-col rounded-xl border border-border bg-card shadow-sm">
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
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
                    <p className="truncate text-sm font-medium">{d.driverName}</p>
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

      <div className="flex h-full flex-col rounded-xl border border-border bg-card shadow-sm">
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Truck className="size-4 text-primary" />
            <h3 className="text-sm font-semibold">{t("liveDeliveriesTitle")}</h3>
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
  );
}
