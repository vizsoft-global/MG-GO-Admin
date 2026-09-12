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
import type { OpsSnapshot } from "../performance-ops-types";
import { OpsBarChart, OpsChartCard, OpsKpiDelta, OpsLineChart } from "./ops-charts";
import { cn } from "@/lib/utils";

export function OpsOverviewTab({ data }: { data: OpsSnapshot }) {
  const t = useTranslations("pages.performance.ops");
  const k = data.kpis;

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
      label: t("kpi.active"),
      value: formatInt(k.active),
      caption: <OpsKpiDelta {...formatDelta(k.active, k.active_prev)} />,
    },
    {
      label: t("kpi.riders"),
      value: formatInt(k.riders),
      caption: <OpsKpiDelta {...formatDelta(k.riders, k.riders_prev)} />,
    },
    {
      label: t("kpi.storesAbove"),
      value: formatInt(k.stores_above),
      accent: "success" as const,
    },
    {
      label: t("kpi.storesBelow"),
      value: formatInt(k.stores_below),
      accent: "danger" as const,
    },
  ];

  const trend = data.trend.map((p) => ({
    bucket: p.bucket.slice(5),
    orders: p.orders,
    dpd: p.dpd,
    tgt_eff: p.tgt_eff,
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
          title={t("chart.trend")}
          onExport={() =>
            downloadCsv(
              "ops-trend",
              toCsv(
                ["bucket", "orders", "dpd", "tgt_eff"],
                data.trend.map((p) => [p.bucket, p.orders, p.dpd, p.tgt_eff]),
              ),
            )
          }
          empty={trend.length === 0}
          emptyTitle={t("emptyChart")}
        >
          <OpsLineChart
            data={trend}
            xKey="bucket"
            series={[
              { key: "orders", name: t("kpi.orders"), color: "#2563eb" },
              { key: "dpd", name: t("kpi.overallDpd"), color: "#059669" },
            ]}
          />
        </OpsChartCard>
        <OpsChartCard
          title={t("chart.vehicle")}
          onExport={() =>
            downloadCsv(
              "ops-vehicle",
              toCsv(
                ["vehicle", "orders", "dpd"],
                data.by_vehicle.map((r) => [vehicleLabel(r.key), r.orders, r.dpd]),
              ),
            )
          }
          empty={data.by_vehicle.length === 0}
          emptyTitle={t("emptyVehicle")}
        >
          <OpsBarChart
            data={data.by_vehicle.map((r) => ({
              key: vehicleLabel(r.key),
              orders: r.orders,
              dpd: r.dpd,
            }))}
            xKey="key"
            series={[{ key: "orders", name: t("kpi.orders"), color: "#059669" }]}
          />
        </OpsChartCard>
        <OpsChartCard
          title={t("chart.zone")}
          onExport={() =>
            downloadCsv(
              "ops-zone",
              toCsv(
                ["zone", "orders", "dpd", "active"],
                data.by_zone.map((r) => [r.key, r.orders, r.dpd, r.active_riders ?? r.riders]),
              ),
            )
          }
          empty={data.by_zone.length === 0}
          emptyTitle={t("emptyChart")}
        >
          <OpsBarChart
            data={data.by_zone.map((r) => ({ key: r.key, dpd: r.dpd }))}
            xKey="key"
            series={[{ key: "dpd", name: t("kpi.overallDpd"), color: "#2563eb" }]}
            layout="horizontal"
          />
        </OpsChartCard>
        <OpsChartCard
          title={t("chart.partner")}
          onExport={() =>
            downloadCsv(
              "ops-partner",
              toCsv(
                ["partner", "orders", "dpd"],
                data.by_partner.map((r) => [partnerLabel(r.key) === "—" ? r.key : partnerLabel(r.key), r.orders, r.dpd]),
              ),
            )
          }
          empty={data.by_partner.length === 0}
          emptyTitle={t("emptyChart")}
        >
          <OpsBarChart
            data={data.by_partner.map((r) => ({
              key: partnerLabel(r.key) === "—" ? r.key : partnerLabel(r.key),
              orders: r.orders,
            }))}
            xKey="key"
            series={[{ key: "orders", name: t("kpi.orders"), color: "#7c3aed" }]}
          />
        </OpsChartCard>
        <OpsChartCard
          title={t("chart.nationality")}
          onExport={() =>
            downloadCsv(
              "ops-nationality",
              toCsv(
                ["nationality", "orders", "dpd"],
                data.by_nationality.map((r) => [countryLabel(r.key), r.orders, r.dpd]),
              ),
            )
          }
          empty={data.by_nationality.length === 0}
          emptyTitle={t("emptyChart")}
        >
          <OpsBarChart
            data={data.by_nationality.map((r) => ({
              key: countryLabel(r.key),
              orders: r.orders,
            }))}
            xKey="key"
            series={[{ key: "orders", name: t("kpi.orders"), color: "#d97706" }]}
            layout="horizontal"
          />
        </OpsChartCard>
        <OpsChartCard
          title={t("chart.company")}
          onExport={() =>
            downloadCsv(
              "ops-company",
              toCsv(
                ["company", "orders", "dpd"],
                data.by_company.map((r) => [companyLabel(r.key), r.orders, r.dpd]),
              ),
            )
          }
          empty={data.by_company.length === 0}
          emptyTitle={t("emptyChart")}
        >
          <OpsBarChart
            data={data.by_company.map((r) => ({
              key: companyLabel(r.key),
              orders: r.orders,
            }))}
            xKey="key"
            series={[{ key: "orders", name: t("kpi.orders"), color: "#0891b2" }]}
          />
        </OpsChartCard>
      </div>
    </div>
  );
}
