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
  formatPct,
  partnerLabel,
  vehicleLabel,
} from "../performance-ops-format";
import { countryLabel } from "@/lib/geo/countries";
import {
  dimMetricValue,
  formatOpsBucketLabel,
  isChartableDimKey,
  OPS_METRIC_COLOR,
  type OpsChartMetric,
} from "../performance-ops-formulas";
import type { OpsDimRow, OpsSnapshot } from "../performance-ops-types";
import { OpsBarChart, OpsChartCard, OpsKpiDelta, OpsLineChart, opsChartTitle } from "./ops-charts";
import { cn } from "@/lib/utils";

function dimRows(rows: OpsDimRow[], labelOf: (row: OpsDimRow) => string, metric: OpsChartMetric) {
  return rows
    .filter((r) => isChartableDimKey(r.key))
    .map((r) => ({ key: labelOf(r), value: dimMetricValue(r, metric) }));
}

export function OpsOverviewTab({
  data,
  metric,
}: {
  data: OpsSnapshot;
  metric: OpsChartMetric;
}) {
  const t = useTranslations("pages.performance.ops");
  const k = data.kpis;
  const seriesName = t(`viewBy.${metric}`);
  const color = OPS_METRIC_COLOR[metric];
  const series = [{ key: "value", name: seriesName, color }];

  const items = [
    {
      label: t("kpi.orders"),
      value: formatInt(k.orders),
      caption: <OpsKpiDelta {...formatDelta(k.orders, k.orders_prev)} />,
    },
    {
      label: t("kpi.overallDpd"),
      value: formatDpd(k.overall_dpd),
      caption: <OpsKpiDelta {...formatDelta(k.overall_dpd, k.overall_dpd_prev)} />,
      accent: "primary" as const,
    },
    {
      label: t("kpi.avgDpdEff"),
      value: formatPct(k.avg_dpd_eff),
      caption: <OpsKpiDelta {...formatDelta(k.avg_dpd_eff, k.avg_dpd_eff_prev)} />,
    },
    {
      label: t("kpi.avgTgtEff"),
      value: formatPct(k.avg_tgt_eff),
      caption: <OpsKpiDelta {...formatDelta(k.avg_tgt_eff, k.avg_tgt_eff_prev)} />,
      accent: "success" as const,
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
  ];

  const trend = data.trend.map((p) => ({
    bucket: formatOpsBucketLabel(p.bucket),
    value: dimMetricValue(p, metric),
  }));

  return (
    <div className={cn("flex flex-col", LAYOUT.stackGap)}>
      {data.by_vehicle.length === 0 ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
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
          <OpsBarChart
            data={dimRows(data.by_vehicle, (r) => vehicleLabel(r.key), metric)}
            xKey="key"
            series={series}
            metric={metric}
            colorByCategory
          />
        </OpsChartCard>
        <OpsChartCard
          title={opsChartTitle(t, "zone", seriesName)}
          onExport={() =>
            downloadCsv(
              "ops-zone",
              toCsv(
                ["zone", metric],
                data.by_zone.filter((r) => isChartableDimKey(r.key)).map((r) => [r.key, dimMetricValue(r, metric)]),
              ),
            )
          }
          empty={data.by_zone.length === 0}
          emptyTitle={t("emptyChart")}
        >
          <OpsBarChart
            data={dimRows(data.by_zone, (r) => r.key, metric)}
            xKey="key"
            series={series}
            layout="horizontal"
            metric={metric}
            colorByCategory
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
                  partnerLabel(r.key) === "—" ? r.key : partnerLabel(r.key),
                  dimMetricValue(r, metric),
                ]),
              ),
            )
          }
          empty={data.by_partner.length === 0}
          emptyTitle={t("emptyChart")}
        >
          <OpsBarChart
            data={dimRows(
              data.by_partner,
              (r) => (partnerLabel(r.key) === "—" ? r.key : partnerLabel(r.key)),
              metric,
            )}
            xKey="key"
            series={series}
            metric={metric}
            colorByCategory
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
          <OpsBarChart
            data={dimRows(data.by_nationality, (r) => countryLabel(r.key), metric)}
            xKey="key"
            series={series}
            layout="horizontal"
            metric={metric}
            colorByCategory
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
          <OpsBarChart
            data={dimRows(data.by_company, (r) => companyLabel(r.key), metric)}
            xKey="key"
            series={series}
            metric={metric}
            colorByCategory
          />
        </OpsChartCard>
      </div>
    </div>
  );
}
