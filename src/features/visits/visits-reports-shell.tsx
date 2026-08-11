"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Activity,
  CheckCircle2,
  Download,
  FileText,
  Loader2,
  RefreshCw,
} from "lucide-react";
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
import { departmentBadgeClass } from "./visit-status-utils";

const SLOT_BAR_CLASSES = ["bg-blue-500", "bg-orange-500", "bg-emerald-500"];

function isoDate(d: string | null): string {
  return d ? d.slice(0, 10) : "";
}

function ReportKpi({
  icon,
  iconClass,
  label,
  value,
  valueClass,
  hint,
}: {
  icon: React.ReactNode;
  iconClass: string;
  label: string;
  value: string | number;
  valueClass?: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "flex h-6 w-6 items-center justify-center rounded-md",
            iconClass,
          )}
        >
          {icon}
        </span>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
      </div>
      <p
        className={cn(
          "mt-1 text-2xl font-semibold tabular-nums tracking-tight text-foreground",
          valueClass,
        )}
      >
        {value}
      </p>
      {hint ? <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function toCsv(
  rows: {
    label: string;
    visits: number;
    completed: number;
    noShows: number;
    avgWait: number | null;
  }[],
): string {
  const header = [
    "Department",
    "Visits",
    "Completed",
    "No-shows",
    "Completion rate",
    "Avg wait (min)",
  ];
  const lines = rows.map((r) =>
    [
      r.label,
      r.visits,
      r.completed,
      r.noShows,
      r.visits > 0 ? `${Math.round((r.completed / r.visits) * 100)}%` : "0%",
      r.avgWait ?? "",
    ]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(","),
  );
  return [header.join(","), ...lines].join("\n");
}

/** Minutes between the booked slot start and the actual check-in; null when the rider never checked in. */
function waitMinutes(row: VisitListRow): number | null {
  if (!row.checked_in_at || !row.slot_start) return null;
  const checkedIn = new Date(row.checked_in_at);
  if (Number.isNaN(checkedIn.getTime())) return null;
  const [hours, minutes] = row.slot_start.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  const diff =
    checkedIn.getHours() * 60 + checkedIn.getMinutes() - (hours * 60 + minutes);
  if (diff < 0 || diff > 8 * 60) return null;
  return diff;
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
    const waits = rows.map(waitMinutes).filter((m): m is number => m != null);
    return {
      total,
      completed,
      noShows,
      noShowRate: total > 0 ? Math.round((noShows / total) * 100) : 0,
      avgWait:
        waits.length > 0
          ? Math.round(waits.reduce((sum, m) => sum + m, 0) / waits.length)
          : null,
    };
  }, [rows]);

  const byDepartment = useMemo(() => {
    const map = new Map<
      string,
      {
        key: string;
        label: string;
        visits: number;
        completed: number;
        noShows: number;
        waits: number[];
      }
    >();
    for (const row of rows) {
      const entry = map.get(row.department_key) ?? {
        key: row.department_key,
        label: row.department_label,
        visits: 0,
        completed: 0,
        noShows: 0,
        waits: [],
      };
      entry.visits += 1;
      if (row.status === "completed") entry.completed += 1;
      if (row.status === "no_show") entry.noShows += 1;
      const wait = waitMinutes(row);
      if (wait != null) entry.waits.push(wait);
      map.set(row.department_key, entry);
    }
    return [...map.values()]
      .map((entry) => ({
        ...entry,
        avgWait:
          entry.waits.length > 0
            ? Math.round(entry.waits.reduce((sum, m) => sum + m, 0) / entry.waits.length)
            : null,
      }))
      .sort((a, b) => b.visits - a.visits);
  }, [rows]);

  /** Bookings by slot start time, highest volume first — matches the Figma "Busiest time slots" card. */
  const busiestSlots = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of rows) {
      if (!row.slot_start) continue;
      const key = row.slot_start.slice(0, 5);
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    const list = [...map.entries()]
      .map(([time, count]) => ({ time, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);
    const max = Math.max(1, ...list.map((s) => s.count));
    return list
      .sort((a, b) => a.time.localeCompare(b.time))
      .map((slot) => ({ ...slot, share: Math.round((slot.count / max) * 100) }));
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

      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <ReportKpi
          icon={<FileText className="h-3.5 w-3.5" />}
          iconClass="bg-primary/10 text-primary"
          label={t("reports.total")}
          value={summary.total}
        />
        <ReportKpi
          icon={<Activity className="h-3.5 w-3.5" />}
          iconClass="bg-danger/10 text-danger"
          label={t("reports.noShowRate")}
          value={`${summary.noShowRate}%`}
          valueClass="text-danger"
        />
        <ReportKpi
          icon={<CheckCircle2 className="h-3.5 w-3.5" />}
          iconClass="bg-success/10 text-success"
          label={t("reports.avgWaitTime")}
          value={
            summary.avgWait != null
              ? t("departments.minutesValue", { minutes: summary.avgWait })
              : "—"
          }
          hint={summary.avgWait == null ? t("reports.avgWaitEmpty") : undefined}
        />
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
          <div className="grid gap-2 lg:grid-cols-[1.6fr_1fr] lg:items-stretch">
            <AppListCard className="h-full p-4">
              <h3 className="text-sm font-semibold">{t("reports.visitsOverTime")}</h3>
              <p className="text-[11px] text-muted-foreground">
                {t("reports.visitsOverTimeSub")}
              </p>
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

            <AppListCard className="h-full p-4">
              <h3 className="text-sm font-semibold">{t("reports.busiestSlots")}</h3>
              <p className="text-[11px] text-muted-foreground">
                {t("reports.busiestSlotsSub")}
              </p>
              {busiestSlots.length === 0 ? (
                <p className="mt-3 text-[11px] text-muted-foreground">
                  {t("reports.busiestSlotsEmpty")}
                </p>
              ) : (
                <>
                  <div className="mt-3 space-y-3">
                    {busiestSlots.map((slot, idx) => (
                      <div key={slot.time} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="tabular-nums text-muted-foreground">{slot.time}</span>
                          <span className="font-semibold tabular-nums">{slot.count}</span>
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                          <div
                            className={cn("h-full rounded-full", SLOT_BAR_CLASSES[idx] ?? "bg-primary")}
                            style={{ width: `${Math.max(6, slot.share)}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="mt-3 text-[11px] text-muted-foreground">
                    {t("reports.busiestSlotsCaption")}
                  </p>
                </>
              )}
            </AppListCard>
          </div>

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
                { id: "wait", label: t("reports.colAvgWait") },
              ]}
            >
              {byDepartment.map((dept) => (
                <AppDataTableRow key={dept.key}>
                  <TableCell>
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
                        departmentBadgeClass(dept.key),
                      )}
                    >
                      {dept.label}
                    </span>
                  </TableCell>
                  <TableCell className="tabular-nums">{dept.visits}</TableCell>
                  <TableCell className="tabular-nums">{dept.completed}</TableCell>
                  <TableCell className="tabular-nums">{dept.noShows}</TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {dept.visits > 0 ? `${Math.round((dept.completed / dept.visits) * 100)}%` : "0%"}
                  </TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {dept.avgWait != null
                      ? t("departments.minutesValue", { minutes: dept.avgWait })
                      : "—"}
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
