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
  TableNameCell,
  TableToolbar,
  useTablePrefs,
  type TableToolbarColumn,
} from "@/components/app/table-toolbar";
import {
  companyRowsFromRiders,
  dimMetricValue,
  isChartableDimKey,
  UNASSIGNED_COMPANY_KEY,
  type OpsChartMetric,
} from "../performance-ops-formulas";
import { downloadCsv, toCsv } from "../performance-ops-table";
import {
  companyLabel,
  enrichOpsRider,
  formatDpd,
  formatInt,
  formatMinutes,
  formatMinutesCard,
  formatOpsMetricValue,
  formatPct,
  formatUtr,
  vehicleLabel,
} from "../performance-ops-format";
import type { OpsSnapshot } from "../performance-ops-types";
import { OpsChartCard, OpsDonut, OpsRankedBars, OpsVBars, OpsVBarsLabels, opsChartTitle } from "./ops-charts";
import { cn } from "@/lib/utils";

type CompanySortKey =
  | "orders"
  | "riders"
  | "active_riders"
  | "dpd"
  | "dpd_eff"
  | "tgt_eff"
  | "utr"
  | "avg_delivery_min";


export function OpsOutsourceTab({
  data,
  metric,
}: {
  data: OpsSnapshot;
  metric: OpsChartMetric;
}) {
  const t = useTranslations("pages.performance.ops");
  const columns = useMemo(
    (): TableToolbarColumn[] => [
      { id: "company", label: t("col.company"), locked: true },
      { id: "orders", label: t("col.orders") },
      { id: "riders", label: t("col.riders") },
      { id: "active", label: t("col.activeRiders") },
      { id: "dpd", label: t("col.dpd") },
      { id: "utr", label: t("col.utr") },
      { id: "days", label: t("kpi.workingDays") },
      { id: "hours", label: t("kpi.workingHours") },
      { id: "dpdEff", label: t("col.dpdEff") },
      { id: "tgt", label: t("col.tgtEff") },
      { id: "avg", label: t("col.avgDelivery") },
    ],
    [t],
  );
  const prefs = useTablePrefs("ops-outsource-companies", columns);
  const seriesName = t(`viewBy.${metric}`);
  const fmt = (value: number) => formatOpsMetricValue(metric, value);

  const companies = useMemo(
    () => companyRowsFromRiders(data.riders).filter((r) => isChartableDimKey(r.key)),
    [data.riders],
  );
  const [sortKey, setSortKey] = useState<CompanySortKey | null>(null);
  const sortedCompanies = useMemo(() => {
    if (!sortKey) return companies;
    return [...companies].sort((a, b) => (b[sortKey] ?? 0) - (a[sortKey] ?? 0));
  }, [companies, sortKey]);
  const toggleSort = (key: CompanySortKey) =>
    setSortKey((prev) => (prev === key ? null : key));

  function labelCompany(key: string) {
    return key === UNASSIGNED_COMPANY_KEY ? t("unassignedCompany") : companyLabel(key);
  }

  /**
   * The reference's three charts: company, zone, and *orders* by vehicle type.
   *
   * The vehicle donut is deliberately orders rather than the selected metric —
   * it answers "what is this outsource fleet made of", which a DPD or UTR slice
   * would not.
   */
  const companyRows = companies
    .map((row, index) => ({
      key: `${labelCompany(row.key)}-${index}`,
      label: labelCompany(row.key),
      value: dimMetricValue(row, metric),
    }))
    .filter((row): row is { key: string; label: string; value: number } =>
      typeof row.value === "number" && Number.isFinite(row.value),
    )
    .sort((left, right) => right.value - left.value);

  const zoneRows = data.by_zone
    .filter((row) => isChartableDimKey(row.key))
    .map((row, index) => ({
      key: `${row.label || row.key}-${index}`,
      label: row.label || row.key,
      value: dimMetricValue(row, metric),
    }))
    .filter((row): row is { key: string; label: string; value: number } =>
      typeof row.value === "number" && Number.isFinite(row.value),
    )
    .sort((left, right) => right.value - left.value);

  const vehicleRows = useMemo(() => {
    const counts = new Map<string, number>();
    for (const rider of data.riders.map(enrichOpsRider)) {
      const key = rider.vehicle_label || vehicleLabel(rider.vehicle_key ?? "") || t("noVehicle");
      counts.set(key, (counts.get(key) ?? 0) + rider.orders);
    }
    return [...counts.entries()]
      .map(([label, orders]) => ({ key: label, label, value: orders }))
      .filter((row) => row.value > 0)
      .sort((left, right) => right.value - left.value);
  }, [data.riders, t]);

  const visibleRows = sortedCompanies.filter((row) => {
    const needle = prefs.appliedQuery.trim().toLowerCase();
    return !needle || labelCompany(row.key).toLowerCase().includes(needle);
  });

  return (
    <div className={cn("flex flex-col", LAYOUT.stackGap)}>
      <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        {t("outsourceBanner")}
      </p>
      <KpiGrid
        compact
        items={[
          {
            label: t("kpi.orders"),
            value: formatInt(data.kpis.orders),
            selected: sortKey === "orders",
            onClick: () => toggleSort("orders"),
          },
          {
            label: t("kpi.overallDpd"),
            value: formatDpd(data.kpis.overall_dpd),
            accent: "primary",
            selected: sortKey === "dpd",
            onClick: () => toggleSort("dpd"),
          },
          {
            label: t("kpi.riders"),
            value: formatInt(data.kpis.riders),
            selected: sortKey === "riders",
            onClick: () => toggleSort("riders"),
          },
          {
            label: t("kpi.active"),
            value: formatInt(data.kpis.active),
            selected: sortKey === "active_riders",
            onClick: () => toggleSort("active_riders"),
          },
          {
            label: t("kpi.dpdEff"),
            value: formatPct(data.kpis.avg_dpd_eff),
            selected: sortKey === "dpd_eff",
            onClick: () => toggleSort("dpd_eff"),
          },
          {
            label: t("kpi.tgtEff"),
            value: formatPct(data.kpis.avg_tgt_eff),
            accent: "success",
            selected: sortKey === "tgt_eff",
            onClick: () => toggleSort("tgt_eff"),
          },
          {
            label: t("kpi.utr"),
            value: formatUtr(data.kpis.utr),
            selected: sortKey === "utr",
            onClick: () => toggleSort("utr"),
          },
          {
            label: t("kpi.avgDelivery"),
            value: formatMinutesCard(data.kpis.avg_delivery_min),
            selected: sortKey === "avg_delivery_min",
            onClick: () => toggleSort("avg_delivery_min"),
          },
        ]}
      />

      <div className="grid gap-2 lg:grid-cols-3 lg:items-stretch">
        <OpsChartCard
          title={opsChartTitle(t, "company", seriesName)}
          onExport={() =>
            downloadCsv(
              "ops-outsource-companies",
              toCsv(["company", metric], companyRows.map((r) => [r.label, r.value])),
            )
          }
          empty={companyRows.length === 0}
          emptyTitle={t("emptyChart")}
        >
          <div className="flex flex-col gap-1">
            <OpsVBars rows={companyRows} format={fmt} />
            <OpsVBarsLabels rows={companyRows} />
          </div>
        </OpsChartCard>
        <OpsChartCard
          title={opsChartTitle(t, "zone", seriesName)}
          onExport={() =>
            downloadCsv("ops-outsource-zones", toCsv(["zone", metric], zoneRows.map((r) => [r.label, r.value])))
          }
          empty={zoneRows.length === 0}
          emptyTitle={t("emptyChart")}
        >
          <OpsRankedBars rows={zoneRows} format={fmt} />
        </OpsChartCard>
        <OpsChartCard
          title={t("chartTitle.vehicle", { metric: t("kpi.orders") })}
          onExport={() =>
            downloadCsv(
              "ops-outsource-vehicles",
              toCsv(["vehicle", t("kpi.orders")], vehicleRows.map((r) => [r.label, r.value])),
            )
          }
          empty={vehicleRows.length === 0}
          emptyTitle={t("emptyVehicle")}
        >
          <OpsDonut rows={vehicleRows} format={(value) => formatInt(value)} />
        </OpsChartCard>
      </div>

      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold">{t("companyTable")}</h3>
        </div>
        <AppDataTable
          toolbar={
            <TableToolbar
              prefs={prefs}
              entity={t("companyTable")}
              columns={columns}
              rowKind="dynamic"
              filteredCount={visibleRows.length}
              totalCount={sortedCompanies.length}
              onExport={() =>
                downloadCsv(
                  "ops-outsource-companies-table",
                  toCsv(
                    [
                      t("col.company"),
                      t("col.orders"),
                      t("col.riders"),
                      t("col.activeRiders"),
                      t("col.dpd"),
                      t("col.utr"),
                      t("kpi.workingDays"),
                      t("kpi.workingHours"),
                      t("col.dpdEff"),
                      t("col.tgtEff"),
                      t("col.avgDelivery"),
                    ],
                    companies.map((r) => [
                      labelCompany(r.key),
                      r.orders,
                      r.riders,
                      r.active_riders,
                      r.dpd,
                      r.utr,
                      r.working_days,
                      r.working_hours,
                      r.dpd_eff,
                      r.tgt_eff,
                      r.avg_delivery_min,
                    ]),
                  ),
                )
              }
            />
          }
          columns={prefs.orderedColumns
            .filter((column) => prefs.isVisible(column.id))
            .map((column) => ({
              id: column.id,
              label: column.label,
              className: column.id === "company" ? undefined : "text-end",
            }))}
        >
          {visibleRows.map((r) => (
            <AppDataTableRow key={r.key}>
              {prefs.orderedColumns
                .filter((column) => prefs.isVisible(column.id))
                .map((column) => {
                  const end = "text-end tabular-nums text-sm";
                  if (column.id === "company")
                    return (
                      <TableCell key={column.id} className="text-sm">
                        <TableNameCell name={labelCompany(r.key)} />
                      </TableCell>
                    );
                  if (column.id === "orders")
                    return <TableCell key={column.id} className={end}>{formatInt(r.orders)}</TableCell>;
                  if (column.id === "riders")
                    return <TableCell key={column.id} className={end}>{formatInt(r.riders)}</TableCell>;
                  if (column.id === "active")
                    return (
                      <TableCell key={column.id} className={end}>
                        {formatInt(r.active_riders ?? r.riders)}
                      </TableCell>
                    );
                  if (column.id === "dpd")
                    return <TableCell key={column.id} className={end}>{formatDpd(r.dpd)}</TableCell>;
                  if (column.id === "utr")
                    return <TableCell key={column.id} className={end}>{formatUtr(r.utr)}</TableCell>;
                  if (column.id === "days")
                    return (
                      <TableCell key={column.id} className={end}>
                        {formatInt(r.working_days)}
                      </TableCell>
                    );
                  if (column.id === "hours")
                    return (
                      <TableCell key={column.id} className={end}>
                        {formatDpd(r.working_hours)}
                      </TableCell>
                    );
                  if (column.id === "dpdEff")
                    return <TableCell key={column.id} className={end}>{formatPct(r.dpd_eff)}</TableCell>;
                  if (column.id === "tgt")
                    return <TableCell key={column.id} className={end}>{formatPct(r.tgt_eff)}</TableCell>;
                  return (
                    <TableCell key={column.id} className={end}>
                      {formatMinutes(r.avg_delivery_min)}
                    </TableCell>
                  );
                })}
            </AppDataTableRow>
          ))}
        </AppDataTable>
      </div>
    </div>
  );
}
