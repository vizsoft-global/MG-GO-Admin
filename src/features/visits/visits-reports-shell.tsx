"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Download, Loader2, RefreshCw } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { AppEmptyState, AppListCard, AppPage, AppPageHeader } from "@/components/app";
import {
  AppDataTable,
  AppDataTableRow,
  TableCell,
} from "@/components/app/app-data-table";
import {
  DATE_RANGE_ALL,
  DateRangeFilter,
  type DateRangeValue,
} from "@/components/app/date-range-filter";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { queryKeys } from "@/lib/query/query-keys";
import { cn } from "@/lib/utils";
import { fetchAdminVisitsList, fetchVisitBranches, type VisitListRow } from "./visits-actions";
import { VisitsTabBar } from "./visits-tab-bar";

function isoDate(d: string | null): string {
  return d ? d.slice(0, 10) : "";
}

function toCsv(rows: { label: string; visits: number; completed: number; noShows: number }[]): string {
  const header = ["Department", "Visits", "Completed", "No-shows", "Completion rate"];
  const lines = rows.map((r) =>
    [
      r.label,
      r.visits,
      r.completed,
      r.noShows,
      r.visits > 0 ? `${Math.round((r.completed / r.visits) * 100)}%` : "0%",
    ]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(","),
  );
  return [header.join(","), ...lines].join("\n");
}

function weeklyBuckets(rows: VisitListRow[]): { label: string; count: number }[] {
  if (rows.length === 0) return [];
  const dates = rows.map((r) => new Date(r.scheduled_date).getTime()).filter(Number.isFinite);
  if (dates.length === 0) return [];
  const maxTime = Math.max(...dates);
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const bucketCount = 12;
  const start = maxTime - (bucketCount - 1) * weekMs;
  const buckets = Array.from({ length: bucketCount }, (_, i) => ({
    label: `W${i + 1}`,
    count: 0,
  }));
  for (const row of rows) {
    const t = new Date(row.scheduled_date).getTime();
    if (!Number.isFinite(t) || t < start) continue;
    const idx = Math.min(bucketCount - 1, Math.floor((t - start) / weekMs));
    buckets[idx].count += 1;
  }
  return buckets;
}

