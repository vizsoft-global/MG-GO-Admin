"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { AppEmptyState } from "@/components/app/app-empty-state";
import { CardContent } from "@/components/ui/card";
import { useAttendanceAnalytics } from "./use-attendance-table";

export function AttendanceAnalyticsPanel({
  fromDate,
  toDate,
}: {
  fromDate: string;
  toDate: string;
}) {
  const t = useTranslations("pages.attendance");
  const { data, isLoading } = useAttendanceAnalytics(fromDate, toDate);

  const summary = useMemo(() => {
    if (!data?.daily.length) return null;
    const totals = data.daily.reduce(
      (acc, d) => ({
        checked_in: acc.checked_in + d.checked_in,
        late: acc.late + d.late,
        absent: acc.absent + d.absent,
        compliance: acc.compliance + d.avg_compliance,
      }),
      { checked_in: 0, late: 0, absent: 0, compliance: 0 },
    );
    return {
      days: data.daily.length,
      avgCompliance: Math.round(totals.compliance / data.daily.length),
      totalLate: totals.late,
      totalAbsent: totals.absent,
    };
  }, [data]);

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data?.daily.length) {
    return (
      <AppEmptyState title={t("emptyAnalytics")} description={t("emptyAnalyticsHint")} />
    );
  }

  return (
    <CardContent className="space-y-6 p-0 pt-4">
      {summary ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-border bg-muted/20 p-4">
            <p className="text-xs text-muted-foreground">{t("analyticsDays")}</p>
            <p className="text-2xl font-semibold tabular-nums">{summary.days}</p>
          </div>
          <div className="rounded-lg border border-border bg-muted/20 p-4">
            <p className="text-xs text-muted-foreground">{t("kpiCompliance")}</p>
            <p className="text-2xl font-semibold tabular-nums">{summary.avgCompliance}%</p>
          </div>
          <div className="rounded-lg border border-border bg-muted/20 p-4">
            <p className="text-xs text-muted-foreground">{t("kpiLate")}</p>
            <p className="text-2xl font-semibold tabular-nums">{summary.totalLate}</p>
          </div>
          <div className="rounded-lg border border-border bg-muted/20 p-4">
            <p className="text-xs text-muted-foreground">{t("kpiAbsent")}</p>
            <p className="text-2xl font-semibold tabular-nums">{summary.totalAbsent}</p>
          </div>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30 text-start">
              <th className="px-3 py-2 font-medium">{t("colDate")}</th>
              <th className="px-3 py-2 font-medium">{t("kpiCheckedIn")}</th>
              <th className="px-3 py-2 font-medium">{t("kpiLate")}</th>
              <th className="px-3 py-2 font-medium">{t("kpiAbsent")}</th>
              <th className="px-3 py-2 font-medium">{t("kpiCompliance")}</th>
            </tr>
          </thead>
          <tbody>
            {data.daily.map((row) => (
              <tr key={row.date} className="border-b border-border last:border-0">
                <td className="px-3 py-2">{row.date}</td>
                <td className="px-3 py-2 tabular-nums">{row.checked_in}</td>
                <td className="px-3 py-2 tabular-nums">{row.late}</td>
                <td className="px-3 py-2 tabular-nums">{row.absent}</td>
                <td className="px-3 py-2 tabular-nums">{row.avg_compliance}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </CardContent>
  );
}
