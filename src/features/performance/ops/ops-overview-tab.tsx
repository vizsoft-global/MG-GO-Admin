"use client";

import { useTranslations } from "next-intl";
import { KpiGrid } from "@/components/dashboard/kpi-grid";
import { LAYOUT } from "@/components/app/layout-spacing";
import { downloadCsv, toCsv } from "../performance-ops-table";
import {
  formatDelta,
  formatDpd,
  formatInt,
  formatMinutesCard,
  formatOpsMetricValue,
  formatPct,
  formatUtr,
  partnerLabel,
  vehicleLabel,
} from "../performance-ops-format";
import { countryLabel } from "@/lib/geo/countries";
import {
  dimMetricValue,
  formatOpsTrendLabel,
  isChartableDimKey,
  OPS_METRIC_COLOR,
  storeChartValue,
  type OpsChartMetric,
  type OpsGranularity,
} from "../performance-ops-formulas";
import type { OpsDimRow, OpsSnapshot } from "../performance-ops-types";
import {
  OpsChartCard,
  OpsDonut,
  OpsKpiDelta,
  OpsLineChart,
  OpsRankedBars,
  OpsVBars,
  OpsVBarsLabels,
  opsChartTitle,
} from "./ops-charts";
import { cn } from "@/lib/utils";

/**
 * Dimension rows as a ranked list, highest first.
 *
 * The reference dashboard ranks every breakdown and darkens toward the top; a
 * bar chart in the source order said nothing about rank. Rows whose metric is
 * null (a zero denominator) are dropped rather than drawn as a zero-length bar,
 * which would read as "measured, and it was nothing".
 */
function rankedRows(
  rows: OpsDimRow[],
  labelOf: (row: OpsDimRow) => string,
  metric: OpsChartMetric,
): Array<{ key: string; label: string; value: number }> {
  return rows
    .filter((r) => isChartableDimKey(r.key))
    .map((r, index) => ({
      key: `${labelOf(r)}-${index}`,
      label: labelOf(r),
      value: dimMetricValue(r, metric),
    }))
    .filter((row): row is { key: string; label: string; value: number } =>
      typeof row.value === "number" && Number.isFinite(row.value),
    )
    .sort((left, right) => right.value - left.value);
}

