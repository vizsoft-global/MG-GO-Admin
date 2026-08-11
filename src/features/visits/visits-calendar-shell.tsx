"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, RefreshCw } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { AppEmptyState, AppListCard, AppPage, AppPageHeader } from "@/components/app";
import {
  AppDataTable,
  AppDataTableRow,
  TableCell,
} from "@/components/app/app-data-table";
import { StatusPill } from "@/components/dashboard/status-pill";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { queryKeys } from "@/lib/query/query-keys";
import { cn } from "@/lib/utils";
import { fetchAdminVisitsList } from "./visits-actions";
import { visitStatusVariant } from "./visit-status-utils";
import { VisitsTabBar } from "./visits-tab-bar";

function monthBounds(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

export function VisitsCalendarShell() {
  const t = useTranslations("pages.visitBookings");
  const bounds = useMemo(() => monthBounds(), []);
  const [mode, setMode] = useState<"month" | "week">("month");

  const weekBounds = useMemo(() => {
    const now = new Date();
    const day = now.getDay();
    const start = new Date(now);
    start.setDate(now.getDate() - day);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return {
      from: start.toISOString().slice(0, 10),
      to: end.toISOString().slice(0, 10),
    };
  }, []);

  const range = mode === "month" ? bounds : weekBounds;

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: queryKeys.visits.list({ calendar: mode, ...range }),
    queryFn: () =>
      fetchAdminVisitsList({
        dateFrom: range.from,
        dateTo: range.to,
        limit: 500,
      }),
  });

  const grouped = useMemo(() => {
    const rows = data?.rows ?? [];
    const map = new Map<string, typeof rows>();
    for (const row of rows) {
      const list = map.get(row.scheduled_date) ?? [];
      list.push(row);
      map.set(row.scheduled_date, list);
    }
    return [...map.entries()].sort(([a], [b]) => b.localeCompare(a));
  }, [data?.rows]);

  return (
    <AppPage>
      <AppPageHeader
        title={t("calendar.title")}
        description={t("calendar.subtitle", { from: range.from, to: range.to })}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant={mode === "month" ? "default" : "outline"}
              size="sm"
              className="h-9"
              onClick={() => setMode("month")}
            >
              {t("calendar.month")}
            </Button>
            <Button
              type="button"
              variant={mode === "week" ? "default" : "outline"}
              size="sm"
              className="h-9"
              onClick={() => setMode("week")}
            >
              {t("calendar.week")}
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

      <AppListCard className="mt-2">
        {isLoading ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : grouped.length === 0 ? (
          <AppEmptyState
            title={t("calendar.emptyTitle")}
            description={t("calendar.emptyDescription")}
          />
        ) : (
          <div className="divide-y divide-border">
            {grouped.map(([date, rows]) => (
              <div key={date} className="p-3">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-semibold tabular-nums">{date}</h3>
                  <span className="text-[11px] text-muted-foreground">
                    {t("calendar.count", { count: rows.length })}
                  </span>
                </div>
                <AppDataTable
                  columns={[
                    { id: "code", label: t("colCode") },
                    { id: "driver", label: t("colDriver") },
                    { id: "dept", label: t("colDepartment") },
                    { id: "status", label: t("colStatus") },
                  ]}
                >
                  {rows.map((row) => (
                    <AppDataTableRow key={row.id}>
                      <TableCell className="font-medium tabular-nums">
                        <Link
                          href={`/visit-bookings/${row.id}`}
                          className="text-primary hover:underline"
                        >
                          {row.booking_code}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <p className="text-sm">{row.driver_name}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {row.driver_code}
                        </p>
                      </TableCell>
                      <TableCell className="text-sm">{row.department_label}</TableCell>
                      <TableCell>
                        <StatusPill variant={visitStatusVariant(row.status)}>
                          {t(`status.${row.status}` as "status.confirmed")}
                        </StatusPill>
                      </TableCell>
                    </AppDataTableRow>
                  ))}
                </AppDataTable>
              </div>
            ))}
          </div>
        )}
      </AppListCard>
    </AppPage>
  );
}
