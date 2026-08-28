"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { AppEmptyState } from "@/components/app";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
import { Input } from "@/components/ui/input";
import { StatusPill } from "@/components/dashboard/status-pill";
import { componentPct } from "@/features/performance/performance-formulas";
import { useDriverPerformanceDaily } from "@/features/performance/use-performance";
import { queryKeys } from "@/lib/query/query-keys";
import { resolveStatusVariant } from "@/lib/ui/resolve-status-variant";
import { cn } from "@/lib/utils";
import { fetchDriverAttendanceTimeline } from "./attendance-reporting-actions";
import {
  LIVE_STATUS_LABEL_KEYS,
  addDays,
  formatDateTimeKuwait,
  formatDurationSeconds,
} from "./attendance-list-utils";
import {
  useDriverAttendanceDetail,
  useDriverAttendanceRange,
} from "./use-attendance-table";

/**
 * The compliance number on this page is a weighted blend, so it needs to be
 * openable here rather than only on /performance — the day an operator is asking
 * about is the day they are looking at.
 *
 * Read from driver_performance_daily through the RPC, never re-derived from
 * attendance_logs and fleet_events: a second implementation of the component
 * rules would disagree with the first the moment either changed.
 */
function AttendanceComplianceBreakdown({
  driverId,
  from,
  to,
}: {
  driverId: string;
  from: string;
  to: string;
}) {
  const t = useTranslations("pages.attendance");
  const locale = useLocale();
  const { data, isLoading } = useDriverPerformanceDaily(driverId, from, to);

  const components = data?.components ?? [];
  const rows = data?.rows ?? [];

  if (isLoading) {
    return (
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (components.length === 0 || rows.length === 0) return null;

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <h3 className="mb-2 text-sm font-semibold">
        {t("complianceBreakdownTitle")}
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border">
              <th className={cn(TABLE_HEAD_CLASS, "px-2 py-1.5 text-start")}>
                {t("colDate")}
              </th>
              <th className={cn(TABLE_HEAD_CLASS, "px-2 py-1.5 text-end")}>
                {t("kpiCompliance")}
              </th>
              {components.map((c) => (
                <th
                  key={c.key}
                  className={cn(TABLE_HEAD_CLASS, "px-2 py-1.5 text-end")}
                >
                  {locale.startsWith("ar") ? c.label_ar : c.label_en}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.log_date} className="border-b border-border/60">
                <td className="px-2 py-1.5 tabular-nums">{row.log_date}</td>
                <td className="px-2 py-1.5 text-end font-semibold tabular-nums">
                  {row.compliance_score == null
                    ? "—"
                    : `${Math.round(row.compliance_score)}%`}
                </td>
                {components.map((c) => {
                  const value = componentPct(row.component_scores, c.key);
                  return (
                    <td
                      key={c.key}
                      className={cn(
                        "px-2 py-1.5 text-end tabular-nums",
                        value == null ? "text-muted-foreground" : undefined,
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
      <p className="mt-2 text-[10px] text-muted-foreground">
        {t("complianceBreakdownHint")}
      </p>
    </div>
  );
}

export function AttendanceDriverExplorePanel({
  driverId,
  date,
  onDateChange,
  className,
}: {
  driverId: string;
  date: string;
  onDateChange: (next: string) => void;
  className?: string;
}) {
  const t = useTranslations("pages.attendance");
  const fromDate = addDays(date, -6);

  const { data: dayRow, isLoading: dayLoading } = useDriverAttendanceDetail(
    driverId,
    date,
  );
  const { data: weekRows, isLoading: weekLoading } = useDriverAttendanceRange(
    driverId,
    fromDate,
    date,
  );

  const { data: timeline, isLoading: timelineLoading } = useQuery({
    queryKey: [...queryKeys.attendance.driverDetail(driverId, date, date), "timeline"],
    queryFn: () => fetchDriverAttendanceTimeline(driverId, date),
    enabled: Boolean(driverId),
  });

  const weekStats = useMemo(() => {
    if (!weekRows?.length) return { present: 0, late: 0, avgCompliance: 0 };
    const present = weekRows.filter((r) => r.check_in_at).length;
    const late = weekRows.filter((r) => r.minutes_late > 0).length;
    const scores = weekRows
      .map((r) => r.compliance_score)
      .filter((s): s is number => s != null);
    const avgCompliance =
      scores.length > 0
        ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
        : 0;
    return { present, late, avgCompliance };
  }, [weekRows]);

  const isLoading = dayLoading || weekLoading;

  if (isLoading) {
    return (
      <div className={cn("flex justify-center py-8", className)}>
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!dayRow) {
    return (
      <div className={className}>
        <AppEmptyState
          title={t("emptyDriverDay")}
          description={t("emptyDriverDayHint")}
        />
      </div>
    );
  }

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill variant={resolveStatusVariant(dayRow.live_status)}>
          {t(LIVE_STATUS_LABEL_KEYS[dayRow.live_status] ?? "livePresent")}
        </StatusPill>
        <Input
          type="date"
          value={date}
          onChange={(e) => {
            const next = e.target.value;
            if (next) onDateChange(next);
          }}
          className="h-9 w-[160px]"
          aria-label={t("colDate")}
        />
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <p className="text-[10px] text-muted-foreground">{t("weekPresent")}</p>
          <p className="text-lg font-semibold tabular-nums">{weekStats.present}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <p className="text-[10px] text-muted-foreground">{t("kpiLate")}</p>
          <p className="text-lg font-semibold tabular-nums">{weekStats.late}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <p className="text-[10px] text-muted-foreground">{t("kpiCompliance")}</p>
          <p className="text-lg font-semibold tabular-nums">
            {weekStats.avgCompliance}%
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <p className="text-[10px] text-muted-foreground">{t("colDuty")}</p>
          <p className="text-lg font-semibold tabular-nums">
            {formatDurationSeconds(dayRow.duty_seconds)}
          </p>
        </div>
      </div>

      <AttendanceComplianceBreakdown
        driverId={driverId}
        from={fromDate}
        to={date}
      />

      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <h3 className="mb-2 text-sm font-semibold">{t("timelineTitle")}</h3>
        {timelineLoading ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : !timeline?.length ? (
          <p className="text-sm text-muted-foreground">{t("emptyTimeline")}</p>
        ) : (
          <ul className="max-h-48 space-y-2 overflow-y-auto">
            {timeline.map((ev) => (
              <li
                key={`${ev.at}-${ev.kind}`}
                className="flex items-center justify-between gap-4 text-sm"
              >
                <span>{ev.label}</span>
                <span className="text-muted-foreground tabular-nums">
                  {formatDateTimeKuwait(ev.at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
