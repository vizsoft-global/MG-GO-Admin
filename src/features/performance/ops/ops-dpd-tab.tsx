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
  EmptyCell,
  TableNameCell,
  TableToolbar,
  useTablePrefs,
  type TableToolbarColumn,
} from "@/components/app/table-toolbar";
import {
  dimMetricValue,
  EFFICIENCY_BUCKETS,
  formatOpsTrendLabel,
  isChartableDimKey,
  OPS_METRIC_COLOR,
  utrBucket,
  type OpsChartMetric,
  type OpsGranularity,
} from "../performance-ops-formulas";
import { downloadCsv, toCsv } from "../performance-ops-table";
import {
  enrichOpsRider,
  formatDpd,
  formatInt,
  formatMinutes,
  formatPct,
  formatUtr,
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
  const storeColumns = useMemo((): TableToolbarColumn[] => [
    { id: "store", label: t("col.store"), locked: true },
    { id: "zone", label: t("col.zone") },
    { id: "orders", label: t("col.orders") },
    { id: "dpd", label: t("col.dpd") },
    { id: "utr", label: t("col.utr") },
    { id: "avg", label: t("col.avgDelivery") },
    { id: "riders", label: t("col.riders") },
  ], [t]);
  const storePrefs = useTablePrefs("ops-dpd-stores", storeColumns);
  const riders = useMemo(() => data.riders.map(enrichOpsRider), [data.riders]);
  const seriesName = t(`viewBy.${metric}`);
  const series = [{ key: "value", name: seriesName, color: OPS_METRIC_COLOR[metric] }];

  const counts = useMemo(() => {
    const out = Object.fromEntries(EFFICIENCY_BUCKETS.map((b) => [b, 0])) as Record<
      (typeof EFFICIENCY_BUCKETS)[number],
      number
    >;
    for (const r of riders) {
      const b = metric === "utr" ? utrBucket(r.utr) : r.bucket;
      if (b) out[b] += 1;
    }
    return out;
  }, [riders, metric]);

  const bucketNs = metric === "utr" ? "utrBucket" : "bucket";
  const dist = EFFICIENCY_BUCKETS.map((b) => ({
    key: t(`${bucketNs}.${b}`),
    riders: counts[b],
  }));

  const trend = data.trend.map((p) => ({
    bucket: formatOpsTrendLabel(p.bucket, granularity),
    value: dimMetricValue(p, metric),
  }));

  function exportBucket(bucket: (typeof EFFICIENCY_BUCKETS)[number]) {
    const rows = riders.filter(
      (r) => (metric === "utr" ? utrBucket(r.utr) : r.bucket) === bucket,
    );
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
          { label: t("kpi.utr"), value: formatUtr(data.kpis.utr) },
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
        title={metric === "utr" ? t("chart.utrDistribution") : t("chart.distribution")}
        onExport={() => {
          downloadCsv(
            "ops-distribution-riders",
            toCsv(
              ["bucket", "name", "id", "Restaurant", "zone", "dpd", "tgt_eff"],
              riders
                .filter((r) => (metric === "utr" ? utrBucket(r.utr) : r.bucket))
                .map((r) => {
                  const b = metric === "utr" ? utrBucket(r.utr) : r.bucket;
                  return [
                    b ? t(`${bucketNs}.${b}`) : "",
                    r.name,
                    r.display_id,
                    r.store_label,
                    r.zone ?? "—",
                    r.dpd,
                    r.tgt_eff,
                  ];
                }),
            ),
          );
        }}
        empty={riders.every((r) => !(metric === "utr" ? utrBucket(r.utr) : r.bucket))}
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
            <p className="text-xs font-semibold uppercase text-muted-foreground">
              {t(`${bucketNs}.${b}`)}
            </p>
            <p className="text-xl font-semibold tabular-nums">{formatInt(counts[b])}</p>
            <p className="text-xs text-primary">{t("exportBucket")}</p>
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
                  .map((r) => [r.label || r.key, dimMetricValue(r, metric)]),
              ),
            )
          }
          empty={data.by_zone.length === 0}
          emptyTitle={t("emptyChart")}
        >
          <OpsBarChart
            data={data.by_zone
              .filter((r) => isChartableDimKey(r.key))
              .map((r) => ({ key: r.label || r.key, value: dimMetricValue(r, metric) }))}
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
        </div>
        {data.stores.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("emptyStores")}</p>
        ) : (
          <AppDataTable
            toolbar={
              <TableToolbar
                prefs={storePrefs}
                entity={t("storesTitle")}
                columns={storeColumns}
                rowKind="dynamic"
                filteredCount={data.stores.filter((s) => {
                  const needle = storePrefs.appliedQuery.trim().toLowerCase();
                  return !needle || `${s.store_name ?? ""} ${s.zone_name ?? ""}`.toLowerCase().includes(needle);
                }).length}
                totalCount={data.stores.length}
                onExport={() => downloadCsv(
                  "ops-dpd-stores",
                  toCsv(
                    [t("col.store"), t("col.zone"), t("col.orders"), t("col.dpd"), t("col.utr"), t("col.avgDelivery"), t("col.riders")],
                    data.stores.map((s) => [s.store_name, s.zone_name, s.orders, s.store_dpd, s.utr, s.avg_delivery_min, s.active_riders]),
                  ),
                )}
              />
            }
            columns={storePrefs.orderedColumns.filter((column) => storePrefs.isVisible(column.id)).map((column) => ({
              id: column.id,
              label: column.label,
              className: column.id === "store" || column.id === "zone" ? undefined : "text-end",
            }))}
          >
            {data.stores.filter((s) => {
              const needle = storePrefs.appliedQuery.trim().toLowerCase();
              return !needle || `${s.store_name ?? ""} ${s.zone_name ?? ""}`.toLowerCase().includes(needle);
            }).map((s) => (
              <AppDataTableRow key={s.store_id ?? s.store_name ?? "x"}>
                {storePrefs.orderedColumns.filter((column) => storePrefs.isVisible(column.id)).map((column) => {
                  if (column.id === "store") return <TableCell key={column.id} className="text-sm">{s.store_name ? <TableNameCell name={s.store_name} /> : <EmptyCell />}</TableCell>;
                  if (column.id === "zone") return <TableCell key={column.id} className="text-sm">{s.zone_name ? s.zone_name : <EmptyCell />}</TableCell>;
                  if (column.id === "orders") return <TableCell key={column.id} className="text-end tabular-nums text-sm">{formatInt(s.orders)}</TableCell>;
                  if (column.id === "dpd") return <TableCell key={column.id} className="text-end tabular-nums text-sm">{formatDpd(s.store_dpd)}</TableCell>;
                  if (column.id === "utr") return <TableCell key={column.id} className="text-end tabular-nums text-sm">{formatUtr(s.utr)}</TableCell>;
                  if (column.id === "avg") return <TableCell key={column.id} className="text-end tabular-nums text-sm">{formatMinutes(s.avg_delivery_min)}</TableCell>;
                  return <TableCell key={column.id} className="text-end tabular-nums text-sm">{formatInt(s.active_riders)}</TableCell>;
                })}
              </AppDataTableRow>
            ))}
          </AppDataTable>
        )}
      </div>
    </div>
  );
}
