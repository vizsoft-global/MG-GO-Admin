"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useTranslations } from "next-intl";
import { KpiGrid } from "@/components/dashboard/kpi-grid";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
import { LAYOUT } from "@/components/app/layout-spacing";
import { SOURCE_COMPANY_LABEL } from "../performance-ops-formulas";
import {
  applyColumnFilters,
  columnFilterValues,
  downloadCsv,
  nextOpsSort,
  sortOpsRiders,
  toCsv,
  type OpsColumnFilter,
  type OpsSortDir,
} from "../performance-ops-table";
import {
  enrichOpsRider,
  formatDpd,
  formatInt,
  formatPct,
} from "../performance-ops-format";
import type { OpsRiderView, OpsSnapshot } from "../performance-ops-types";
import { OpsHeaderFilter, OpsSortButton } from "./ops-header-filter";
import { cn } from "@/lib/utils";

const NUMERIC_COLS = new Set([
  "orders",
  "working_days",
  "dpd",
  "target_dpd",
  "store_dpd",
  "veh_zone_dpd",
  "dpd_eff",
  "tgt_eff",
]);

const COL_WIDTH: Record<string, string> = {
  display_id: "w-[88px] min-w-[88px]",
  name: "w-[140px] min-w-[140px]",
  partner_label: "w-[100px] min-w-[100px]",
  store_label: "w-[140px] min-w-[140px]",
  zone: "w-[110px] min-w-[110px]",
  vehicle_label: "w-[88px] min-w-[88px]",
  nationality_label: "w-[120px] min-w-[120px]",
  source_type: "w-[100px] min-w-[100px]",
  source_company: "w-[120px] min-w-[120px]",
  orders: "w-[88px] min-w-[88px]",
  working_days: "w-[110px] min-w-[110px]",
  dpd: "w-[80px] min-w-[80px]",
  target_dpd: "w-[96px] min-w-[96px]",
  store_dpd: "w-[120px] min-w-[120px]",
  veh_zone_dpd: "w-[140px] min-w-[140px]",
  dpd_eff: "w-[96px] min-w-[96px]",
  tgt_eff: "w-[110px] min-w-[110px]",
  status: "w-[88px] min-w-[88px]",
};

