"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Loader2, RefreshCw } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { AppEmptyState, AppListCard, AppPage, AppPageHeader } from "@/components/app";
import { KpiGrid } from "@/components/dashboard/kpi-grid";
import {
  AppDataTable,
  AppDataTableRow,
  TableCell,
} from "@/components/app/app-data-table";
import { Button } from "@/components/ui/button";
import { queryKeys } from "@/lib/query/query-keys";
import { cn } from "@/lib/utils";
import { fetchAdminVisitsList } from "./visits-actions";
import { VISIT_STATUSES } from "./visit-status-utils";
import { VisitsTabBar } from "./visits-tab-bar";

function monthBounds(): { from: string; to: string; label: string } {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const label = from.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    label,
  };
}

export function VisitsReportsShell() {
  const t = useTranslations("pages.visitBookings");
  const bounds = useMemo(() => monthBounds(), []);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: queryKeys.visits.list({ reports: true, ...bounds }),
    queryFn: () =>
      fetchAdminVisitsList({
        dateFrom: bounds.from,
        dateTo: bounds.to,
        limit: 1000,
      }),
  });

  const counts = useMemo(() => {
    const rows = data?.rows ?? [];
    const map = Object.fromEntries(VISIT_STATUSES.map((s) => [s, 0])) as Record<
      string,
      number
    >;
    for (const row of rows) {
      map[row.status] = (map[row.status] ?? 0) + 1;
    }
    return { total: rows.length, byStatus: map };
  }, [data?.rows]);

  const byDepartment = useMemo(() => {
    const rows = data?.rows ?? [];
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
  }, [data?.rows]);

  return (
    <AppPage>
      <AppPageHeader
        title={t("reports.title")}
        description={t("reports.subtitle", { month: bounds.label })}
        actions={
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
        }
      />

      <VisitsTabBar />

      <div className="mt-2">
        <KpiGrid
          items={[
          { label: t("reports.total"), value: String(counts.total) },
          ...VISIT_STATUSES.map((status) => ({
            label: t(`status.${status}` as "status.confirmed"),
            value: String(counts.byStatus[status] ?? 0),
            accent:
              status === "confirmed"
                ? ("warning" as const)
                : status === "completed" || status === "checked_in"
                  ? ("success" as const)
                  : status === "cancelled" || status === "no_show"
                    ? ("danger" as const)
                    : undefined,
          })),
        ]}
        />
      </div>

      <div className="grid gap-2 lg:grid-cols-2 lg:items-stretch">
        <AppListCard className="h-full p-0">
          {isLoading ? (
            <div className="flex h-48 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : counts.total === 0 ? (
            <AppEmptyState
              title={t("reports.emptyTitle")}
              description={t("reports.emptyDescription")}
            />
          ) : (
            <AppDataTable
              columns={[
                { id: "status", label: t("colStatus") },
                { id: "count", label: t("reports.count") },
                { id: "share", label: t("reports.share") },
              ]}
            >
              {VISIT_STATUSES.map((status) => {
                const count = counts.byStatus[status] ?? 0;
                const share =
                  counts.total > 0
                    ? `${Math.round((count / counts.total) * 100)}%`
                    : "0%";
                return (
                  <AppDataTableRow key={status}>
                    <TableCell className="text-sm font-medium">
                      {t(`status.${status}` as "status.confirmed")}
                    </TableCell>
                    <TableCell className="tabular-nums">{count}</TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {share}
                    </TableCell>
                  </AppDataTableRow>
                );
              })}
            </AppDataTable>
          )}
        </AppListCard>

        <AppListCard className="h-full p-0">
          <h3 className="border-b border-border p-3 text-sm font-semibold">
            {t("reports.byDepartment")}
          </h3>
          {isLoading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : byDepartment.length === 0 ? (
            <AppEmptyState
              title={t("reports.emptyTitle")}
              description={t("reports.emptyDescription")}
            />
          ) : (
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
          )}
        </AppListCard>
      </div>
    </AppPage>
  );
}
