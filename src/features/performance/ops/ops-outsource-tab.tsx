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
import { downloadCsv, toCsv } from "../performance-ops-table";
import {
  companyLabel,
  enrichOpsRider,
  formatDpd,
  formatInt,
  formatPct,
} from "../performance-ops-format";
import type { OpsSnapshot } from "../performance-ops-types";
import { OpsBarChart, OpsChartCard } from "./ops-charts";
import { cn } from "@/lib/utils";

export function OpsOutsourceTab({ data }: { data: OpsSnapshot }) {
  const t = useTranslations("pages.performance.ops");
  const riders = useMemo(() => data.riders.map(enrichOpsRider), [data.riders]);

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
          { label: t("kpi.avgTgtEff"), value: formatPct(data.kpis.avg_tgt_eff), accent: "success" },
          { label: t("kpi.active"), value: formatInt(data.kpis.active) },
          { label: t("kpi.riders"), value: formatInt(data.kpis.riders) },
        ]}
      />
      <OpsChartCard
        title={t("chart.company")}
        onExport={() =>
          downloadCsv(
            "ops-outsource-companies",
            toCsv(
              ["company", "orders", "dpd", "riders"],
              data.by_company.map((r) => [companyLabel(r.key), r.orders, r.dpd, r.riders]),
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
            dpd: r.dpd,
          }))}
          xKey="key"
          series={[{ key: "orders", name: t("kpi.orders"), color: "#7c3aed" }]}
        />
      </OpsChartCard>
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
            { id: "dpd", label: t("col.dpd"), className: "text-end" },
            { id: "tgt", label: t("col.tgtEff"), className: "text-end" },
            { id: "riders", label: t("col.riders"), className: "text-end" },
          ]}
        >
          {data.by_company.map((r) => (
            <AppDataTableRow key={r.key}>
              <TableCell className="text-sm">{companyLabel(r.key)}</TableCell>
              <TableCell className="text-end tabular-nums text-sm">
                {formatInt(r.orders)}
              </TableCell>
              <TableCell className="text-end tabular-nums text-sm">
                {formatDpd(r.dpd)}
              </TableCell>
              <TableCell className="text-end tabular-nums text-sm">
                {formatPct(r.tgt_eff)}
              </TableCell>
              <TableCell className="text-end tabular-nums text-sm">
                {formatInt(r.active_riders ?? r.riders)}
              </TableCell>
            </AppDataTableRow>
          ))}
        </AppDataTable>
      </div>
    </div>
  );
}
