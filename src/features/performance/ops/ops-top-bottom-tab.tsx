"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { LAYOUT } from "@/components/app/layout-spacing";
import { topBottomN } from "../performance-ops-formulas";
import { downloadCsv, toCsv } from "../performance-ops-table";
import { enrichOpsRider } from "../performance-ops-format";
import type { OpsRiderView, OpsSnapshot } from "../performance-ops-types";
import { OpsBarChart, OpsChartCard } from "./ops-charts";
import { cn } from "@/lib/utils";

function rank(riders: OpsRiderView[], key: "tgt_eff" | "dpd" | "orders", n: number) {
  const scored = riders.filter((r) => r.working_days > 0 && r[key] != null);
  const sorted = [...scored].sort((a, b) => Number(b[key] ?? 0) - Number(a[key] ?? 0));
  return { top: sorted.slice(0, n), bottom: [...sorted].reverse().slice(0, n) };
}

export function OpsTopBottomTab({ data }: { data: OpsSnapshot }) {
  const t = useTranslations("pages.performance.ops");
  const riders = useMemo(() => data.riders.map(enrichOpsRider), [data.riders]);
  const n = topBottomN(riders.filter((r) => r.working_days > 0).length);
  const byTgt = useMemo(() => rank(riders, "tgt_eff", n), [riders, n]);
  const byDpd = useMemo(() => rank(riders, "dpd", n), [riders, n]);

  if (n === 0) {
    return <p className="text-sm text-muted-foreground">{t("emptyTopBottom")}</p>;
  }

  function chartData(rows: OpsRiderView[], key: "tgt_eff" | "dpd") {
    return rows.map((r) => ({
      key: r.name,
      value: r[key],
      id: r.display_id,
      nationality: r.nationality_label,
      store: r.store_label,
      vehicle: r.vehicle_label,
      zone: r.zone ?? "—",
      source: r.source,
    }));
  }

  return (
    <div className={cn("flex flex-col", LAYOUT.stackGap)}>
      <p className="text-[11px] text-muted-foreground">{t("topBottomHint", { n })}</p>
      <div className="grid gap-2 lg:grid-cols-2 lg:items-stretch">
        <OpsChartCard
          title={t("chart.topTgt", { n })}
          onExport={() =>
            downloadCsv(
              "ops-top-tgt",
              toCsv(
                ["name", "id", "value", "store", "zone"],
                byTgt.top.map((r) => [r.name, r.display_id, r.tgt_eff, r.store_label, r.zone]),
              ),
            )
          }
        >
          <OpsBarChart
            data={chartData(byTgt.top, "tgt_eff")}
            xKey="key"
            series={[{ key: "value", name: t("col.tgtEff"), color: "#059669" }]}
            layout="horizontal"
          />
        </OpsChartCard>
        <OpsChartCard
          title={t("chart.bottomTgt", { n })}
          onExport={() =>
            downloadCsv(
              "ops-bottom-tgt",
              toCsv(
                ["name", "id", "value", "store", "zone"],
                byTgt.bottom.map((r) => [r.name, r.display_id, r.tgt_eff, r.store_label, r.zone]),
              ),
            )
          }
        >
          <OpsBarChart
            data={chartData(byTgt.bottom, "tgt_eff")}
            xKey="key"
            series={[{ key: "value", name: t("col.tgtEff"), color: "#dc2626" }]}
            layout="horizontal"
          />
        </OpsChartCard>
        <OpsChartCard
          title={t("chart.topDpd", { n })}
          onExport={() =>
            downloadCsv(
              "ops-top-dpd",
              toCsv(
                ["name", "id", "value"],
                byDpd.top.map((r) => [r.name, r.display_id, r.dpd]),
              ),
            )
          }
        >
          <OpsBarChart
            data={chartData(byDpd.top, "dpd")}
            xKey="key"
            series={[{ key: "value", name: t("col.dpd"), color: "#2563eb" }]}
            layout="horizontal"
          />
        </OpsChartCard>
        <OpsChartCard
          title={t("chart.bottomDpd", { n })}
          onExport={() =>
            downloadCsv(
              "ops-bottom-dpd",
              toCsv(
                ["name", "id", "value"],
                byDpd.bottom.map((r) => [r.name, r.display_id, r.dpd]),
              ),
            )
          }
        >
          <OpsBarChart
            data={chartData(byDpd.bottom, "dpd")}
            xKey="key"
            series={[{ key: "value", name: t("col.dpd"), color: "#d97706" }]}
            layout="horizontal"
          />
        </OpsChartCard>
      </div>
      <p className="text-[10px] text-muted-foreground">{t("topBottomTooltip")}</p>
    </div>
  );
}