export function OpsOverviewTab({
  data,
  metric,
  granularity,
  onSelectMetric,
}: {
  data: OpsSnapshot;
  metric: OpsChartMetric;
  granularity: OpsGranularity;
  /** Selecting a KPI card drives the View-by chart the same way the pills do. */
  onSelectMetric?: (next: OpsChartMetric) => void;
}) {
  const t = useTranslations("pages.performance.ops");
  const k = data.kpis;
  const seriesName = t(`viewBy.${metric}`);
  const color = OPS_METRIC_COLOR[metric];
  const series = [{ key: "value", name: seriesName, color }];
  const fmt = (value: number) => formatOpsMetricValue(metric, value);

  /**
   * The reference Overview strip, in its own order. Previously eleven cards: the
   * working-hours pair and Target Efficiency belong to the Riders and DPD tabs,
   * and a strip that grows per tab makes the same screen look different every
   * time a tab is pressed.
   *
   * A card is clickable only when the chart can actually be drawn from it, so
   * `riders`, `active` and `restaurants` stay plain tiles — a card that sets a
   * metric the chart cannot plot would empty the chart it claimed to select.
   */
  const metricCard = (key: OpsChartMetric) =>
    onSelectMetric
      ? { selected: metric === key, onClick: () => onSelectMetric(key) }
      : {};
  const items = [
    {
      label: t("kpi.orders"),
      value: formatInt(k.orders),
      caption: <OpsKpiDelta {...formatDelta(k.orders, k.orders_prev)} />,
      ...metricCard("orders"),
    },
    {
      label: t("kpi.riders"),
      value: formatInt(k.riders),
      caption: <OpsKpiDelta {...formatDelta(k.riders, k.riders_prev)} />,
    },
    {
      label: t("kpi.active"),
      value: formatInt(k.active),
      caption: <OpsKpiDelta {...formatDelta(k.active, k.active_prev)} />,
    },
    { label: t("kpi.restaurants"), value: formatInt(data.stores.length) },
    {
      label: t("kpi.overallDpd"),
      value: formatDpd(k.overall_dpd),
      caption: <OpsKpiDelta {...formatDelta(k.overall_dpd, k.overall_dpd_prev)} />,
      accent: "primary" as const,
      ...metricCard("dpd"),
    },
    {
      label: t("kpi.utr"),
      value: formatUtr(k.utr),
      accent: "primary" as const,
      ...metricCard("utr"),
    },
    { label: t("kpi.avgDelivery"), value: formatMinutesCard(k.avg_delivery_min) },
    {
      label: t("kpi.avgDpdEff"),
      value: formatPct(k.avg_dpd_eff),
      caption: <OpsKpiDelta {...formatDelta(k.avg_dpd_eff, k.avg_dpd_eff_prev)} />,
      ...metricCard("dpd_eff"),
    },
  ];

  const trend = data.trend.map((p) => ({
    bucket: formatOpsTrendLabel(p.bucket, granularity),
    value: dimMetricValue(p, metric),
  }));

  const nationality = rankedRows(data.by_nationality, (r) => countryLabel(r.key), metric);
  const zones = rankedRows(data.by_zone, (r) => r.label || r.key, metric);
  const vehicles = rankedRows(data.by_vehicle, (r) => vehicleLabel(r.key), metric);
  const clients = rankedRows(
    data.by_partner,
    (r) => r.label || (partnerLabel(r.key) === "—" ? r.key : partnerLabel(r.key)),
    metric,
  );

  /**
   * Top / Bottom row.
   *
   * The reference ranks restaurants when there are at least three to rank, and
   * falls back to zones otherwise — a Keeta-only scope has one pool store, so a
   * "top restaurants" list would be a single row.
   */
  const storeRows = data.stores
    .filter((s) => Boolean(s.store_name) && s.working_days > 0)
    .map((s) => ({
      key: s.store_id ?? s.store_name ?? "—",
      label: s.store_name ?? "—",
      value: storeChartValue(s, metric, data.kpis.overall_dpd, data.target_dpd),
    }))
    .filter((row): row is { key: string; label: string; value: number } =>
      typeof row.value === "number" && Number.isFinite(row.value),
    )
    .sort((left, right) => right.value - left.value);
  const ranked =
    storeRows.length >= 3
      ? { unit: "stores" as const, rows: storeRows }
      : { unit: "zones" as const, rows: zones };

  const topRows = ranked.rows.slice(0, 8);
  const bottomRows = ranked.rows.slice(-8).reverse();

  return (
    <div className={cn("flex flex-col", LAYOUT.stackGap)}>
      {data.by_vehicle.length === 0 ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {t("vehicleGap")}
        </p>
      ) : null}
      <KpiGrid items={items} compact />

      {/* Trend and nationality share a row, wider on the trend — the reference's 1.25fr / 1fr. */}
      <div className="grid gap-2 lg:grid-cols-[1.25fr_1fr] lg:items-stretch">
        <OpsChartCard
          title={opsChartTitle(t, "trend", seriesName)}
          onExport={() =>
            downloadCsv(
              "ops-trend",
              toCsv(
                ["bucket", metric],
                data.trend.map((p) => [p.bucket, dimMetricValue(p, metric)]),
              ),
            )
          }
          empty={trend.length === 0}
          emptyTitle={t("emptyChart")}
        >
          <OpsLineChart data={trend} xKey="bucket" series={series} metric={metric} />
        </OpsChartCard>
        <OpsChartCard
          title={opsChartTitle(t, "nationality", seriesName)}
          onExport={() =>
            downloadCsv(
              "ops-nationality",
              toCsv(["nationality", metric], nationality.map((r) => [r.label, r.value])),
            )
          }
          empty={nationality.length === 0}
          emptyTitle={t("emptyChart")}
        >
          <OpsRankedBars rows={nationality} format={fmt} />
        </OpsChartCard>
      </div>

      <div className="grid gap-2 lg:grid-cols-3 lg:items-stretch">
        <OpsChartCard
          title={opsChartTitle(t, "zone", seriesName)}
          onExport={() =>
            downloadCsv("ops-zone", toCsv(["zone", metric], zones.map((r) => [r.label, r.value])))
          }
          empty={zones.length === 0}
          emptyTitle={t("emptyChart")}
        >
          <OpsRankedBars rows={zones} format={fmt} />
        </OpsChartCard>
        <OpsChartCard
          title={opsChartTitle(t, "vehicle", seriesName)}
          onExport={() =>
            downloadCsv(
              "ops-vehicle",
              toCsv(["vehicle", metric], vehicles.map((r) => [r.label, r.value])),
            )
          }
          empty={vehicles.length === 0}
          emptyTitle={t("emptyVehicle")}
        >
          <OpsDonut rows={vehicles} format={fmt} />
        </OpsChartCard>
        <OpsChartCard
          title={opsChartTitle(t, "partner", seriesName)}
          onExport={() =>
            downloadCsv(
              "ops-partner",
              toCsv(["client", metric], clients.map((r) => [r.label, r.value])),
            )
          }
          empty={clients.length === 0}
          emptyTitle={t("emptyChart")}
        >
          <div className="flex flex-col gap-1">
            <OpsVBars rows={clients} format={fmt} />
            <OpsVBarsLabels rows={clients} />
          </div>
        </OpsChartCard>
      </div>

      {/* Top / bottom restaurants (or zones), green vs red — a verdict, not a client tint. */}
      <div className="grid gap-2 lg:grid-cols-2 lg:items-stretch">
        <OpsChartCard
          title={t(`chart.top${ranked.unit === "stores" ? "Stores" : "Zones"}`, {
            n: topRows.length,
            metric: seriesName,
          })}
          onExport={() =>
            downloadCsv(
              `ops-top-${ranked.unit}`,
              toCsv([ranked.unit === "stores" ? "Restaurant" : "Zone", metric], topRows.map((r) => [r.label, r.value])),
            )
          }
          empty={topRows.length === 0}
          emptyTitle={t("emptyChart")}
        >
          <OpsRankedBars rows={topRows} format={fmt} />
        </OpsChartCard>
        <OpsChartCard
          title={t(`chart.bottom${ranked.unit === "stores" ? "Stores" : "Zones"}`, {
            n: bottomRows.length,
            metric: seriesName,
          })}
          onExport={() =>
            downloadCsv(
              `ops-bottom-${ranked.unit}`,
              toCsv([ranked.unit === "stores" ? "Restaurant" : "Zone", metric], bottomRows.map((r) => [r.label, r.value])),
            )
          }
          empty={bottomRows.length === 0}
          emptyTitle={t("emptyChart")}
        >
          <OpsRankedBars rows={bottomRows} format={fmt} />
        </OpsChartCard>
      </div>
    </div>
  );
}
