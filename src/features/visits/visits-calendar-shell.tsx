"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight, Loader2, RefreshCw } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { AppEmptyState, AppListCard, AppPage, AppPageHeader } from "@/components/app";
import {
  AppDataTable,
  AppDataTableRow,
  TableCell,
} from "@/components/app/app-data-table";
import { StatusPill } from "@/components/dashboard/status-pill";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Link } from "@/i18n/navigation";
import { queryKeys } from "@/lib/query/query-keys";
import { cn } from "@/lib/utils";
import {
  fetchAdminVisitsList,
  fetchVisitBranches,
  fetchVisitDepartments,
  fetchVisitSlots,
  type VisitListRow,
} from "./visits-actions";
import { visitStatusVariant } from "./visit-status-utils";
import { VisitsTabBar } from "./visits-tab-bar";

function dateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function monthBounds(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { from: dateStr(from), to: dateStr(to) };
}

function addDays(d: Date, n: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + n);
  return next;
}

export function VisitsCalendarShell() {
  const t = useTranslations("pages.visitBookings");
  const [mode, setMode] = useState<"day" | "list">("day");
  const [date, setDate] = useState(() => new Date());
  const [branchId, setBranchId] = useState<string | null>(null);

  const dateKey = dateStr(date);
  const dow = date.getDay();
  const listBounds = useMemo(() => monthBounds(), []);

  const { data: branchesData } = useQuery({
    queryKey: queryKeys.visits.branches(),
    queryFn: fetchVisitBranches,
  });
  const { data: deptData } = useQuery({
    queryKey: queryKeys.visits.departments(),
    queryFn: fetchVisitDepartments,
  });
  const { data: slotsData } = useQuery({
    queryKey: queryKeys.visits.slots(),
    queryFn: fetchVisitSlots,
  });

  const branches = (branchesData?.rows ?? []).filter((b) => b.is_active);
  const activeBranchId = branchId ?? branches[0]?.id ?? null;
  const departments = (deptData?.rows ?? []).filter((d) => d.is_active);

  const {
    data: dayData,
    isFetching: dayFetching,
    refetch: refetchDay,
  } = useQuery({
    queryKey: queryKeys.visits.list({ calendarDay: dateKey }),
    queryFn: () => fetchAdminVisitsList({ dateFrom: dateKey, dateTo: dateKey, limit: 500 }),
    enabled: mode === "day",
  });

  const {
    data: listData,
    isLoading: listLoading,
    isFetching: listFetching,
    refetch: refetchList,
  } = useQuery({
    queryKey: queryKeys.visits.list({ calendarList: listBounds }),
    queryFn: () =>
      fetchAdminVisitsList({ dateFrom: listBounds.from, dateTo: listBounds.to, limit: 500 }),
    enabled: mode === "list",
  });

  const timeRows = useMemo(() => {
    const slots = slotsData?.rows ?? [];
    const times = new Set<string>();
    for (const slot of slots) {
      if (!slot.is_active) continue;
      if (activeBranchId && slot.branch_id && slot.branch_id !== activeBranchId) continue;
      const matchesDate = slot.slot_date === dateKey;
      const matchesDow = slot.slot_date == null && slot.day_of_week === dow;
      if (matchesDate || matchesDow) times.add(slot.start_time);
    }
    return [...times].sort();
  }, [slotsData?.rows, activeBranchId, dateKey, dow]);

  const bookingsBySlot = useMemo(() => {
    const map = new Map<string, VisitListRow[]>();
    for (const row of dayData?.rows ?? []) {
      if (row.status === "cancelled") continue;
      const list = map.get(row.slot_id) ?? [];
      list.push(row);
      map.set(row.slot_id, list);
    }
    return map;
  }, [dayData?.rows]);

  function slotFor(deptKey: string, time: string) {
    return (slotsData?.rows ?? []).find(
      (slot) =>
        slot.department_key === deptKey &&
        slot.start_time === time &&
        slot.is_active &&
        (!activeBranchId || !slot.branch_id || slot.branch_id === activeBranchId) &&
        (slot.slot_date === dateKey || (slot.slot_date == null && slot.day_of_week === dow)),
    );
  }

  const grouped = useMemo(() => {
    const rows = listData?.rows ?? [];
    const map = new Map<string, typeof rows>();
    for (const row of rows) {
      const list = map.get(row.scheduled_date) ?? [];
      list.push(row);
      map.set(row.scheduled_date, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.slot_start ?? "").localeCompare(b.slot_start ?? ""));
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [listData?.rows]);

  return (
    <AppPage>
      <AppPageHeader
        title={t("calendar.title")}
        description={
          mode === "day"
            ? date.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" })
            : t("calendar.subtitle", { from: listBounds.from, to: listBounds.to })
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant={mode === "day" ? "default" : "outline"}
              size="sm"
              className="h-9"
              onClick={() => setMode("day")}
            >
              {t("calendar.day")}
            </Button>
            <Button
              type="button"
              variant={mode === "list" ? "default" : "outline"}
              size="sm"
              className="h-9"
              onClick={() => setMode("list")}
            >
              {t("calendar.list")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9"
              disabled={mode === "day" ? dayFetching : listFetching}
              onClick={() => void (mode === "day" ? refetchDay() : refetchList())}
            >
              <RefreshCw
                className={cn(
                  "me-1.5 h-3.5 w-3.5",
                  (mode === "day" ? dayFetching : listFetching) && "animate-spin",
                )}
              />
              {t("refresh")}
            </Button>
          </div>
        }
      />

      <VisitsTabBar />

      {mode === "day" ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {branches.length > 0 ? (
              <Select
                value={activeBranchId ?? undefined}
                onValueChange={(v) => v && setBranchId(v)}
              >
                <SelectTrigger className="h-9 w-[200px]">
                  <SelectValue placeholder={t("calendar.branch")} />
                </SelectTrigger>
                <SelectContent>
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id} label={b.name}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-9 w-9"
              onClick={() => setDate((d) => addDays(d, -1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-medium tabular-nums">
              {date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}
            </span>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-9 w-9"
              onClick={() => setDate((d) => addDays(d, 1))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9"
              onClick={() => setDate(new Date())}
            >
              {t("calendar.today")}
            </Button>
          </div>

          <AppListCard className="mt-2 overflow-x-auto p-0">
            {timeRows.length === 0 ? (
              <AppEmptyState
                title={t("calendar.noSlotsTitle")}
                description={t("calendar.noSlotsDescription")}
              />
            ) : (
              <table className="w-full min-w-[720px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="w-20 px-3 py-2 text-start text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {t("colTime")}
                    </th>
                    {departments.map((dept) => (
                      <th
                        key={dept.key}
                        className="min-w-[140px] border-s border-border px-3 py-2 text-start"
                      >
                        <p className="text-xs font-semibold text-foreground">{dept.label_en}</p>
                        <p className="text-[10px] text-muted-foreground">{t("calendar.desk")}</p>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {timeRows.map((time) => (
                    <tr key={time} className="border-b border-border last:border-b-0">
                      <td className="px-3 py-2 text-xs tabular-nums text-muted-foreground">
                        {time.slice(0, 5)}
                      </td>
                      {departments.map((dept) => {
                        const slot = slotFor(dept.key, time);
                        if (!slot) {
                          return (
                            <td key={dept.key} className="border-s border-border bg-muted/20 px-3 py-2" />
                          );
                        }
                        const booked = bookingsBySlot.get(slot.id) ?? [];
                        const first = booked[0];
                        return (
                          <td key={dept.key} className="border-s border-border px-3 py-2 align-top">
                            <p className="text-[10px] font-medium tabular-nums text-muted-foreground">
                              {booked.length}/{slot.capacity}
                            </p>
                            {first ? (
                              <Link
                                href={`/visit-bookings/${first.id}`}
                                className="mt-0.5 flex items-center gap-1.5 hover:underline"
                              >
                                <StatusPill variant={visitStatusVariant(first.status)} dot>
                                  {first.driver_name}
                                </StatusPill>
                              </Link>
                            ) : null}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </AppListCard>
        </>
      ) : (
        <AppListCard className="mt-2">
          {listLoading ? (
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
              {grouped.map(([groupDate, rows]) => (
                <div key={groupDate} className="p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-sm font-semibold tabular-nums">{groupDate}</h3>
                    <span className="text-[11px] text-muted-foreground">
                      {t("calendar.count", { count: rows.length })}
                    </span>
                  </div>
                  <AppDataTable
                    columns={[
                      { id: "time", label: t("colTime") },
                      { id: "code", label: t("colCode") },
                      { id: "driver", label: t("colDriver") },
                      { id: "dept", label: t("colDepartment") },
                      { id: "branch", label: t("colBranch") },
                      { id: "status", label: t("colStatus") },
                    ]}
                  >
                    {rows.map((row) => (
                      <AppDataTableRow key={row.id}>
                        <TableCell className="text-sm tabular-nums text-muted-foreground">
                          {row.slot_start ? row.slot_start.slice(0, 5) : "—"}
                          {row.slot_end ? `–${row.slot_end.slice(0, 5)}` : ""}
                        </TableCell>
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
                        <TableCell className="text-sm text-muted-foreground">
                          {row.branch_name ?? "—"}
                        </TableCell>
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
      )}
    </AppPage>
  );
}
