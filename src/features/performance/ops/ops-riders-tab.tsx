"use client";

import { useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useTranslations } from "next-intl";
import { Filter } from "lucide-react";
import { KpiGrid } from "@/components/dashboard/kpi-grid";
import { LAYOUT } from "@/components/app/layout-spacing";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  applyColumnFilters,
  columnFilterValues,
  downloadCsv,
  toCsv,
  type OpsColumnFilter,
} from "../performance-ops-table";
import {
  enrichOpsRider,
  formatDpd,
  formatInt,
  formatPct,
} from "../performance-ops-format";
import type { OpsRiderView, OpsSnapshot } from "../performance-ops-types";
import { cn } from "@/lib/utils";

const FILTER_KEYS = [
  "status",
  "partner_label",
  "store_label",
  "zone",
  "vehicle_label",
  "nationality_label",
  "source",
  "bucket",
] as const;

export function OpsRidersTab({ data }: { data: OpsSnapshot }) {
  const t = useTranslations("pages.performance.ops");
  const riders = useMemo(() => data.riders.map(enrichOpsRider), [data.riders]);
  const [filters, setFilters] = useState<OpsColumnFilter>({});
  const parentRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(
    () => applyColumnFilters(riders as unknown as Array<Record<string, unknown>>, filters) as unknown as OpsRiderView[],
    [riders, filters],
  );

  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 36,
    overscan: 12,
  });

  const cols: Array<{ id: keyof OpsRiderView | "display_id"; label: string; align?: "end" }> = [
    { id: "name", label: t("col.name") },
    { id: "display_id", label: t("col.id") },
    { id: "partner_label", label: t("col.partner") },
    { id: "store_label", label: t("col.store") },
    { id: "zone", label: t("col.zone") },
    { id: "vehicle_label", label: t("col.vehicle") },
    { id: "orders", label: t("col.orders"), align: "end" },
    { id: "working_days", label: t("col.days"), align: "end" },
    { id: "dpd", label: t("col.dpd"), align: "end" },
    { id: "tgt_eff", label: t("col.tgtEff"), align: "end" },
    { id: "dpd_eff", label: t("col.dpdEff"), align: "end" },
    { id: "status", label: t("col.status") },
  ];

  function cell(row: OpsRiderView, id: string): string {
    switch (id) {
      case "orders":
        return formatInt(row.orders);
      case "working_days":
        return formatInt(row.working_days);
      case "dpd":
        return formatDpd(row.dpd);
      case "tgt_eff":
        return formatPct(row.tgt_eff);
      case "dpd_eff":
        return formatPct(row.dpd_eff);
      case "zone":
        return row.zone ?? "—";
      default:
        return String((row as Record<string, unknown>)[id] ?? "—");
    }
  }

  return (
    <div className={cn("flex flex-col", LAYOUT.stackGap)}>
      <KpiGrid
        compact
        items={[
          { label: t("kpi.orders"), value: formatInt(data.kpis.orders) },
          { label: t("kpi.overallDpd"), value: formatDpd(data.kpis.overall_dpd), accent: "primary" },
          { label: t("kpi.avgTgtEff"), value: formatPct(data.kpis.avg_tgt_eff), accent: "success" },
          { label: t("kpi.active"), value: formatInt(data.kpis.active) },
        ]}
      />
      <p className="text-[10px] text-muted-foreground">{t("tableFiltersHint")}</p>
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="flex flex-wrap gap-1.5 border-b border-border px-3 py-2">
          {FILTER_KEYS.map((key) => {
            const values = columnFilterValues(riders as unknown as Array<Record<string, unknown>>, key);
            const selected = filters[key] ?? [];
            return (
              <Popover key={key}>
                <PopoverTrigger className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2 text-[11px] hover:bg-muted/40">
                  <Filter className="size-3" />
                  {t(`filterCol.${key}`)}
                  {selected.length ? ` (${selected.length})` : ""}
                </PopoverTrigger>
                <PopoverContent align="start" className="w-52 origin-(--transform-origin) p-2">
                  <button
                    type="button"
                    className="mb-1 text-[11px] text-primary"
                    onClick={() => setFilters((prev) => ({ ...prev, [key]: [] }))}
                  >
                    {t("slicer.all")}
                  </button>
                  <div className="max-h-48 overflow-y-auto">
                    {values.map((v) => {
                      const on = selected.length === 0 || selected.includes(v);
                      return (
                        <label
                          key={v || "(empty)"}
                          className="flex h-7 items-center gap-2 text-[11px]"
                        >
                          <Checkbox
                            checked={on}
                            onCheckedChange={() => {
                              setFilters((prev) => {
                                const cur = prev[key] ?? [];
                                if (cur.length === 0) {
                                  return { ...prev, [key]: values.filter((x) => x !== v) };
                                }
                                const next = cur.includes(v)
                                  ? cur.filter((x) => x !== v)
                                  : [...cur, v];
                                return { ...prev, [key]: next.length === values.length ? [] : next };
                              });
                            }}
                          />
                          <span className="truncate">{v || "—"}</span>
                        </label>
                      );
                    })}
                  </div>
                </PopoverContent>
              </Popover>
            );
          })}
          <button
            type="button"
            className="ms-auto h-8 text-[11px] text-primary"
            onClick={() =>
              downloadCsv(
                "ops-riders",
                toCsv(
                  cols.map((c) => c.label),
                  filtered.map((r) => cols.map((c) => cell(r, String(c.id)))),
                ),
              )
            }
          >
            {t("exportTab")}
          </button>
        </div>
        <div className="grid grid-cols-[minmax(120px,1.4fr)_repeat(11,minmax(64px,1fr))] gap-0 border-b border-border bg-muted/30 px-3 py-1.5 text-[11px] font-semibold text-accent">
          {cols.map((c) => (
            <span key={String(c.id)} className={c.align === "end" ? "text-end" : ""}>
              {c.label}
            </span>
          ))}
        </div>
        <div ref={parentRef} className="h-[min(420px,48dvh)] overflow-auto">
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((item) => {
              const row = filtered[item.index];
              return (
                <div
                  key={row.driver_id}
                  className="absolute inset-x-0 grid grid-cols-[minmax(120px,1.4fr)_repeat(11,minmax(64px,1fr))] items-center gap-0 border-b border-border/60 px-3 text-xs"
                  style={{ height: item.size, transform: `translateY(${item.start}px)` }}
                >
                  {cols.map((c) => (
                    <span
                      key={String(c.id)}
                      className={cn(
                        "truncate tabular-nums",
                        c.align === "end" && "text-end",
                        c.id === "name" && "font-medium",
                      )}
                    >
                      {cell(row, String(c.id))}
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
