"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { KpiGrid } from "@/components/dashboard/kpi-grid";
import { LAYOUT } from "@/components/app/layout-spacing";
import {
  AppDataTable,
  AppDataTableRow,
  TableCell,
} from "@/components/app/app-data-table";
import {
  dimMetricValue,
  formatOpsBucketLabel,
  isChartableDimKey,
  OPS_METRIC_COLOR,
  type OpsChartMetric,
} from "../performance-ops-formulas";
import { downloadCsv, toCsv } from "../performance-ops-table";
import {
  companyLabel,
  enrichOpsRider,
  formatDpd,
  formatInt,
  formatPct,
} from "../performance-ops-format";
import type { OpsSnapshot } from "../performance-ops-types";
import { OpsBarChart, OpsChartCard, OpsLineChart } from "./ops-charts";
import { cn } from "@/lib/utils";

export function OpsOutsourceTab({
  data,
  metric,
}: {
  data: OpsSnapshot;
  metric: OpsChartMetric;
}) {
  const t = useTranslations("pages.performance.ops");
  const riders = useMemo(() => data.riders.map(enrichOpsRider), [data.riders]);
  const seriesName = t(`viewBy.${metric}`);
  const series = [{ key: "value", name: seriesName, color: OPS_METRIC_COLOR[metric] }];
  const companies = data.by_company.filter((r) => isChartableDimKey(r.key));
  const zones = data.by_zone.filter((r) => isChartableDimKey(r.key));
  const trend = data.trend.map((p) => ({
    bucket: formatOpsBucketLabel(p.bucket),
    value: dimMetricValue(p, metric),
  }));

  return (
    <div className={cn("flex flex-col", LAYOUT.stackGap)}>
      <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
        {t("outsourceBanner")}
      </p>
      <KpiGrid
        compact
        items={[
          { label: t("kpi.orders"), value: formatInt(data.kpis.orders) },
          { label: t("kpi.overallDpd"), value: formatDpd(data.kpis.overall_dpd), accent: "primary" },
          { label: t("kpi.riders"), value: formatInt(data.kpis.riders) },
          { label: t("kpi.active"), value: formatInt(data.kpis.active) },
          { label: t("kpi.avgDpdEff"), value: formatPct(data.kpis.avg_dpd_eff) },
          { label: t("kpi.avgTgtEff"), value: formatPct(data.kpis.avg_tgt_eff), accent: "success" },
        ]}
      />
      <OpsChartCard
        title={t("chart.trend")}
        onExport={() =>
          downloadCsv(
            "ops-outsource-trend",
            toCsv(
              ["bucket", metric],
              data.trend.map((p) => [p.bucket, dimMetricValue(p, metric)]),
            ),
          )
        }
        empty={trend.length === 0}
        emptyTitle={t("emptyChart")}
      >
        <OpsLineChart data={trend} xKey="bucket" series={series} />
      </OpsChartCard>
      <div className="grid gap-2 lg:grid-cols-2 lg:items-stretch">
        <OpsChartCard
          title={t("chart.company")}
          onExport={() =>
            downloadCsv(
              "ops-outsource-companies",
              toCsv(
                ["company", metric],
                companies.map((r) => [companyLabel(r.key), dimMetricValue(r, metric)]),
              ),
            )
          }
          empty={companies.length === 0}
          emptyTitle={t("emptyChart")}
        >
          <OpsBarChart
            data={companies.map((r) => ({
              key: companyLabel(r.key),
              value: dimMetricValue(r, metric),
            }))}
            xKey="key"
            series={series}
          />
        </OpsChartCard>
        <OpsChartCard
          title={t("chart.zone")}
          onExport={() =>
            downloadCsv(
              "ops-outsource-zones",
              toCsv(
                ["zone", metric],
                zones.map((r) => [r.key, dimMetricValue(r, metric)]),
              ),
            )
          }
          empty={zones.length === 0}
          emptyTitle={t("emptyChart")}
        >
          <OpsBarChart
            data={zones.map((r) => ({ key: r.key, value: dimMetricValue(r, metric) }))}
            xKey="key"
            series={series}
            layout="horizontal"
          />
        </OpsChartCard>
      </div>
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold">{t("companyTable")}</h3>
          <button
            type="button"
            className="text-xs text-primary hover:underline"
            onClick={() =>
              downloadCsv(
                "ops-outsource-riders",
                toCsv(
                  ["name", "id", "company", "store", "dpd", "tgt_eff"],
                  riders.map((r) => [
                    r.name,
                    r.display_id,
                    r.source,
                    r.store_label,
                    r.dpd,
                    r.tgt_eff,
                  ]),
                ),
              )
            }
          >
            {t("exportTab")}
          </button>
        </div>
        <AppDataTable
          columns={[
            { id: "company", label: t("col.company") },
            { id: "orders", label: t("col.orders"), className: "text-end" },
            { id: "riders", label: t("col.riders"), className: "text-end" },
            { id: "active", label: t("col.activeRiders"), className: "text-end" },
            { id: "dpd", label: t("col.dpd"), className: "text-end" },
            { id: "dpdEff", label: t("col.dpdEff"), className: "text-end" },
            { id: "tgt", label: t("col.tgtEff"), className: "text-end" },
          ]}
        >
          {companies.map((r) => (
            <AppDataTableRow key={r.key}>
              <TableCell className="text-sm">{companyLabel(r.key)}</TableCell>
              <TableCell className="text-end tabular-nums text-sm">
                {formatInt(r.orders)}
              </TableCell>
              <TableCell className="text-end tabular-nums text-sm">
                {formatInt(r.riders)}
              </TableCell>
              <TableCell className="text-end tabular-nums text-sm">
                {formatInt(r.active_riders ?? r.riders)}
              </TableCell>
              <TableCell className="text-end tabular-nums text-sm">
                {formatDpd(r.dpd)}
              </TableCell>
              <TableCell className="text-end tabular-nums text-sm">
                {formatPct(r.dpd_eff)}
              </TableCell>
              <TableCell className="text-end tabular-nums text-sm">
                {formatPct(r.tgt_eff)}
              </TableCell>
            </AppDataTableRow>
          ))}
        </AppDataTable>
      </div>
    </div>
  );
}
