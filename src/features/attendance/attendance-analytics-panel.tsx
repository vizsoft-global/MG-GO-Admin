"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { AppEmptyState } from "@/components/app/app-empty-state";
import {
  AppDataTable,
  AppDataTableRow,
  TableCell,
} from "@/components/app/app-data-table";
import {
  TableToolbar,
  useTablePrefs,
  type TableToolbarColumn,
} from "@/components/app/table-toolbar";
import { CardContent } from "@/components/ui/card";
import { useAttendanceAnalytics } from "./use-attendance-table";
import { attendanceWindowTooLarge } from "./attendance-query-error";

export function AttendanceAnalyticsPanel({
  fromDate,
  toDate,
}: {
  fromDate: string;
  toDate: string;
}) {
  const t = useTranslations("pages.attendance");
  const { data, isLoading, isError, error } = useAttendanceAnalytics(fromDate, toDate);
  const columns = useMemo<TableToolbarColumn[]>(
    () => [
      { id: "date", label: t("colDate"), locked: true },
      { id: "checkedIn", label: t("kpiCheckedIn") },
      { id: "late", label: t("kpiLate") },
      { id: "absent", label: t("kpiAbsent") },
      { id: "compliance", label: t("kpiCompliance") },
    ],
    [t],
  );
  const prefs = useTablePrefs("attendance-analytics", columns);
  const filtered = useMemo(() => {
    const query = prefs.appliedQuery.trim().toLowerCase();
    const daily = data?.daily ?? [];
    if (!query) return daily;
    return daily.filter((row) => row.date.toLowerCase().includes(query));
  }, [data?.daily, prefs.appliedQuery]);
  const shown = prefs.orderedColumns.filter((column) => prefs.isVisible(column.id));

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

  if (attendanceWindowTooLarge(error)) {
    return (
      <AppEmptyState title={t("windowTooLarge")} description={t("windowTooLargeHint")} />
    );
  }

  if (isError) {
    return <AppEmptyState title={t("loadFailed")} description={t("emptyFiltersHint")} />;
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

      <AppDataTable
        toolbar={
          <TableToolbar
            prefs={prefs}
            entity={t("colDate")}
            columns={columns}
            rowKind="aggregate"
            filteredCount={filtered.length}
            totalCount={data.daily.length}
          />
        }
        columns={shown.map((column) => ({ id: column.id, label: column.label }))}
      >
        {filtered.map((row) => (
          <AppDataTableRow key={row.date}>
            {shown.map((column) => {
              switch (column.id) {
                case "date":
                  return <TableCell key={column.id}>{row.date}</TableCell>;
                case "checkedIn":
                  return (
                    <TableCell key={column.id} className="tabular-nums">
                      {row.checked_in}
                    </TableCell>
                  );
                case "late":
                  return (
                    <TableCell key={column.id} className="tabular-nums">
                      {row.late}
                    </TableCell>
                  );
                case "absent":
                  return (
                    <TableCell key={column.id} className="tabular-nums">
                      {row.absent}
                    </TableCell>
                  );
                case "compliance":
                  return (
                    <TableCell key={column.id} className="tabular-nums">
                      {row.avg_compliance}%
                    </TableCell>
                  );
                default:
                  return null;
              }
            })}
          </AppDataTableRow>
        ))}
      </AppDataTable>
    </CardContent>
  );
}
