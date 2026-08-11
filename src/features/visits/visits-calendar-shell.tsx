"use client";

import { Fragment, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Building2, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { AppEmptyState, AppPage } from "@/components/app";
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
import { selectOptionsFrom } from "@/lib/select-items";
import { cn } from "@/lib/utils";
import {
  fetchAdminVisitsList,
  fetchVisitBlockedDates,
  fetchVisitBookingConfigs,
  fetchVisitDepartments,
  fetchVisitSlots,
  type VisitListRow,
  type VisitSlotRow,
} from "./visits-actions";
import { DAY_OF_WEEK_LABELS } from "./visit-status-utils";

type BoardMode = "day" | "week";

type BoardColumn = {
  id: string;
  title: string;
  subtitle: string;
  /** Column date for week mode; day mode uses the toolbar date. */
  date: string;
  departmentKeys: string[];
};

type BoardCell = {
  booked: number;
  capacity: number;
  blocked: boolean;
  first?: VisitListRow;
};

function dateKeyOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

function addDays(d: Date, n: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + n);
  return next;
}

function toMinutes(time: string): number {
  const [h, m] = time.slice(0, 5).split(":");
  return Number(h) * 60 + Number(m);
}

function toTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(
    minutes % 60,
  ).padStart(2, "0")}`;
}

function LegendDot({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className={cn("h-2 w-2 rounded-full", className)} />
      {label}
    </span>
  );
}

export function VisitsCalendarShell() {
  const t = useTranslations("pages.visitBookings");
  const [mode, setMode] = useState<BoardMode>("day");
  const [date, setDate] = useState(() => new Date());
  const [branchId, setBranchId] = useState<string | null>(null);

  const dateKey = dateKeyOf(date);
  const weekStart = useMemo(() => addDays(date, -date.getDay()), [date]);
  const rangeFrom = mode === "day" ? dateKey : dateKeyOf(weekStart);
  const rangeTo = mode === "day" ? dateKey : dateKeyOf(addDays(weekStart, 6));

  const { data: configData } = useQuery({
    queryKey: queryKeys.visits.list({ bookingConfig: true }),
    queryFn: fetchVisitBookingConfigs,
  });
  const { data: deptData } = useQuery({
    queryKey: queryKeys.visits.departments(),
    queryFn: fetchVisitDepartments,
  });
  const { data: slotsData } = useQuery({
    queryKey: queryKeys.visits.slots(),
    queryFn: fetchVisitSlots,
  });
  const { data: blockedData } = useQuery({
    queryKey: queryKeys.visits.list({ blockedDates: true }),
    queryFn: fetchVisitBlockedDates,
  });
  const { data: visitsData, isLoading } = useQuery({
    queryKey: queryKeys.visits.list({ board: mode, from: rangeFrom, to: rangeTo }),
    queryFn: () =>
      fetchAdminVisitsList({ dateFrom: rangeFrom, dateTo: rangeTo, limit: 500 }),
  });

  const configs = useMemo(() => configData?.rows ?? [], [configData?.rows]);
  const config = useMemo(
    () => configs.find((c) => c.branch_id === branchId) ?? configs[0] ?? null,
    [configs, branchId],
  );
  const departments = useMemo(
    () => (deptData?.rows ?? []).filter((d) => d.is_active),
    [deptData?.rows],
  );
  const branchItems = useMemo(
    () =>
      selectOptionsFrom(
        configs,
        (c) => c.branch_id,
        (c) => c.branch_name,
      ),
    [configs],
  );

  const blockedDates = useMemo(() => {
    const set = new Set<string>();
    for (const row of blockedData?.rows ?? []) {
      if (row.branch_id && config && row.branch_id !== config.branch_id) continue;
      set.add(row.blocked_date);
    }
    return set;
  }, [blockedData?.rows, config]);

  /** Slot overrides keyed by `date|department|HH:mm` so capacity and blocked slots win over the branch default. */
  const slotIndex = useMemo(() => {
    const map = new Map<string, VisitSlotRow>();
    for (const slot of slotsData?.rows ?? []) {
      if (config && slot.branch_id && slot.branch_id !== config.branch_id) continue;
      map.set(
        `${slot.slot_date ?? `dow${slot.day_of_week}`}|${slot.department_key}|${slot.start_time.slice(0, 5)}`,
        slot,
      );
    }
    return map;
  }, [slotsData?.rows, config]);

  function slotFor(day: string, dow: number, deptKey: string, time: string) {
    return (
      slotIndex.get(`${day}|${deptKey}|${time}`) ??
      slotIndex.get(`dow${dow}|${deptKey}|${time}`)
    );
  }

  /** Bookings keyed by `date|department|HH:mm` (slot start comes from the joined slot row). */
  const bookings = useMemo(() => {
    const map = new Map<string, VisitListRow[]>();
    for (const row of visitsData?.rows ?? []) {
      if (row.status === "cancelled") continue;
      if (config && row.branch_id && row.branch_id !== config.branch_id) continue;
      if (!row.slot_start) continue;
      const key = `${row.scheduled_date}|${row.department_key}|${row.slot_start.slice(0, 5)}`;
      const list = map.get(key) ?? [];
      list.push(row);
      map.set(key, list);
    }
    return map;
  }, [visitsData?.rows, config]);

  const step = config
    ? Math.max(5, config.slot_length_minutes + config.slot_buffer_minutes)
    : 30;
  const lunch = useMemo(
    () =>
      config?.lunch_start && config?.lunch_end
        ? { from: toMinutes(config.lunch_start), to: toMinutes(config.lunch_end) }
        : null,
    [config],
  );

  const timeRows = useMemo(() => {
    if (!config?.opening_time || !config?.closing_time) return [];
    const open = toMinutes(config.opening_time);
    const close = toMinutes(config.closing_time);
    const rows: { time: string; breakBefore: boolean }[] = [];
    let breakPending = false;
    for (let minutes = open; minutes + config.slot_length_minutes <= close; minutes += step) {
      if (lunch && minutes >= lunch.from && minutes < lunch.to) {
        breakPending = true;
        continue;
      }
      rows.push({ time: toTime(minutes), breakBefore: breakPending });
      breakPending = false;
    }
    return rows;
  }, [config, step, lunch]);

  const columns = useMemo<BoardColumn[]>(() => {
    if (mode === "week") {
      return Array.from({ length: 7 }, (_, i) => {
        const day = addDays(weekStart, i);
        return {
          id: dateKeyOf(day),
          title: DAY_OF_WEEK_LABELS[day.getDay()],
          subtitle: day.toLocaleDateString(undefined, { day: "numeric", month: "short" }),
          date: dateKeyOf(day),
          departmentKeys: departments.map((d) => d.key),
        };
      });
    }
    return departments.map((dept) => ({
      id: dept.key,
      title: dept.label_en,
      subtitle: dept.desk_location ?? t("calendar.deskCount", { count: dept.desks_count }),
      date: dateKey,
      departmentKeys: [dept.key],
    }));
  }, [mode, weekStart, departments, dateKey, t]);

  function cellFor(column: BoardColumn, time: string): BoardCell {
    const day = column.date;
    const dow = new Date(`${day}T00:00:00`).getDay();
    const dayClosed = config != null && !config.working_dows.includes(dow);
    let capacity = 0;
    let booked = 0;
    let blockedSlots = 0;
    let first: VisitListRow | undefined;

    for (const deptKey of column.departmentKeys) {
      const slot = slotFor(day, dow, deptKey, time);
      if (slot && !slot.is_active) {
        blockedSlots += 1;
        continue;
      }
      capacity += slot?.capacity ?? config?.default_slot_capacity ?? 0;
      const rows = bookings.get(`${day}|${deptKey}|${time}`) ?? [];
      booked += rows.length;
      if (!first && rows[0]) first = rows[0];
    }

    const blocked =
      dayClosed ||
      blockedDates.has(day) ||
      (blockedSlots > 0 && capacity === 0 && booked === 0);

    return { booked, capacity, blocked, first };
  }

  const dayLabel = date.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  const weekLabel = `${weekStart.toLocaleDateString(undefined, { day: "numeric", month: "short" })} – ${addDays(
    weekStart,
    6,
  ).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;

  return (
    <AppPage className="space-y-3">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/visit-bookings">{t("title")}</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{t("calendar.title")}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {configs.length > 0 ? (
            <Select
              items={branchItems}
              value={config?.branch_id ?? undefined}
              onValueChange={(v) => v && setBranchId(v)}
            >
              <SelectTrigger className="h-9 w-[190px]">
                <Building2 className="me-1.5 h-3.5 w-3.5 text-muted-foreground" />
                <SelectValue placeholder={t("calendar.branch")} />
              </SelectTrigger>
              <SelectContent>
                {branchItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}

          <div className="inline-flex h-9 items-center gap-1 rounded-lg border border-border bg-card px-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              aria-label={t("calendar.previous")}
              onClick={() => setDate((d) => addDays(d, mode === "day" ? -1 : -7))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="min-w-[92px] text-center text-[13px] font-semibold tabular-nums text-foreground">
              {mode === "day" ? dayLabel : weekLabel}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              aria-label={t("calendar.next")}
              onClick={() => setDate((d) => addDays(d, mode === "day" ? 1 : 7))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="h-9"
            onClick={() => setDate(new Date())}
          >
            {t("calendar.today")}
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <LegendDot className="bg-success" label={t("status.confirmed")} />
            <LegendDot className="bg-primary" label={t("status.checked_in")} />
            <LegendDot className="bg-danger" label={t("calendar.full")} />
          </div>
          <span className="h-4 w-px bg-border" aria-hidden />
          <div className="inline-flex h-9 items-center rounded-lg bg-muted p-1">
            {(["day", "week"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={mode === value}
                onClick={() => setMode(value)}
                className={cn(
                  "inline-flex h-7 items-center rounded-md px-3.5 text-[13px] transition-colors",
                  mode === value
                    ? "border border-border bg-card font-semibold text-foreground shadow-sm"
                    : "font-medium text-muted-foreground hover:text-foreground",
                )}
              >
                {t(value === "day" ? "calendar.day" : "calendar.week")}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        {isLoading ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : timeRows.length === 0 || columns.length === 0 ? (
          <AppEmptyState
            title={t("calendar.noSlotsTitle")}
            description={t("calendar.noSlotsDescription")}
          />
        ) : (
          <div className="max-h-[calc(100dvh-6.5rem)] overflow-auto">
            <table className="w-full border-collapse">
              <thead className="sticky top-0 z-10">
                <tr className="bg-muted/40 [&>th]:bg-muted/40 [&>th]:backdrop-blur-sm">
                  <th className="h-[38px] w-[80px] text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("colTime")}
                  </th>
                  {columns.map((column) => (
                    <th
                      key={column.id}
                      className="h-[38px] min-w-[150px] border-s border-border ps-3 text-start"
                    >
                      <span className="block truncate text-[12.5px] font-semibold text-foreground">
                        {column.title}
                      </span>
                      <span className="block truncate text-[10.5px] font-normal text-muted-foreground">
                        {column.subtitle}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {timeRows.map((row) => (
                  <Fragment key={row.time}>
                    {row.breakBefore && config?.lunch_start && config?.lunch_end ? (
                      <tr className="border-y border-border bg-muted/30">
                        <td
                          colSpan={columns.length + 1}
                          className="py-1.5 text-center text-[11.5px] font-medium text-muted-foreground"
                        >
                          {t("calendar.lunchBreak", {
                            from: config.lunch_start.slice(0, 5),
                            to: config.lunch_end.slice(0, 5),
                          })}
                        </td>
                      </tr>
                    ) : null}
                    <tr className="border-t border-border">
                      <td className="h-[38px] text-center text-xs font-medium tabular-nums text-muted-foreground">
                        {row.time}
                      </td>
                      {columns.map((column) => {
                        const cell = cellFor(column, row.time);
                        if (cell.blocked) {
                          return (
                            <td
                              key={column.id}
                              className="h-[38px] border-s border-border bg-muted/60 text-center text-[11px] font-medium text-muted-foreground"
                            >
                              {t("calendar.blocked")}
                            </td>
                          );
                        }
                        const isFull = cell.capacity > 0 && cell.booked >= cell.capacity;
                        const checkedIn = cell.first?.status === "checked_in";
                        return (
                          <td
                            key={column.id}
                            className={cn(
                              "h-[38px] border-s border-border px-2 py-1 align-top",
                              cell.booked === 0
                                ? "bg-card"
                                : isFull
                                  ? "bg-danger/10"
                                  : checkedIn
                                    ? "bg-primary/10"
                                    : "bg-success/10",
                            )}
                          >
                            {cell.first ? (
                              <Link
                                href={`/visit-bookings/${cell.first.id}`}
                                className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-card py-px pe-1.5 ps-1.5 text-[10.5px] font-medium leading-4 text-foreground hover:bg-muted/60"
                              >
                                <span
                                  className={cn(
                                    "h-[7px] w-[7px] shrink-0 rounded-full",
                                    isFull
                                      ? "bg-danger"
                                      : checkedIn
                                        ? "bg-primary"
                                        : "bg-success",
                                  )}
                                />
                                <span className="truncate">{cell.first.driver_name}</span>
                              </Link>
                            ) : null}
                            <span
                              className={cn(
                                "block text-[10px] leading-4 tabular-nums",
                                cell.booked === 0
                                  ? "font-medium text-muted-foreground/60"
                                  : isFull
                                    ? "font-semibold text-danger"
                                    : checkedIn
                                      ? "font-semibold text-primary"
                                      : "font-semibold text-success",
                              )}
                            >
                              {cell.booked}/{cell.capacity}
                              {isFull ? ` ${t("calendar.full")}` : ""}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppPage>
  );
}
