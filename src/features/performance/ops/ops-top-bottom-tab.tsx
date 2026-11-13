"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { LAYOUT } from "@/components/app/layout-spacing";
import {
  dimMetricValue,
  isChartableDimKey,
  pairTopBottomAuto,
  pairTopBottomDisjoint,
  resolveTopBottomRequestedN,
  storeChartValue,
  type OpsChartMetric,
  type TopBottomShowSelection,
} from "../performance-ops-formulas";
import { downloadCsv, toCsv } from "../performance-ops-table";
import { enrichOpsRider, formatOpsMetricValue } from "../performance-ops-format";
import type { OpsSnapshot } from "../performance-ops-types";
import { OpsChartCard, OpsRankedBars } from "./ops-charts";
import { cn } from "@/lib/utils";

export function OpsTopBottomTab({
  data,
  metric,
  show,
}: {
  data: OpsSnapshot;
  metric: OpsChartMetric;
  show: TopBottomShowSelection;
}) {
  const t = useTranslations("pages.performance.ops");
  const riders = useMemo(() => data.riders.map(enrichOpsRider), [data.riders]);
  const active = riders.filter((r) => r.working_days > 0);
  const stores = data.stores.filter((s) => s.store_name && s.working_days > 0);
  const zones = data.by_zone.filter((z) => isChartableDimKey(z.key) && z.working_days > 0);
  const auto = show.mode === "auto";
  const requestedRiders = resolveTopBottomRequestedN(show, active.length);
  const requestedStores = resolveTopBottomRequestedN(show, stores.length);
  const requestedZones = resolveTopBottomRequestedN(show, zones.length);
  const seriesName = t(`viewBy.${metric}`);

  const byRider = useMemo(
    () =>
      auto
        ? pairTopBottomAuto(
            active,
            (r) => (metric === "orders" ? r.orders : r[metric]),
            requestedRiders,
          )
        : pairTopBottomDisjoint(
            active,
            (r) => (metric === "orders" ? r.orders : r[metric]),
            requestedRiders,
            (r) => r.name,
            (r) => r.working_days,
          ),
    [active, auto, metric, requestedRiders],
  );
  const byStore = useMemo(
    () =>
      auto
        ? pairTopBottomAuto(
            stores,
            (s) => storeChartValue(s, metric, data.kpis.overall_dpd, data.target_dpd),
            requestedStores,
          )
        : pairTopBottomDisjoint(
            stores,
            (s) => storeChartValue(s, metric, data.kpis.overall_dpd, data.target_dpd),
            requestedStores,
            (s) => s.store_name ?? "—",
            (s) => s.working_days,
          ),
    [auto, stores, metric, data.kpis.overall_dpd, data.target_dpd, requestedStores],
  );
  const byZone = useMemo(
    () =>
      auto
        ? pairTopBottomAuto(zones, (z) => dimMetricValue(z, metric), requestedZones)
        : pairTopBottomDisjoint(
            zones,
            (z) => dimMetricValue(z, metric),
            requestedZones,
            (z) => z.label || z.key,
            (z) => z.working_days,
          ),
    [auto, zones, metric, requestedZones],
  );

  const riderTopN = auto ? requestedRiders : byRider.top.length;
  const riderBottomN = auto ? requestedRiders : byRider.bottom.length;
  const storeTopN = auto ? requestedStores : byStore.top.length;
  const storeBottomN = auto ? requestedStores : byStore.bottom.length;
  const zoneTopN = auto ? requestedZones : byZone.top.length;
  const zoneBottomN = auto ? requestedZones : byZone.bottom.length;

  if (active.length === 0 && stores.length === 0 && zones.length === 0) {
    return (
      <div className={cn("flex flex-col", LAYOUT.stackGap)}>
        <p className="text-sm text-muted-foreground">{t("emptyTopBottom")}</p>
        <OpsChartCard title={t("chart.topZones", { n: 0, metric: seriesName })} empty emptyTitle={t("emptyZones")}>
          <div />
        </OpsChartCard>
      </div>
    );
  }

  const showRiderSection = auto ? requestedRiders > 0 : byRider.top.length > 0;
  const showStoreSection = auto ? requestedStores > 0 : byStore.top.length > 0;
  const showZoneSection = auto ? requestedZones > 0 : byZone.top.length > 0;
  const showRiderBottom = auto ? requestedRiders > 0 : byRider.bottom.length > 0;
  const showStoreBottom = auto ? requestedStores > 0 : byStore.bottom.length > 0;
  const showZoneBottom = auto ? requestedZones > 0 : byZone.bottom.length > 0;

  return (
    <div className={cn("flex flex-col", LAYOUT.stackGap)}>
      {showRiderSection ? (
        <section className={cn("flex flex-col", LAYOUT.stackGap)}>
          {auto ? (
            <p className="text-xs text-muted-foreground">{t("topBottomHint", { n: requestedRiders })}</p>
          ) : active.length < requestedRiders ? (
            <p className="text-xs text-muted-foreground">
              {t("topBottomFewerRiders", { count: active.length })}
            </p>
          ) : null}
          <div className="grid gap-2 lg:grid-cols-2 lg:items-stretch">
            <OpsChartCard
              title={t("chart.topMetric", { n: riderTopN, metric: seriesName })}
              onExport={() =>
                downloadCsv(
                  "ops-top-riders",
                  toCsv(
                    ["name", "id", "value", "Restaurant", "zone"],
                    byRider.top.map((r) => [r.name, r.display_id, r.value, r.store_label, r.zone]),
                  ),
                )
              }
            >
              <OpsRankedBars
                rows={byRider.top.map((r) => ({ key: r.name, label: r.name, value: r.value }))}
                format={(value) => formatOpsMetricValue(metric, value)}
              />
            </OpsChartCard>
            {showRiderBottom ? (
              <OpsChartCard
                title={t("chart.bottomMetric", { n: riderBottomN, metric: seriesName })}
                onExport={() =>
                  downloadCsv(
                    "ops-bottom-riders",
                    toCsv(
                      ["name", "id", "value", "Restaurant", "zone"],
                      byRider.bottom.map((r) => [r.name, r.display_id, r.value, r.store_label, r.zone]),
                    ),
                  )
                }
              >
                <OpsRankedBars
                  rows={byRider.bottom.map((r) => ({ key: r.name, label: r.name, value: r.value }))}
                  format={(value) => formatOpsMetricValue(metric, value)}
                />
              </OpsChartCard>
            ) : null}
          </div>
        </section>
      ) : null}

      {showStoreSection ? (
        <section className={cn("flex flex-col", LAYOUT.stackGap)}>
          {auto ? (
            <p className="text-xs text-muted-foreground">{t("topBottomStoresHint", { n: requestedStores })}</p>
          ) : stores.length < requestedStores ? (
            <p className="text-xs text-muted-foreground">
              {t("topBottomFewerStores", { count: stores.length })}
            </p>
          ) : null}
          <div className="grid gap-2 lg:grid-cols-2 lg:items-stretch">
            <OpsChartCard
              title={t("chart.topStores", { n: storeTopN, metric: seriesName })}
              onExport={() =>
                downloadCsv(
                  "ops-top-stores",
                  toCsv(
                    ["Restaurant", "zone", "value"],
                    byStore.top.map((s) => [s.store_name, s.zone_name, s.value]),
                  ),
                )
              }
            >
              <OpsRankedBars
                rows={byStore.top.map((s) => ({ key: s.store_name ?? "—", label: s.store_name ?? "—", value: s.value }))}
                format={(value) => formatOpsMetricValue(metric, value)}
              />
            </OpsChartCard>
            {showStoreBottom ? (
              <OpsChartCard
                title={t("chart.bottomStores", { n: storeBottomN, metric: seriesName })}
                onExport={() =>
                  downloadCsv(
                    "ops-bottom-stores",
                    toCsv(
                      ["Restaurant", "zone", "value"],
                      byStore.bottom.map((s) => [s.store_name, s.zone_name, s.value]),
                    ),
                  )
                }
              >
                <OpsRankedBars
                  rows={byStore.bottom.map((s) => ({
                    key: s.store_name ?? "—",
                    label: s.store_name ?? "—",
                    value: s.value,
                  }))}
                  format={(value) => formatOpsMetricValue(metric, value)}
                />
              </OpsChartCard>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className={cn("flex flex-col", LAYOUT.stackGap)}>
        {showZoneSection && auto ? (
          <p className="text-xs text-muted-foreground">{t("topBottomZonesHint", { n: requestedZones })}</p>
        ) : showZoneSection && zones.length < requestedZones ? (
          <p className="text-xs text-muted-foreground">
            {t("topBottomFewerZones", { count: zones.length })}
          </p>
        ) : null}
        {showZoneSection ? (
          <div className="grid gap-2 lg:grid-cols-2 lg:items-stretch">
            <OpsChartCard
              title={t("chart.topZones", { n: zoneTopN, metric: seriesName })}
              onExport={() =>
                downloadCsv(
                  "ops-top-zones",
                  toCsv(
                    ["zone", "value"],
                    byZone.top.map((z) => [z.label || z.key, z.value]),
                  ),
                )
              }
            >
              <OpsRankedBars
                rows={byZone.top.map((z) => ({ key: z.label || z.key, label: z.label || z.key, value: z.value }))}
                format={(value) => formatOpsMetricValue(metric, value)}
              />
            </OpsChartCard>
            {showZoneBottom ? (
              <OpsChartCard
                title={t("chart.bottomZones", { n: zoneBottomN, metric: seriesName })}
                onExport={() =>
                  downloadCsv(
                    "ops-bottom-zones",
                    toCsv(
                      ["zone", "value"],
                      byZone.bottom.map((z) => [z.label || z.key, z.value]),
                    ),
                  )
                }
              >
                <OpsRankedBars
                  rows={byZone.bottom.map((z) => ({
                    key: z.label || z.key,
                    label: z.label || z.key,
                    value: z.value,
                  }))}
                  format={(value) => formatOpsMetricValue(metric, value)}
                />
              </OpsChartCard>
            ) : null}
          </div>
        ) : (
          <OpsChartCard title={t("chart.topZones", { n: 0, metric: seriesName })} empty emptyTitle={t("emptyZones")}>
            <div />
          </OpsChartCard>
        )}
      </section>
      <p className="text-xs text-muted-foreground">{t("topBottomTooltip")}</p>
    </div>
  );
}
