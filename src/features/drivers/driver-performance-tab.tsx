"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Award, Loader2, Trophy } from "lucide-react";
import { AppEmptyState } from "@/components/app";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
import { Button } from "@/components/ui/button";
import { PerformanceComponentBreakdown } from "@/features/performance/performance-component-breakdown";
import { PerformanceRatingPanel } from "@/features/performance/performance-rating-panel";
import {
  componentPct,
  kuwaitToday,
  performanceRange,
  ratingPeriodMonth,
  PERFORMANCE_RANGE_PRESETS,
  type PerformanceRangePreset,
} from "@/features/performance/performance-formulas";
import {
  useDriverPerformanceDaily,
  useDriverPerformanceList,
  useDriverPerformanceRank,
} from "@/features/performance/use-performance";
import type { PerformanceScoreBand } from "@/features/performance/performance-types";
import { cn } from "@/lib/utils";

const BAND_CHIP_CLASS: Record<PerformanceScoreBand, string> = {
  top: "border-emerald-200 bg-emerald-50 text-emerald-800",
  good: "border-border bg-muted/40 text-foreground",
  watch: "border-amber-200 bg-amber-50 text-amber-800",
  critical: "border-destructive/30 bg-destructive/10 text-destructive",
};

function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
      {hint ? (
        <p className="text-[10px] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

/**
 * The whole performance picture for one driver, on the page an operator already
 * opens to talk about them.
 *
 * Everything here comes from the same two RPCs `/performance` uses — the ranked
 * list filtered to this driver, and the per-day breakdown. Re-deriving a rank or
 * a band locally would produce a second answer to a question that already has
 * one, and the two would part ways the first time a weight moved.
 */
export function DriverPerformanceTab({
  driverId,
  driverName,
}: {
  driverId: string;
  driverName: string;
}) {
  const t = useTranslations("pages.performance");
  const tDriver = useTranslations("pages.driverDetail");
  const locale = useLocale();
  const today = useMemo(() => kuwaitToday(), []);
  const [preset, setPreset] = useState<PerformanceRangePreset>("last30");
  const range = useMemo(
    () => performanceRange(preset, today),
    [preset, today],
  );

  const { data: list, isLoading: listLoading } = useDriverPerformanceList({
    driverId,
    fromDate: range.from,
    toDate: range.to,
    page: 0,
    pageSize: 1,
  });
  const { data: daily, isLoading: dailyLoading } = useDriverPerformanceDaily(
    driverId,
    range.from,
    range.to,
  );
  const { data: standing } = useDriverPerformanceRank(
    driverId,
    range.from,
    range.to,
  );

  const row = list?.rows[0] ?? null;
  const components = list?.components ?? daily?.components ?? [];
  const dailyRows = daily?.rows ?? [];

  if (listLoading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {PERFORMANCE_RANGE_PRESETS.map((option) => (
          <Button
            key={option}
            type="button"
            size="sm"
            variant={preset === option ? "default" : "outline"}
            className="h-8"
            onClick={() => setPreset(option)}
          >
            {t(`report.presets.${option}`)}
          </Button>
        ))}
        <span className="text-[10px] tabular-nums text-muted-foreground">
          {range.from} → {range.to}
        </span>
      </div>

      {!row ? (
        <AppEmptyState
          title={tDriver("performanceEmptyTitle")}
          description={tDriver("performanceEmptyDescription")}
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
              <p className="text-[10px] text-muted-foreground">
                {t("kpiOverall")}
              </p>
              <div className="flex items-center gap-2">
                <p className="text-lg font-semibold tabular-nums">
                  {row.overall_score}
                </p>
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-semibold",
                    BAND_CHIP_CLASS[row.score_band],
                  )}
                >
                  <Award className="size-3" />
                  {t(`bands.${row.score_band}`)}
                </span>
              </div>
            </div>
            <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
              <p className="text-[10px] text-muted-foreground">
                {t("colRank")}
              </p>
              <p className="flex items-center gap-1 text-lg font-semibold tabular-nums">
                <Trophy className="size-3.5 text-amber-500" />
                {standing?.rank ?? "—"}
              </p>
              <p className="text-[10px] text-muted-foreground">
                {standing?.rank == null
                  ? tDriver("performanceRankUnavailable")
                  : tDriver("performanceRankHint", {
                      total: standing.total,
                    })}
              </p>
            </div>
            <Metric
              label={t("colDeliveryPct")}
              value={`${Math.round(row.delivery_efficiency * 100)}%`}
              hint={tDriver("performanceDeliveriesHint", {
                actual: row.actual_deliveries,
                target: row.target_deliveries,
              })}
            />
            <Metric
              label={t("kpiCompliance")}
              value={
                row.compliance_score == null
                  ? "—"
                  : `${Math.round(row.compliance_score)}%`
              }
              hint={tDriver("performanceExceptionsHint", {
                count: row.penalised_exception_count,
              })}
            />
          </div>

          <div className="grid gap-2 lg:grid-cols-2 lg:items-stretch">
            <PerformanceComponentBreakdown
              className="h-full bg-card shadow-sm"
              scores={row.component_scores}
              components={components}
              compliance={row.compliance_score}
            />
            <div className="h-full">
              <PerformanceRatingPanel
                driverId={driverId}
                periodMonth={ratingPeriodMonth(range.to)}
                rangeScore={row.manual_score}
                rangeTeamCount={row.manual_rating_count}
              />
            </div>
          </div>
        </>
      )}

      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <p className="mb-2 text-sm font-semibold">
          {tDriver("performanceTrendTitle", { name: driverName })}
        </p>
        {dailyLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : dailyRows.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {tDriver("performanceTrendEmpty")}
          </p>
        ) : (
          <div className="max-h-[320px] overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-card">
                <tr className="border-b border-border">
                  <th className={cn(TABLE_HEAD_CLASS, "px-2 py-1.5 text-start")}>
                    {tDriver("performanceColDate")}
                  </th>
                  <th className={cn(TABLE_HEAD_CLASS, "px-2 py-1.5 text-end")}>
                    {t("kpiCompliance")}
                  </th>
                  {components.map((component) => (
                    <th
                      key={component.key}
                      className={cn(TABLE_HEAD_CLASS, "px-2 py-1.5 text-end")}
                    >
                      {locale.startsWith("ar")
                        ? component.label_ar
                        : component.label_en}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dailyRows.map((day) => (
                  <tr key={day.log_date} className="border-b border-border/60">
                    <td className="px-2 py-1.5 tabular-nums">{day.log_date}</td>
                    <td className="px-2 py-1.5 text-end font-semibold tabular-nums">
                      {day.compliance_score == null
                        ? "—"
                        : `${Math.round(day.compliance_score)}%`}
                    </td>
                    {components.map((component) => {
                      const value = componentPct(
                        day.component_scores,
                        component.key,
                      );
                      return (
                        <td
                          key={component.key}
                          className={cn(
                            "px-2 py-1.5 text-end tabular-nums",
                            value == null
                              ? "text-muted-foreground"
                              : undefined,
                          )}
                        >
                          {value == null ? "—" : `${Math.round(value)}%`}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
