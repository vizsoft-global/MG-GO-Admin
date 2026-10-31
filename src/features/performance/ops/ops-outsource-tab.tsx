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
  TableNameCell,
  TableToolbar,
  useTablePrefs,
  type TableToolbarColumn,
} from "@/components/app/table-toolbar";
import {
  companyRowsFromRiders,
  dimMetricValue,
  formatOpsTrendLabel,
  isChartableDimKey,
  OPS_METRIC_COLOR,
  UNASSIGNED_COMPANY_KEY,
  type OpsChartMetric,
  type OpsGranularity,
} from "../performance-ops-formulas";
import { downloadCsv, toCsv } from "../performance-ops-table";
import {
  companyLabel,
  formatDpd,
  formatInt,
  formatMinutes,
  formatMinutesCard,
  formatPct,
  formatUtr,
} from "../performance-ops-format";
import type { OpsSnapshot } from "../performance-ops-types";
import { OpsBarChart, OpsChartCard, OpsLineChart, opsChartTitle } from "./ops-charts";
import { cn } from "@/lib/utils";

export function OpsOutsourceTab({
  data,
  metric,
  granularity,
}: {
  data: OpsSnapshot;
  metric: OpsChartMetric;
  granularity: OpsGranularity;
}) {
  const t = useTranslations("pages.performance.ops");
  const companyColumns = useMemo((): TableToolbarColumn[] => [
    { id: "company", label: t("col.company"), locked: true },
    { id: "orders", label: t("col.orders") },
    { id: "riders", label: t("col.riders") },
    { id: "active", label: t("col.activeRiders") },
    { id: "dpd", label: t("col.dpd") },
    { id: "dpdEff", label: t("col.dpdEff") },
    { id: "tgt", label: t("col.tgtEff") },
    { id: "utr", label: t("col.utr") },
    { id: "avg", label: t("col.avgDelivery") },
  ], [t]);
  const companyPrefs = useTablePrefs("ops-outsource-companies", companyColumns);
  const seriesName = t(`viewBy.${metric}`);
  const series = [{ key: "value", name: seriesName, color: OPS_METRIC_COLOR[metric] }];
  const companies = useMemo(
    () => companyRowsFromRiders(data.riders).filter((r) => isChartableDimKey(r.key)),
    [data.riders],
  );
  const zones = data.by_zone.filter((r) => isChartableDimKey(r.key));
  const trend = data.trend.map((p) => ({
    bucket: formatOpsTrendLabel(p.bucket, granularity),
    value: dimMetricValue(p, metric),
  }));
  function labelCompany(key: string) {
    return key === UNASSIGNED_COMPANY_KEY ? t("unassignedCompany") : companyLabel(key);
  }

  return (
    <div className={cn("flex flex-col", LAYOUT.stackGap)}>
      <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        {t("outsourceBanner")}
      </p>
      <KpiGrid
        compact
        items={[
          { label: t("kpi.orders"), value: formatInt(data.kpis.orders) },
          { label: t("kpi.overallDpd"), value: formatDpd(data.kpis.overall_dpd), accent: "primary" },
          { label: t("kpi.riders"), value: formatInt(data.kpis.riders) },
          { label: t("kpi.active"), value: formatInt(data.kpis.active) },
          { label: t("kpi.dpdEff"), value: formatPct(data.kpis.avg_dpd_eff) },
          { label: t("kpi.tgtEff"), value: formatPct(data.kpis.avg_tgt_eff), accent: "success" },
          { label: t("kpi.utr"), value: formatUtr(data.kpis.utr) },
          { label: t("kpi.avgDelivery"), value: formatMinutesCard(data.kpis.avg_delivery_min) },
        ]}
      />
      <OpsChartCard
        title={opsChartTitle(t, "trend", seriesName)}
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
        <OpsLineChart data={trend} xKey="bucket" series={series} metric={metric} />
      </OpsChartCard>
      <div className="grid gap-2 lg:grid-cols-2 lg:items-stretch">
        <OpsChartCard
          title={opsChartTitle(t, "company", seriesName)}
          onExport={() =>
            downloadCsv(
              "ops-outsource-companies",
              toCsv(
                ["company", metric],
                companies.map((r) => [labelCompany(r.key), dimMetricValue(r, metric)]),
              ),
            )
          }
          empty={companies.length === 0}
          emptyTitle={t("emptyChart")}
        >
          <OpsBarChart
            data={companies.map((r) => ({
              key: labelCompany(r.key),
              value: dimMetricValue(r, metric),
            }))}
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
              "ops-outsource-zones",
              toCsv(
                ["zone", metric],
                zones.map((r) => [r.label || r.key, dimMetricValue(r, metric)]),
              ),
            )
          }
          empty={zones.length === 0}
          emptyTitle={t("emptyChart")}
        >
          <OpsBarChart
            data={zones.map((r) => ({ key: r.label || r.key, value: dimMetricValue(r, metric) }))}
            xKey="key"
            series={series}
            layout="horizontal"
            metric={metric}
            colorByCategory
          />
        </OpsChartCard>
      </div>
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold">{t("companyTable")}</h3>
        </div>
        <AppDataTable
          toolbar={
            <TableToolbar
              prefs={companyPrefs}
              entity={t("companyTable")}
              columns={companyColumns}
              rowKind="dynamic"
              filteredCount={companies.filter((r) => {
                const needle = companyPrefs.appliedQuery.trim().toLowerCase();
                return !needle || labelCompany(r.key).toLowerCase().includes(needle);
              }).length}
              totalCount={companies.length}
              onExport={() => downloadCsv(
                "ops-outsource-companies",
                toCsv(
                  [t("col.company"), t("col.orders"), t("col.riders"), t("col.activeRiders"), t("col.dpd"), t("col.dpdEff"), t("col.tgtEff"), t("col.utr"), t("col.avgDelivery")],
                  companies.map((r) => [labelCompany(r.key), r.orders, r.riders, r.active_riders, r.dpd, r.dpd_eff, r.tgt_eff, r.utr, r.avg_delivery_min]),
                ),
              )}
            />
          }
          columns={companyPrefs.orderedColumns.filter((column) => companyPrefs.isVisible(column.id)).map((column) => ({
            id: column.id,
            label: column.label,
            className: column.id === "company" ? undefined : "text-end",
          }))}
        >
          {companies.filter((r) => {
            const needle = companyPrefs.appliedQuery.trim().toLowerCase();
            return !needle || labelCompany(r.key).toLowerCase().includes(needle);
          }).map((r) => (
            <AppDataTableRow key={r.key}>
              {companyPrefs.orderedColumns.filter((column) => companyPrefs.isVisible(column.id)).map((column) => {
                const end = "text-end tabular-nums text-sm";
                if (column.id === "company") return <TableCell key={column.id} className="text-sm"><TableNameCell name={labelCompany(r.key)} /></TableCell>;
                if (column.id === "orders") return <TableCell key={column.id} className={end}>{formatInt(r.orders)}</TableCell>;
                if (column.id === "riders") return <TableCell key={column.id} className={end}>{formatInt(r.riders)}</TableCell>;
                if (column.id === "active") return <TableCell key={column.id} className={end}>{formatInt(r.active_riders ?? r.riders)}</TableCell>;
                if (column.id === "dpd") return <TableCell key={column.id} className={end}>{formatDpd(r.dpd)}</TableCell>;
                if (column.id === "dpdEff") return <TableCell key={column.id} className={end}>{formatPct(r.dpd_eff)}</TableCell>;
                if (column.id === "tgt") return <TableCell key={column.id} className={end}>{formatPct(r.tgt_eff)}</TableCell>;
                if (column.id === "utr") return <TableCell key={column.id} className={end}>{formatUtr(r.utr)}</TableCell>;
                return <TableCell key={column.id} className={end}>{formatMinutes(r.avg_delivery_min)}</TableCell>;
              })}
            </AppDataTableRow>
          ))}
        </AppDataTable>
      </div>
    </div>
  );
}
