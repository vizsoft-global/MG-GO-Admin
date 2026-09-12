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
import { EFFICIENCY_BUCKETS } from "../performance-ops-formulas";
import { downloadCsv, toCsv } from "../performance-ops-table";
import {
  enrichOpsRider,
  formatDpd,
  formatInt,
  formatPct,
} from "../performance-ops-format";
import type { OpsSnapshot } from "../performance-ops-types";
import { OpsBarChart, OpsChartCard } from "./ops-charts";
import { cn } from "@/lib/utils";

export function OpsDpdTab({ data }: { data: OpsSnapshot }) {
  const t = useTranslations("pages.performance.ops");
  const riders = useMemo(() => data.riders.map(enrichOpsRider), [data.riders]);

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

  function exportBucket(bucket: (typeof EFFICIENCY_BUCKETS)[number]) {
    const rows = riders.filter((r) => r.bucket === bucket);
    downloadCsv(
      `ops-bucket-${bucket}`,
      toCsv(
        ["name", "id", "store", "zone", "vehicle", "dpd", "tgt_eff", "dpd_eff"],
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
          { label: t("kpi.overallDpd"), value: formatDpd(data.kpis.overall_dpd), accent: "primary" },
          { label: t("kpi.avgDpdEff"), value: formatPct(data.kpis.avg_dpd_eff) },
          { label: t("kpi.avgTgtEff"), value: formatPct(data.kpis.avg_tgt_eff), accent: "success" },
          { label: t("kpi.targetDpd"), value: formatDpd(data.target_dpd) },
        ]}
      />
      <OpsChartCard
        title={t("chart.distribution")}
        onExport={() => {
          downloadCsv(
            "ops-distribution-riders",
            toCsv(
              ["bucket", "name", "id", "store", "zone", "dpd", "tgt_eff"],
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
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <h3 className="mb-2 text-sm font-semibold">{t("storesTitle")}</h3>
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