export function VisitsReportsShell() {
  const t = useTranslations("pages.visitBookings");
  const [dateRange, setDateRange] = useState<DateRangeValue>(DATE_RANGE_ALL);
  const [branchFilter, setBranchFilter] = useState("all");

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: queryKeys.visits.list({ reports: true, dateRange }),
    queryFn: () =>
      fetchAdminVisitsList({
        dateFrom: isoDate(dateRange.from),
        dateTo: isoDate(dateRange.to),
        limit: 1000,
      }),
  });

  const { data: branchesData } = useQuery({
    queryKey: queryKeys.visits.branches(),
    queryFn: fetchVisitBranches,
  });

  const rows = useMemo(() => {
    const all = data?.rows ?? [];
    if (branchFilter === "all") return all;
    return all.filter((r) => r.branch_id === branchFilter);
  }, [data?.rows, branchFilter]);

  const summary = useMemo(() => {
    const total = rows.length;
    const completed = rows.filter((r) => r.status === "completed").length;
    const noShows = rows.filter((r) => r.status === "no_show").length;
    return {
      total,
      completed,
      noShows,
      noShowRate: total > 0 ? Math.round((noShows / total) * 100) : 0,
      completionRate: total > 0 ? Math.round((completed / total) * 100) : 0,
    };
  }, [rows]);

  const byDepartment = useMemo(() => {
    const map = new Map<string, { label: string; visits: number; completed: number; noShows: number }>();
    for (const row of rows) {
      const entry = map.get(row.department_key) ?? {
        label: row.department_label,
        visits: 0,
        completed: 0,
        noShows: 0,
      };
      entry.visits += 1;
      if (row.status === "completed") entry.completed += 1;
      if (row.status === "no_show") entry.noShows += 1;
      map.set(row.department_key, entry);
    }
    return [...map.values()].sort((a, b) => b.visits - a.visits);
  }, [rows]);

  const weekly = useMemo(() => weeklyBuckets(rows), [rows]);
  const maxWeekly = Math.max(1, ...weekly.map((w) => w.count));

  const exportCsv = () => {
    const csv = toCsv(byDepartment);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `visit-reports-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <AppPage>
      <AppPageHeader
        breadcrumbs={[
          { label: t("title"), href: "/visit-bookings" },
          { label: t("reports.title") },
        ]}
        title={t("reports.title")}
        description={t("reports.newSubtitle")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <DateRangeFilter value={dateRange} onChange={setDateRange} />
            <Select value={branchFilter} onValueChange={(v) => v && setBranchFilter(v)}>
              <SelectTrigger className="h-9 w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" label={t("allVisits.filterAllBranches")}>
                  {t("allVisits.filterAllBranches")}
                </SelectItem>
                {(branchesData?.rows ?? []).map((b) => (
                  <SelectItem key={b.id} value={b.id} label={b.name}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="button" variant="outline" size="sm" className="h-9" onClick={exportCsv}>
              <Download className="me-1.5 h-3.5 w-3.5" />
              {t("allVisits.export")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9"
              disabled={isFetching}
              onClick={() => void refetch()}
            >
              <RefreshCw
                className={cn("me-1.5 h-3.5 w-3.5", isFetching && "animate-spin")}
              />
              {t("refresh")}
            </Button>
          </div>
        }
      />

      <VisitsTabBar />

      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t("reports.total")}
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-foreground">
            {summary.total}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t("reports.noShowRate")}
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-danger">
            {summary.noShowRate}%
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t("reports.completionRateCard")}
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-success">
            {summary.completionRate}%
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : summary.total === 0 ? (
        <AppEmptyState
          title={t("reports.emptyTitle")}
          description={t("reports.emptyDescription")}
        />
      ) : (
        <>
          <AppListCard className="p-4">
            <h3 className="text-sm font-semibold">{t("reports.visitsOverTime")}</h3>
            <div className="mt-4 flex h-32 items-end gap-2">
              {weekly.map((bucket, idx) => (
                <div key={idx} className="flex flex-1 flex-col items-center gap-1">
                  <div
                    className={cn(
                      "w-full rounded-t-sm",
                      idx === weekly.length - 1 ? "bg-foreground" : "bg-muted",
                    )}
                    style={{ height: `${Math.max(4, (bucket.count / maxWeekly) * 100)}%` }}
                  />
                  <span className="text-[9px] text-muted-foreground">{bucket.label}</span>
                </div>
              ))}
            </div>
          </AppListCard>

          <AppListCard className="p-0">
            <h3 className="border-b border-border p-3 text-sm font-semibold">
              {t("reports.byDepartment")}
            </h3>
            <AppDataTable
              columns={[
                { id: "dept", label: t("colDepartment") },
                { id: "visits", label: t("reports.colVisits") },
                { id: "completed", label: t("reports.colCompleted") },
                { id: "noShows", label: t("reports.colNoShows") },
                { id: "rate", label: t("reports.colCompletionRate") },
              ]}
            >
              {byDepartment.map((dept) => (
                <AppDataTableRow key={dept.label}>
                  <TableCell className="text-sm font-medium">{dept.label}</TableCell>
                  <TableCell className="tabular-nums">{dept.visits}</TableCell>
                  <TableCell className="tabular-nums">{dept.completed}</TableCell>
                  <TableCell className="tabular-nums">{dept.noShows}</TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {dept.visits > 0 ? `${Math.round((dept.completed / dept.visits) * 100)}%` : "0%"}
                  </TableCell>
                </AppDataTableRow>
              ))}
            </AppDataTable>
          </AppListCard>
        </>
      )}
    </AppPage>
  );
}
