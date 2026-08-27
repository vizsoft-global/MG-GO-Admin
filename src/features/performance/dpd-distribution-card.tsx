"use client";

import type { LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { AppEmptyState } from "@/components/app/app-empty-state";
import type { DpdLiveBreakdownRow } from "./performance-types";

/**
 * CSS bars rather than a chart library: this is a share-of-total read, and a
 * bar whose width is the share says it without shipping a renderer.
 */
export function DpdDistributionCard({
  title,
  icon: Icon,
  rows,
}: {
  title: string;
  icon: LucideIcon;
  rows: DpdLiveBreakdownRow[];
}) {
  const t = useTranslations("pages.performance.live");
  const max = rows.reduce((acc, r) => Math.max(acc, r.deliveries), 0);

  return (
    <div className="flex h-full min-h-0 flex-col rounded-xl border border-border bg-card shadow-sm">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Icon className="size-4 text-primary" />
          <h3 className="text-sm font-semibold">{title}</h3>
        </div>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {t("barLegend")}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
        {rows.length === 0 ? (
          <AppEmptyState
            title={t("breakdownEmpty")}
            description={t("breakdownEmptyHint")}
          />
        ) : (
          <ul className="space-y-2">
            {rows.map((row) => (
              <li key={row.id ?? "unassigned"} className="space-y-1">
                <div className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="min-w-0 truncate font-medium">
                    {row.label ?? t("unassigned")}
                  </span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {t("barValue", {
                      deliveries: row.deliveries,
                      riders: row.on_duty,
                    })}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary/70"
                    style={{
                      width: `${max > 0 ? Math.max((row.deliveries / max) * 100, row.deliveries > 0 ? 4 : 0) : 0}%`,
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
