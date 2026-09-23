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
  EFFICIENCY_BUCKETS,
  formatOpsTrendLabel,
  isChartableDimKey,
  OPS_METRIC_COLOR,
  type OpsChartMetric,
  type OpsGranularity,
} from "../performance-ops-formulas";
import { downloadCsv, toCsv } from "../performance-ops-table";
import {
  enrichOpsRider,
  formatDpd,
  formatInt,
  formatPct,
  vehicleLabel,
} from "../performance-ops-format";
import { countryLabel } from "@/lib/geo/countries";
import type { OpsSnapshot } from "../performance-ops-types";
import { OpsBarChart, OpsChartCard, OpsLineChart, opsChartTitle } from "./ops-charts";
import { cn } from "@/lib/utils";

export function OpsDpdTab({
  data,
  metric,
  granularity,
}: {
  data: OpsSnapshot;
  metric: OpsChartMetric;
  granularity: OpsGranularity;
}) {
  const t = useTranslations("pages.performance.ops");
  const riders = useMemo(() => data.riders.map(enrichOpsRider), [data.riders]);
  const seriesName = t(`viewBy.${metric}`);
  const series = [{ key: "value", name: seriesName, color: OPS_METRIC_COLOR[metric] }];

  const counts = useMemo(() => {
    const out = Object.fromEntries(EFFICIENCY_BUCKETS.map((b) => [b, 0])) as Record<
      (typeof EFFICIENCY_BUCKETS)[number],
      number
    >;
    for (const r of riders) {
      if (r.bucket) out[r.bucket] += 1;
    }
    return out;
  }, [riders]);

  const dist = EFFICIENCY_BUCKETS.map((b) => ({
    key: t(`bucket.${b}`),
    riders: counts[b],
  }));

  const trend = data.trend.map((p) => ({
    bucket: formatOpsTrendLabel(p.bucket, granularity),
    value: dimMetricValue(p, metric),
  }));

  function exportBucket(bucket: (typeof EFFICIENCY_BUCKETS)[number]) {
    const rows = riders.filter((r) => r.bucket === bucket);
    downloadCsv(
      `ops-bucket-${bucket}`,
      toCsv(
        ["name", "id", "Restaurant", "zone", "vehicle", "dpd", "tgt_eff", "dpd_eff"],
        rows.map((r) => [
          r.name,
          r.display_id,
          r.store_label,
          r.zone ?? "—",
          r.vehicle_label,
          r.dpd,
          r.tgt_eff,
          r.dpd_eff,
        ]),
      ),
    );
  }

  return (
    <div className={cn("flex flex-col", LAYOUT.stackGap)}>
      <KpiGrid
        compact
        items={[
          { label: t("kpi.orders"), value: formatInt(data.kpis.orders) },
          { label: t("kpi.overallDpd"), value: formatDpd(data.kpis.overall_dpd), accent: "primary" },
          { label: t("kpi.avgDpdEff"), value: formatPct(data.kpis.avg_dpd_eff) },
          { label: t("kpi.avgTgtEff"), value: formatPct(data.kpis.avg_tgt_eff), accent: "success" },
          { label: t("kpi.targetDpd"), value: formatDpd(data.target_dpd) },
          { label: t("kpi.storesAbove"), value: formatInt(data.kpis.stores_above), accent: "success" },
          { label: t("kpi.storesBelow"), value: formatInt(data.kpis.stores_below), accent: "danger" },
        ]}
      />
      <OpsChartCard
        title={opsChartTitle(t, "trend", seriesName)}
        onExport={() =>
          downloadCsv(
            "ops-dpd-trend",
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
        title={t("chart.distribution")}
        onExport={() => {
          downloadCsv(
            "ops-distribution-riders",
            toCsv(
              ["bucket", "name", "id", "Restaurant", "zone", "dpd", "tgt_eff"],
              riders
                .filter((r) => r.bucket)
                .map((r) => [
                  r.bucket ? t(`bucket.${r.bucket}`) : "",
                  r.name,
                  r.display_id,
                  r.store_label,
                  r.zone ?? "—",
                  r.dpd,
                  r.tgt_eff,
                ]),
            ),
          );
        }}
        empty={riders.every((r) => !r.bucket)}
        emptyTitle={t("emptyChart")}
      >
        <OpsBarChart
          data={dist}
          xKey="key"
          series={[{ key: "riders", name: t("kpi.riders"), color: "#059669" }]}
          metric="riders"
        />
      </OpsChartCard>
      <div className="grid gap-2 sm:grid-cols-5">
        {EFFICIENCY_BUCKETS.map((b) => (
          <button
            key={b}
            type="button"
            onClick={() => exportBucket(b)}
            className="rounded-xl border border-border bg-card p-3 text-start shadow-sm hover:bg-muted/30"
          >
            <p className="text-[10px] font-semibold uppercase text-muted-foreground">
              {t(`bucket.${b}`)}
            </p>
            <p className="text-xl font-semibold tabular-nums">{formatInt(counts[b])}</p>
            <p className="text-[10px] text-primary">{t("exportBucket")}</p>
          </button>
        ))}
      </div>
      <div className="grid gap-2 lg:grid-cols-3 lg:items-stretch">
        <OpsChartCard
          title={opsChartTitle(t, "nationality", seriesName)}
          onExport={() =>
            downloadCsv(
              "ops-dpd-nationality",
              toCsv(
                ["nationality", metric],
                data.by_nationality
                  .filter((r) => isChartableDimKey(r.key))
                  .map((r) => [countryLabel(r.key), dimMetricValue(r, metric)]),
              ),
            )
          }
          empty={data.by_nationality.length === 0}
          emptyTitle={t("emptyChart")}
        >
          <OpsBarChart
            data={data.by_nationality
              .filter((r) => isChartableDimKey(r.key))
              .map((r) => ({ key: countryLabel(r.key), value: dimMetricValue(r, metric) }))}
            xKey="key"
            series={series}
            layout="horizontal"
            metric={metric}
            colorByCategory
          />
        </OpsChartCard>
        <OpsChartCard
          title={opsChartTitle(t, "zone", seriesName)}
          onExport={() =>
            downloadCsv(
              "ops-dpd-zone",
              toCsv(
                ["zone", metric],
                data.by_zone
                  .filter((r) => isChartableDimKey(r.key))
                  .map((r) => [r.key, dimMetricValue(r, metric)]),
              ),
            )
          }
          empty={data.by_zone.length === 0}
          emptyTitle={t("emptyChart")}
        >
          <OpsBarChart
            data={data.by_zone
              .filter((r) => isChartableDimKey(r.key))
              .map((r) => ({ key: r.key, value: dimMetricValue(r, metric) }))}
            xKey="key"
            series={series}
            layout="horizontal"
            metric={metric}
            colorByCategory
          />
        </OpsChartCard>
        <OpsChartCard
          title={opsChartTitle(t, "vehicle", seriesName)}
          onExport={() =>
            downloadCsv(
              "ops-dpd-vehicle",
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
            data={data.by_vehicle.map((r) => ({
              key: vehicleLabel(r.key),
              value: dimMetricValue(r, metric),
            }))}
            xKey="key"
            series={series}
            metric={metric}
            colorByCategory
          />
        </OpsChartCard>
      </div>
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold">{t("storesTitle")}</h3>
          {data.stores.length ? (
            <button
              type="button"
              className="text-xs text-primary hover:underline"
              onClick={() =>
                downloadCsv(
                  "ops-dpd-stores",
                  toCsv(
                    [t("col.store"), t("col.zone"), t("col.orders"), t("col.dpd"), t("col.riders")],
                    data.stores.map((s) => [
                      s.store_name,
                      s.zone_name,
                      s.orders,
                      s.store_dpd,
                      s.active_riders,
                    ]),
                  ),
                )
              }
            >
              {t("exportTab")}
            </button>
          ) : null}
        </div>
        {data.stores.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("emptyStores")}</p>
        ) : (
          <AppDataTable
            columns={[
              { id: "store", label: t("col.store") },
              { id: "zone", label: t("col.zone") },
              { id: "orders", label: t("col.orders"), className: "text-end" },
              { id: "dpd", label: t("col.dpd"), className: "text-end" },
              { id: "riders", label: t("col.riders"), className: "text-end" },
            ]}
          >
            {data.stores.map((s) => (
              <AppDataTableRow key={s.store_id ?? s.store_name ?? "x"}>
                <TableCell className="text-sm">{s.store_name ?? "—"}</TableCell>
                <TableCell className="text-sm">{s.zone_name ?? "—"}</TableCell>
                <TableCell className="text-end tabular-nums text-sm">
                  {formatInt(s.orders)}
                </TableCell>
                <TableCell className="text-end tabular-nums text-sm">
                  {formatDpd(s.store_dpd)}
                </TableCell>
                <TableCell className="text-end tabular-nums text-sm">
                  {formatInt(s.active_riders)}
                </TableCell>
              </AppDataTableRow>
            ))}
          </AppDataTable>
        )}
      </div>
    </div>
  );
}
