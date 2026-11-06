"use client";

import { useTranslations } from "next-intl";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  projectConfigOf,
  type PayrollProjectClient,
  type PayrollProjectView,
  type ProjectKpis,
} from "./payroll-projects";

/**
 * The client cards above the Attendance & Orders table.
 *
 * The card is the client selector — the old Project Name filter is retired,
 * because a filter that can show two clients at once is exactly what this tab
 * must never do. Choosing a card re-scopes the filters, the chips, the KPIs, the
 * table, the manual-changes record and the export to that client alone.
 */
export function PayrollProjectCards({
  view,
  views,
  counts,
  onSelect,
}: {
  view: PayrollProjectView;
  views: readonly PayrollProjectClient[];
  counts: Record<PayrollProjectView, number>;
  onSelect: (next: PayrollProjectView) => void;
}) {
  const t = useTranslations("pages.payroll.projects");
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {views.map((client) => {
        const config = projectConfigOf(client.key, views);
        const active = client.key === view;
        return (
          <button
            key={client.key}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect(client.key)}
            className={cn(
              "flex items-start justify-between gap-2 rounded-xl border px-3 py-2 text-start transition-colors",
              active
                ? "border-primary bg-primary text-primary-foreground shadow-sm"
                : "border-border bg-card hover:bg-muted/50",
            )}
          >
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 text-sm font-semibold">
                {config.label ?? t(config.labelKey)}
                {active ? <Check className="size-3.5" /> : null}
              </span>
              <span
                className={cn(
                  "block truncate text-[11px]",
                  active ? "text-primary-foreground/80" : "text-muted-foreground",
                )}
              >
                {t(config.subtitleKey)}
              </span>
            </span>
            <span className="shrink-0 text-xl font-bold tabular-nums">
              {counts[client.key] ?? 0}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** The four cards, client-aware: orders for Americana, hours for the other two. */
export function PayrollProjectKpis({
  view,
  views,
  kpis,
}: {
  view: PayrollProjectView;
  views: readonly PayrollProjectClient[];
  kpis: ProjectKpis;
}) {
  const t = useTranslations("pages.payroll.ao");
  const config = projectConfigOf(view, views);
  const tiles = config.usesUploadedHours
    ? [
        { label: t("kpiRiders"), value: String(kpis.riders) },
        { label: t("kpiActive"), value: String(kpis.activeRiders) },
        { label: t("kpiHours"), value: kpis.totalHours.toFixed(1) },
        { label: t("kpiAvgHours"), value: kpis.avgPerWorkedDay.toFixed(1) },
      ]
    : [
        { label: t("kpiRiders"), value: String(kpis.riders) },
        { label: t("kpiActive"), value: String(kpis.activeRiders) },
        { label: t("kpiOrders"), value: String(kpis.totalOrders) },
        { label: t("kpiAvgOrders"), value: String(kpis.avgPerWorkedDay.toFixed(1)) },
      ];
  return (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
      {tiles.map((tile) => (
        <div
          key={tile.label}
          className="rounded-xl border border-border bg-card px-3 py-2 shadow-sm"
        >
          <span className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {tile.label}
          </span>
          <span className="text-xl font-bold tabular-nums">{tile.value}</span>
        </div>
      ))}
    </div>
  );
}