export function OpsRidersTab({
  data,
  resetKey,
}: {
  data: OpsSnapshot;
  resetKey: number;
}) {
  const t = useTranslations("pages.performance.ops");
  const riders = useMemo(() => data.riders.map(enrichOpsRider), [data.riders]);
  const [filters, setFilters] = useState<OpsColumnFilter>({});
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<OpsSortDir | null>(null);
  const parentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setFilters({});
    setSortKey(null);
    setSortDir(null);
  }, [resetKey]);

  const cols: Array<{ id: string; label: string; align?: "end" }> = [
    { id: "display_id", label: t("col.id") },
    { id: "name", label: t("col.name") },
    { id: "partner_label", label: t("col.partner") },
    { id: "store_label", label: t("col.store") },
    { id: "zone", label: t("col.zone") },
    { id: "vehicle_label", label: t("col.vehicle") },
    { id: "nationality_label", label: t("col.nationality") },
    { id: "source_type", label: t("col.sourceType") },
    { id: "source_company", label: t("col.companySource") },
    { id: "orders", label: t("col.orders"), align: "end" },
    { id: "working_days", label: t("col.days"), align: "end" },
    { id: "dpd", label: t("col.dpd"), align: "end" },
    { id: "target_dpd", label: t("col.targetDpd"), align: "end" },
    { id: "store_dpd", label: t("col.storeDpd"), align: "end" },
    { id: "veh_zone_dpd", label: t("col.vehZoneDpd"), align: "end" },
    { id: "dpd_eff", label: t("col.dpdEff"), align: "end" },
    { id: "tgt_eff", label: t("col.tgtEff"), align: "end" },
    { id: "status", label: t("col.status") },
  ];

  function cell(row: OpsRiderView, id: string): string {
    switch (id) {
      case "orders":
      case "working_days":
        return formatInt(row[id]);
      case "dpd":
      case "target_dpd":
      case "store_dpd":
      case "veh_zone_dpd":
        return formatDpd(row[id]);
      case "tgt_eff":
      case "dpd_eff":
        return formatPct(row[id]);
      case "zone":
        return row.zone ?? "—";
      case "source_type":
        return row.source_type === "in_house" || row.source_type === "outsourced"
          ? t(`sourceType.${row.source_type}`)
          : "—";
      case "source_company":
        return row.source_company && row.source_company in SOURCE_COMPANY_LABEL
          ? SOURCE_COMPANY_LABEL[row.source_company as keyof typeof SOURCE_COMPANY_LABEL]
          : (row.source_company ?? "—");
      default:
        return String((row as Record<string, unknown>)[id] ?? "—");
    }
  }

  const filtered = useMemo(() => {
    const rows = riders.map((r) => ({
      ...r,
      source_type: cell(r, "source_type"),
      source_company: cell(r, "source_company"),
      zone: r.zone ?? "—",
    }));
    const narrowed = applyColumnFilters(
      rows as unknown as Array<Record<string, unknown>>,
      filters,
    ) as unknown as OpsRiderView[];
    return sortOpsRiders(
      narrowed as unknown as Array<Record<string, unknown>>,
      sortKey,
      sortDir,
    ) as unknown as OpsRiderView[];
  }, [riders, filters, sortKey, sortDir, t]);

  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 36,
    overscan: 12,
  });

  return (
    <div className={cn("flex flex-col", LAYOUT.stackGap)}>
      <KpiGrid
        compact
        items={[
          { label: t("kpi.orders"), value: formatInt(data.kpis.orders) },
          { label: t("kpi.workingDays"), value: formatInt(data.kpis.working_days) },
          { label: t("kpi.overallDpd"), value: formatDpd(data.kpis.overall_dpd), accent: "primary" },
          { label: t("kpi.dpdEff"), value: formatPct(data.kpis.avg_dpd_eff) },
          { label: t("kpi.tgtEff"), value: formatPct(data.kpis.avg_tgt_eff), accent: "success" },
        ]}
      />
      <p className="text-[10px] text-muted-foreground">{t("tableFiltersHint")}</p>
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="flex items-center justify-end gap-2 border-b border-border px-3 py-2">
          <span className="text-[11px] text-muted-foreground">
            {t("showingRiders", { count: filtered.length })}
          </span>
          <button
            type="button"
            className="h-8 text-[11px] text-primary"
            onClick={() =>
              downloadCsv(
                "ops-riders",
                toCsv(
                  cols.map((c) => c.label),
                  filtered.map((r) => cols.map((c) => cell(r, c.id))),
                ),
              )
            }
          >
            {t("exportTab")}
          </button>
        </div>
        <div ref={parentRef} className="h-[min(420px,48dvh)] overflow-auto">
          <div
            className={cn(
              "sticky top-0 z-10 flex min-w-[1960px] border-b border-border bg-muted/30 px-3 py-1.5",
              TABLE_HEAD_CLASS,
            )}
          >
            {cols.map((c) => (
              <div
                key={c.id}
                className={cn(
                  "flex flex-col gap-0.5 px-1",
                  COL_WIDTH[c.id],
                  c.align === "end" && "items-end",
                )}
              >
                <span className="whitespace-normal leading-tight">{c.label}</span>
                <div className="flex items-center gap-0.5">
                  <OpsHeaderFilter
                    columnId={c.id}
                    values={columnFilterValues(
                      riders.map((r) => ({
                        ...r,
                        source_type: cell(r, "source_type"),
                        source_company: cell(r, "source_company"),
                        zone: r.zone ?? "—",
                      })) as unknown as Array<Record<string, unknown>>,
                      c.id,
                    )}
                    filters={filters}
                    onApply={setFilters}
                    numeric={NUMERIC_COLS.has(c.id)}
                    searchPlaceholder={t("filterSearch")}
                    allLabel={t("slicer.all")}
                    clearLabel={t("filterClear")}
                    applyLabel={t("filterApply")}
                    minLabel={t("filterMin")}
                    maxLabel={t("filterMax")}
                  />
                  <OpsSortButton
                    active={sortKey === c.id}
                    dir={sortKey === c.id ? sortDir : null}
                    label={t("sortColumn", { column: c.label })}
                    onClick={() => {
                      const next = nextOpsSort(sortKey, sortDir, c.id);
                      setSortKey(next.key);
                      setSortDir(next.dir);
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((item) => {
              const row = filtered[item.index];
              return (
                <div
                  key={row.driver_id}
                  className="absolute inset-x-0 flex min-w-[1960px] items-center border-b border-border/60 px-3 text-xs"
                  style={{ height: item.size, transform: `translateY(${item.start}px)` }}
                >
                  {cols.map((c) => (
                    <span
                      key={c.id}
                      className={cn(
                        "truncate px-1 tabular-nums",
                        COL_WIDTH[c.id],
                        c.align === "end" && "text-end",
                        c.id === "name" && "font-medium",
                      )}
                    >
                      {cell(row, c.id)}
                    </span>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
