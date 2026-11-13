"use client";

import { useTranslations } from "next-intl";
import { KpiGrid } from "@/components/dashboard/kpi-grid";
import { LAYOUT } from "@/components/app/layout-spacing";
import { downloadCsv, toCsv } from "../performance-ops-table";
import {
  companyLabel,
  formatDelta,
  formatDpd,
  formatInt,
  formatMinutesCard,
  formatPct,
  formatUtr,
  formatOpsMetricValue,
  partnerLabel,
  vehicleLabel,
} from "../performance-ops-format";
import { countryLabel } from "@/lib/geo/countries";
import {
  dimMetricValue,
  formatOpsTrendLabel,
  isChartableDimKey,
  OPS_METRIC_COLOR,
  type OpsChartMetric,
  type OpsGranularity,
} from "../performance-ops-formulas";
import type { OpsDimRow, OpsSnapshot } from "../performance-ops-types";
import { OpsChartCard, OpsDonut, OpsKpiDelta, OpsLineChart, OpsRankedBars, opsChartTitle } from "./ops-charts";
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

  /**
   * A card is clickable only when the chart can actually be drawn from it, so
   * `hoursExcluded`, `workingHours`, `riders`, `active` and `restaurants` stay
   * plain tiles — a card that sets a metric the chart cannot plot would empty
   * the chart it claimed to select.
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
      label: t("kpi.overallDpd"),
      value: formatDpd(k.overall_dpd),
      caption: <OpsKpiDelta {...formatDelta(k.overall_dpd, k.overall_dpd_prev)} />,
      accent: "primary" as const,
      ...metricCard("dpd"),
    },
    {
      label: t("kpi.avgDpdEff"),
      value: formatPct(k.avg_dpd_eff),
      caption: <OpsKpiDelta {...formatDelta(k.avg_dpd_eff, k.avg_dpd_eff_prev)} />,
      ...metricCard("dpd_eff"),
    },
    {
      label: t("kpi.avgTgtEff"),
      value: formatPct(k.avg_tgt_eff),
      caption: <OpsKpiDelta {...formatDelta(k.avg_tgt_eff, k.avg_tgt_eff_prev)} />,
      accent: "success" as const,
      ...metricCard("tgt_eff"),
    },
    {
      label: t("kpi.utr"),
      value: formatUtr(k.utr),
      accent: "primary" as const,
      ...metricCard("utr"),
    },
    { label: t("kpi.workingHours"), value: formatDpd(k.working_hours) },
    /**
     * The hours the ratio excludes. Shown, not hidden: this is the difference
     * between the KPI and a fleet-wide total, and it is exactly the number the
     * client asked us to account for.
     */
    { label: t("kpi.hoursExcluded"), value: formatDpd(k.working_hours_excluded) },
    { label: t("kpi.avgDelivery"), value: formatMinutesCard(k.avg_delivery_min) },
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
    /**
     * The reference dashboard's eighth card. "Restaurants Count" is the number of
     * stores the scoped riders actually delivered for, which is what an operator
     * reads it as — not the size of the restaurant catalogue.
     */
    {
      label: t("kpi.restaurants"),
      value: formatInt(data.stores.length),
    },
  ];

  const trend = data.trend.map((p) => ({
    bucket: formatOpsTrendLabel(p.bucket, granularity),
    value: dimMetricValue(p, metric),
  }));

  return (
    <div className={cn("flex flex-col", LAYOUT.stackGap)}>
      {data.by_vehicle.length === 0 ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {t("vehicleGap")}
        </p>
      ) : null}
      <KpiGrid items={items} compact />
      <div className="grid gap-2 lg:grid-cols-2 lg:items-stretch">
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
          title={opsChartTitle(t, "vehicle", seriesName)}
          onExport={() =>
            downloadCsv(
              "ops-vehicle",
              toCsv(
                ["vehicle", metric],
                data.by_vehicle.map((r) => [vehicleLabel(r.key), dimMetricValue(r, metric)]),
              ),
            )
          }
          empty={data.by_vehicle.length === 0}
          emptyTitle={t("emptyVehicle")}
        >
          <OpsDonut
            rows={rankedRows(data.by_vehicle, (r) => vehicleLabel(r.key), metric)}
            format={(value) => formatOpsMetricValue(metric, value)}
          />
        </OpsChartCard>
        <OpsChartCard
          title={opsChartTitle(t, "zone", seriesName)}
          onExport={() =>
            downloadCsv(
              "ops-zone",
              toCsv(
                ["zone", metric],
                data.by_zone.filter((r) => isChartableDimKey(r.key)).map((r) => [r.label || r.key, dimMetricValue(r, metric)]),
              ),
            )
          }
          empty={data.by_zone.length === 0}
          emptyTitle={t("emptyChart")}
        >
          <OpsRankedBars
            rows={rankedRows(data.by_zone, (r) => r.label || r.key, metric)}
            format={(value) => formatOpsMetricValue(metric, value)}
          />
        </OpsChartCard>
        <OpsChartCard
          title={opsChartTitle(t, "partner", seriesName)}
          onExport={() =>
            downloadCsv(
              "ops-partner",
              toCsv(
                ["partner", metric],
                data.by_partner.map((r) => [
                  r.label || (partnerLabel(r.key) === "—" ? r.key : partnerLabel(r.key)),
                  dimMetricValue(r, metric),
                ]),
              ),
            )
          }
          empty={data.by_partner.length === 0}
          emptyTitle={t("emptyChart")}
        >
          <OpsRankedBars
            rows={rankedRows(
              data.by_partner,
              (r) => r.label || (partnerLabel(r.key) === "—" ? r.key : partnerLabel(r.key)),
              metric,
            )}
            format={(value) => formatOpsMetricValue(metric, value)}
          />
        </OpsChartCard>
        <OpsChartCard
          title={opsChartTitle(t, "nationality", seriesName)}
          onExport={() =>
            downloadCsv(
              "ops-nationality",
              toCsv(
                ["nationality", metric],
                data.by_nationality.map((r) => [countryLabel(r.key), dimMetricValue(r, metric)]),
              ),
            )
          }
          empty={data.by_nationality.length === 0}
          emptyTitle={t("emptyChart")}
        >
          <OpsRankedBars
            rows={rankedRows(data.by_nationality, (r) => countryLabel(r.key), metric)}
            format={(value) => formatOpsMetricValue(metric, value)}
          />
        </OpsChartCard>
        <OpsChartCard
          title={opsChartTitle(t, "company", seriesName)}
          onExport={() =>
            downloadCsv(
              "ops-company",
              toCsv(
                ["company", metric],
                data.by_company.map((r) => [companyLabel(r.key), dimMetricValue(r, metric)]),
              ),
            )
          }
          empty={data.by_company.length === 0}
          emptyTitle={t("emptyChart")}
        >
          <OpsRankedBars
            rows={rankedRows(data.by_company, (r) => companyLabel(r.key), metric)}
            format={(value) => formatOpsMetricValue(metric, value)}
          />
        </OpsChartCard>
      </div>
    </div>
  );
}
