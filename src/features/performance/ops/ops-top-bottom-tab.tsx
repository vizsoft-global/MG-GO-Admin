"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { LAYOUT } from "@/components/app/layout-spacing";
import {
  dimMetricValue,
  isChartableDimKey,
  OPS_METRIC_COLOR,
  storeChartValue,
  topBottomN,
  type OpsChartMetric,
} from "../performance-ops-formulas";
import { downloadCsv, toCsv } from "../performance-ops-table";
import { enrichOpsRider } from "../performance-ops-format";
import type { OpsRiderView, OpsSnapshot } from "../performance-ops-types";
import { OpsBarChart, OpsChartCard } from "./ops-charts";
import { cn } from "@/lib/utils";

function pair<T>(
  rows: T[],
  valueOf: (row: T) => number | null,
  n: number,
): { top: Array<T & { value: number }>; bottom: Array<T & { value: number }> } {
  const scored = rows
    .map((row) => ({ row, value: valueOf(row) }))
    .filter((x): x is { row: T; value: number } => x.value != null && Number.isFinite(x.value));
  const sorted = [...scored].sort((a, b) => b.value - a.value);
  return {
    top: sorted.slice(0, n).map((x) => ({ ...x.row, value: x.value })),
    bottom: [...sorted].reverse().slice(0, n).map((x) => ({ ...x.row, value: x.value })),
  };
}

export function OpsTopBottomTab({
  data,
  metric,
}: {
  data: OpsSnapshot;
  metric: OpsChartMetric;
}) {
  const t = useTranslations("pages.performance.ops");
  const riders = useMemo(() => data.riders.map(enrichOpsRider), [data.riders]);
  const active = riders.filter((r) => r.working_days > 0);
  const nRiders = topBottomN(active.length);
  const stores = data.stores.filter((s) => s.store_name && s.working_days > 0);
  const zones = data.by_zone.filter((z) => isChartableDimKey(z.key) && z.working_days > 0);
  const nStores = topBottomN(stores.length);
  const nZones = topBottomN(zones.length);
  const seriesName = t(`viewBy.${metric}`);

  const byRider = useMemo(
    () =>
      pair(
        active,
        (r) => (metric === "orders" ? r.orders : r[metric]),
        nRiders,
      ),
    [active, metric, nRiders],
  );
  const byStore = useMemo(
    () =>
      pair(
        stores,
        (s) => storeChartValue(s, metric, data.kpis.overall_dpd, data.target_dpd),
        nStores,
      ),
    [stores, metric, data.kpis.overall_dpd, data.target_dpd, nStores],
  );
  const byZone = useMemo(
    () => pair(zones, (z) => dimMetricValue(z, metric), nZones),
    [zones, metric, nZones],
  );

  if (nRiders === 0 && nStores === 0 && nZones === 0) {
    return <p className="text-sm text-muted-foreground">{t("emptyTopBottom")}</p>;
  }

  function riderChart(rows: Array<OpsRiderView & { value: number }>) {
    return rows.map((r) => ({
      key: r.name,
      value: r.value,
      id: r.display_id,
      nationality: r.nationality_label,
      store: r.store_label,
      vehicle: r.vehicle_label,
      zone: r.zone ?? "—",
      source: r.source,
    }));
  }

  return (
    <div className={cn("flex flex-col", LAYOUT.stackGap)}>
      {nRiders > 0 ? (
        <section className={cn("flex flex-col", LAYOUT.stackGap)}>
          <p className="text-[11px] text-muted-foreground">
            {t("topBottomHint", { n: nRiders })}
          </p>
          <div className="grid gap-2 lg:grid-cols-2 lg:items-stretch">
            <OpsChartCard
              title={t("chart.topMetric", { n: nRiders, metric: seriesName })}
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
              <OpsBarChart
                data={riderChart(byRider.top)}
                xKey="key"
                series={[{ key: "value", name: seriesName, color: OPS_METRIC_COLOR[metric] }]}
                layout="horizontal"
                metric={metric}
              />
            </OpsChartCard>
            <OpsChartCard
              title={t("chart.bottomMetric", { n: nRiders, metric: seriesName })}
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
              <OpsBarChart
                data={riderChart(byRider.bottom)}
                xKey="key"
                series={[{ key: "value", name: seriesName, color: "#dc2626" }]}
                layout="horizontal"
                metric={metric}
              />
            </OpsChartCard>
          </div>
        </section>
      ) : null}

      {nStores > 0 ? (
        <section className={cn("flex flex-col", LAYOUT.stackGap)}>
          <p className="text-[11px] text-muted-foreground">
            {t("topBottomStoresHint", { n: nStores })}
          </p>
          <div className="grid gap-2 lg:grid-cols-2 lg:items-stretch">
            <OpsChartCard
              title={t("chart.topStores", { n: nStores, metric: seriesName })}
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
              <OpsBarChart
                data={byStore.top.map((s) => ({ key: s.store_name ?? "—", value: s.value }))}
                xKey="key"
                series={[{ key: "value", name: seriesName, color: OPS_METRIC_COLOR[metric] }]}
                layout="horizontal"
                metric={metric}
              />
            </OpsChartCard>
            <OpsChartCard
              title={t("chart.bottomStores", { n: nStores, metric: seriesName })}
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
              <OpsBarChart
                data={byStore.bottom.map((s) => ({ key: s.store_name ?? "—", value: s.value }))}
                xKey="key"
                series={[{ key: "value", name: seriesName, color: "#dc2626" }]}
                layout="horizontal"
                metric={metric}
              />
            </OpsChartCard>
          </div>
        </section>
      ) : null}

      {nZones > 0 ? (
        <section className={cn("flex flex-col", LAYOUT.stackGap)}>
          <p className="text-[11px] text-muted-foreground">
            {t("topBottomZonesHint", { n: nZones })}
          </p>
          <div className="grid gap-2 lg:grid-cols-2 lg:items-stretch">
            <OpsChartCard
              title={t("chart.topZones", { n: nZones, metric: seriesName })}
              onExport={() =>
                downloadCsv(
                  "ops-top-zones",
                  toCsv(
                    ["zone", "value"],
                    byZone.top.map((z) => [z.key, z.value]),
                  ),
                )
              }
            >
              <OpsBarChart
                data={byZone.top.map((z) => ({ key: z.key, value: z.value }))}
                xKey="key"
                series={[{ key: "value", name: seriesName, color: OPS_METRIC_COLOR[metric] }]}
                layout="horizontal"
                metric={metric}
              />
            </OpsChartCard>
            <OpsChartCard
              title={t("chart.bottomZones", { n: nZones, metric: seriesName })}
              onExport={() =>
                downloadCsv(
                  "ops-bottom-zones",
                  toCsv(
                    ["zone", "value"],
                    byZone.bottom.map((z) => [z.key, z.value]),
                  ),
                )
              }
            >
              <OpsBarChart
                data={byZone.bottom.map((z) => ({ key: z.key, value: z.value }))}
                xKey="key"
                series={[{ key: "value", name: seriesName, color: "#dc2626" }]}
                layout="horizontal"
                metric={metric}
              />
            </OpsChartCard>
          </div>
        </section>
      ) : null}
      <p className="text-[10px] text-muted-foreground">{t("topBottomTooltip")}</p>
    </div>
  );
}
