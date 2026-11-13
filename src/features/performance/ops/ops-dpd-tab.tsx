"use client";

import { useMemo, useState } from "react";
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
  companyLabel,
  enrichOpsRider,
  formatDpd,
  formatInt,
  formatMinutes,
  formatOpsMetricValue,
  formatPct,
  formatUtr,
  vehicleLabel,
} from "../performance-ops-format";
import { countryLabel } from "@/lib/geo/countries";
import type { OpsDimRow, OpsSnapshot } from "../performance-ops-types";
import {
  OPS_BAND_COLORS,
  OpsChartCard,
  OpsLineChart,
  OpsRankedBars,
  OpsVBars,
  OpsVBarsLabels,
  opsChartTitle,
} from "./ops-charts";
import { cn } from "@/lib/utils";

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
  const storeColumns = useMemo(
    (): TableToolbarColumn[] => [
      { id: "store", label: t("col.store"), locked: true },
      { id: "zone", label: t("col.zone") },
      { id: "orders", label: t("col.orders") },
      { id: "days", label: t("kpi.workingDays") },
      { id: "hours", label: t("kpi.workingHours") },
      { id: "dpd", label: t("col.dpd") },
      { id: "utr", label: t("col.utr") },
      { id: "avg", label: t("col.avgDelivery") },
      { id: "riders", label: t("col.riders") },
    ],
    [t],
  );
  const storePrefs = useTablePrefs("ops-dpd-stores", storeColumns);
  const [storeSort, setStoreSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(null);
  const riders = useMemo(() => data.riders.map(enrichOpsRider), [data.riders]);
  const seriesName = t(`viewBy.${metric}`);
  const series = [{ key: "value", name: seriesName, color: OPS_METRIC_COLOR[metric] }];
  const fmt = (value: number) => formatOpsMetricValue(metric, value);

  function toggleStoreSort(key: string, dir: "asc" | "desc" = "desc") {
    setStoreSort((prev) => (prev?.key === key && prev.dir === dir ? null : { key, dir }));
  }

  const storeRows = useMemo(() => {
    const needle = storePrefs.appliedQuery.trim().toLowerCase();
    const rows = data.stores.filter(
      (s) => !needle || `${s.store_name ?? ""} ${s.zone_name ?? ""}`.toLowerCase().includes(needle),
    );
    if (!storeSort) return rows;
    const dir = storeSort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const pick = (row: typeof a) => {
        if (storeSort.key === "store_dpd") return row.store_dpd ?? 0;
        if (storeSort.key === "utr") return row.utr ?? 0;
        if (storeSort.key === "orders") return row.orders ?? 0;
        if (storeSort.key === "avg_delivery_min") return row.avg_delivery_min ?? 0;
        return row.active_riders ?? 0;
      };
      return (pick(a) - pick(b)) * dir;
    });
  }, [data.stores, storePrefs.appliedQuery, storeSort]);

  /**
   * The two distributions the reference draws side by side with the trend.
   *
   * Target efficiency and UTR are separate bands because they answer different
   * questions — "how did the fleet do against its own targets" versus "how many
   * orders per on-shift hour" — and the reference puts them in two charts for
   * exactly that reason.
   */
  const targetDist = useMemo(() => {
    const counts = new Map<string, number>();
    for (const bucket of EFFICIENCY_BUCKETS) counts.set(bucket, 0);
    for (const rider of riders) {
      if (rider.bucket) counts.set(rider.bucket, (counts.get(rider.bucket) ?? 0) + 1);
    }
    return EFFICIENCY_BUCKETS.map((bucket) => ({
      key: bucket,
      label: t(`bucket.${bucket}`),
      value: counts.get(bucket) ?? 0,
    }));
  }, [riders, t]);

  const utrDist = useMemo(() => {
    const counts = new Map<string, number>();
    for (const bucket of EFFICIENCY_BUCKETS) counts.set(bucket, 0);
    for (const rider of riders) {
      const bucket = utrBucket(rider.utr);
      if (bucket) counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
    }
    return EFFICIENCY_BUCKETS.map((bucket) => ({
      key: bucket,
      label: t(`utrBucket.${bucket}`),
      value: counts.get(bucket) ?? 0,
    }));
  }, [riders, t]);

  const trend = data.trend.map((p) => ({
    bucket: formatOpsTrendLabel(p.bucket, granularity),
    value: dimMetricValue(p, metric),
  }));
  const zones = rankedRows(data.by_zone, (r) => r.label || r.key, metric);
  const nationalities = rankedRows(data.by_nationality, (r) => countryLabel(r.key), metric);
  const vehicles = rankedRows(data.by_vehicle, (r) => vehicleLabel(r.key), metric);
  const companies = rankedRows(data.by_company, (r) => companyLabel(r.key), metric);

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
          {
            label: t("kpi.orders"),
            value: formatInt(data.kpis.orders),
            selected: storeSort?.key === "orders",
            onClick: () => toggleStoreSort("orders"),
          },
          {
            label: t("kpi.overallDpd"),
            value: formatDpd(data.kpis.overall_dpd),
            accent: "primary",
            selected: storeSort?.key === "store_dpd",
            onClick: () => toggleStoreSort("store_dpd"),
          },
          {
            label: t("kpi.utr"),
            value: formatUtr(data.kpis.utr),
            selected: storeSort?.key === "utr",
            onClick: () => toggleStoreSort("utr"),
          },
          {
            label: t("kpi.avgDpdEff"),
            value: formatPct(data.kpis.avg_dpd_eff),
            selected: storeSort?.key === "avg_delivery_min",
            onClick: () => toggleStoreSort("avg_delivery_min", "asc"),
          },
          {
            label: t("kpi.avgTgtEff"),
            value: formatPct(data.kpis.avg_tgt_eff),
            accent: "success",
            selected: storeSort?.key === "riders",
            onClick: () => toggleStoreSort("riders"),
          },
          { label: t("kpi.targetDpd"), value: formatDpd(data.target_dpd) },
          {
            label: t("kpi.storesAbove"),
            value: formatInt(data.kpis.stores_above),
            accent: "success",
            selected: storeSort?.key === "store_dpd" && storeSort.dir === "desc",
            onClick: () => toggleStoreSort("store_dpd", "desc"),
          },
          {
            label: t("kpi.storesBelow"),
            value: formatInt(data.kpis.stores_below),
            accent: "danger",
            selected: storeSort?.key === "store_dpd" && storeSort.dir === "asc",
            onClick: () => toggleStoreSort("store_dpd", "asc"),
          },
        ]}
      />

      <div className="grid gap-2 lg:grid-cols-[1.25fr_1fr] lg:items-stretch">
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
          title={t("chart.utrDistribution")}
          onExport={() =>
            downloadCsv(
              "ops-utr-distribution",
              toCsv(["band", "riders"], utrDist.map((row) => [row.label, row.value])),
            )
          }
          empty={riders.length === 0}
          emptyTitle={t("emptyChart")}
        >
          <div className="flex flex-col gap-1">
            <OpsVBars rows={utrDist} format={(value) => formatInt(value)} colors={OPS_BAND_COLORS} />
            <OpsVBarsLabels rows={utrDist} />
          </div>
        </OpsChartCard>
      </div>

      <div className="grid gap-2 lg:grid-cols-2 lg:items-stretch">
        <OpsChartCard
          title={t("chart.distribution")}
          onExport={() =>
            downloadCsv(
              "ops-target-distribution",
              toCsv(["band", "riders"], targetDist.map((row) => [row.label, row.value])),
            )
          }
          empty={riders.length === 0}
          emptyTitle={t("emptyChart")}
        >
          <div className="flex flex-col gap-1">
            <OpsVBars rows={targetDist} format={(value) => formatInt(value)} colors={OPS_BAND_COLORS} />
            <OpsVBarsLabels rows={targetDist} />
          </div>
        </OpsChartCard>
        <OpsChartCard
          title={opsChartTitle(t, "zone", seriesName)}
          onExport={() =>
            downloadCsv("ops-dpd-zone", toCsv(["zone", metric], zones.map((r) => [r.label, r.value])))
          }
          empty={zones.length === 0}
          emptyTitle={t("emptyChart")}
        >
          <OpsRankedBars rows={zones} format={fmt} />
        </OpsChartCard>
      </div>

      <div className="grid gap-2 lg:grid-cols-3 lg:items-stretch">
        <OpsChartCard
          title={opsChartTitle(t, "nationality", seriesName)}
          onExport={() =>
            downloadCsv(
              "ops-dpd-nationality",
              toCsv(["nationality", metric], nationalities.map((r) => [r.label, r.value])),
            )
          }
          empty={nationalities.length === 0}
          emptyTitle={t("emptyChart")}
        >
          <OpsRankedBars rows={nationalities} format={fmt} />
        </OpsChartCard>
        <OpsChartCard
          title={opsChartTitle(t, "vehicle", seriesName)}
          onExport={() =>
            downloadCsv(
              "ops-dpd-vehicle",
              toCsv(["vehicle", metric], vehicles.map((r) => [r.label, r.value])),
            )
          }
          empty={vehicles.length === 0}
          emptyTitle={t("emptyVehicle")}
        >
          <div className="flex flex-col gap-1">
            <OpsVBars rows={vehicles} format={fmt} />
            <OpsVBarsLabels rows={vehicles} />
          </div>
        </OpsChartCard>
        <OpsChartCard
          title={opsChartTitle(t, "company", seriesName)}
          onExport={() =>
            downloadCsv(
              "ops-dpd-company",
              toCsv(["company", metric], companies.map((r) => [r.label, r.value])),
            )
          }
          empty={companies.length === 0}
          emptyTitle={t("emptyChart")}
        >
          <div className="flex flex-col gap-1">
            <OpsVBars rows={companies} format={fmt} />
            <OpsVBarsLabels rows={companies} />
          </div>
        </OpsChartCard>
      </div>

      {/* Per-band rider counts, exportable — the reference's bucket cards. */}
      <div className="grid gap-2 sm:grid-cols-5">
        {EFFICIENCY_BUCKETS.map((bucket) => {
          const metricBucket = metric === "utr" ? "utrBucket" : "bucket";
          const row = (metric === "utr" ? utrDist : targetDist).find((item) => item.key === bucket);
          return (
            <button
              key={bucket}
              type="button"
              onClick={() => exportBucket(bucket)}
              className="cursor-pointer rounded-xl border border-border bg-card p-3 text-start shadow-sm hover:bg-muted/30"
            >
              <p className="text-xs font-semibold text-muted-foreground">
                {t(`${metricBucket}.${bucket}`)}
              </p>
              <p className="text-xl font-semibold tabular-nums">{formatInt(row?.value ?? 0)}</p>
              <p className="text-xs text-primary">{t("exportBucket")}</p>
            </button>
          );
        })}
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
                filteredCount={storeRows.length}
                totalCount={data.stores.length}
                onExport={() =>
                  downloadCsv(
                    "ops-dpd-stores",
                    toCsv(
                      [
                        t("col.store"),
                        t("col.zone"),
                        t("col.orders"),
                        t("kpi.workingDays"),
                        t("kpi.workingHours"),
                        t("col.dpd"),
                        t("col.utr"),
                        t("col.avgDelivery"),
                        t("col.riders"),
                      ],
                      data.stores.map((s) => [
                        s.store_name,
                        s.zone_name,
                        s.orders,
                        s.working_days,
                        s.working_hours,
                        s.store_dpd,
                        s.utr,
                        s.avg_delivery_min,
                        s.active_riders,
                      ]),
                    ),
                  )
                }
              />
            }
            columns={storePrefs.orderedColumns
              .filter((column) => storePrefs.isVisible(column.id))
              .map((column) => ({
                id: column.id,
                label: column.label,
                className:
                  column.id === "store" || column.id === "zone" ? undefined : "text-end",
              }))}
          >
            {storeRows.map((s) => (
              <AppDataTableRow key={s.store_id ?? s.store_name ?? "x"}>
                {storePrefs.orderedColumns
                  .filter((column) => storePrefs.isVisible(column.id))
                  .map((column) => {
                    const end = "text-end tabular-nums text-sm";
                    if (column.id === "store")
                      return (
                        <TableCell key={column.id} className="text-sm">
                          {s.store_name ? <TableNameCell name={s.store_name} /> : <EmptyCell />}
                        </TableCell>
                      );
                    if (column.id === "zone")
                      return (
                        <TableCell key={column.id} className="text-sm">
                          {s.zone_name ? s.zone_name : <EmptyCell />}
                        </TableCell>
                      );
                    if (column.id === "orders")
                      return <TableCell key={column.id} className={end}>{formatInt(s.orders)}</TableCell>;
                    if (column.id === "days")
                      return (
                        <TableCell key={column.id} className={end}>
                          {formatInt(s.working_days)}
                        </TableCell>
                      );
                    if (column.id === "hours")
                      return (
                        <TableCell key={column.id} className={end}>
                          {formatDpd(s.working_hours)}
                        </TableCell>
                      );
                    if (column.id === "dpd")
                      return <TableCell key={column.id} className={end}>{formatDpd(s.store_dpd)}</TableCell>;
                    if (column.id === "utr")
                      return <TableCell key={column.id} className={end}>{formatUtr(s.utr)}</TableCell>;
                    if (column.id === "avg")
                      return (
                        <TableCell key={column.id} className={end}>
                          {formatMinutes(s.avg_delivery_min)}
                        </TableCell>
                      );
                    return (
                      <TableCell key={column.id} className={end}>
                        {formatInt(s.active_riders)}
                      </TableCell>
                    );
                  })}
              </AppDataTableRow>
            ))}
          </AppDataTable>
        )}
      </div>
    </div>
  );
}
