"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { AppEmptyState, AppPage } from "@/components/app";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { downloadWorkbookXlsx } from "@/features/drivers/import/export-xlsx";
import { BookingPopover, type BookingPopoverStatus } from "@/features/visits/calendar/booking-popover";
import {
  CalendarPageHeader,
  CalendarToolbar,
  LoadLegend,
  ServiceChips,
  StatusLegend,
} from "@/features/visits/calendar/calendar-chrome";
import { busiestDays, serviceMix } from "@/features/visits/calendar/calendar-model";
import {
  bookingStatusStyle,
  serviceColorVar,
  shortServiceLabel,
} from "@/features/visits/calendar/colors";
import { DayAgenda } from "@/features/visits/calendar/day-agenda";
import { DayGrid } from "@/features/visits/calendar/day-grid";
import { MonthGrid } from "@/features/visits/calendar/month-grid";
import { SlotPopover } from "@/features/visits/calendar/slot-popover";
import { WeekGrid } from "@/features/visits/calendar/week-grid";
import { YearGrid } from "@/features/visits/calendar/year-grid";
import { YearInsights } from "@/features/visits/calendar/year-insights";
import { useAuth } from "@/contexts/auth-context";
import { Link } from "@/i18n/navigation";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { addKuwaitDays } from "@/lib/date/kuwait-dates";
import { kuwaitClockMinutes, kuwaitTodayYmd, kuwaitWeekStartYmd } from "@/lib/date/kuwait-clock";
import { formatPct } from "@/lib/format/percent";
import { queryKeys } from "@/lib/query/query-keys";
import { cn } from "@/lib/utils";
import {
  fetchAdminVisitsList,
  fetchVisitBlockedDates,
  fetchVisitBookingConfigs,
  fetchVisitBranches,
  fetchVisitDayCounts,
  fetchVisitDepartments,
  fetchVisitSlots,
  rescheduleAdminVisit,
  updateAdminVisitStatus,
  type VisitListRow,
  type VisitSlotRow,
} from "./visits-actions";
import { isBranchWorkingDay } from "./visit-hours";
import { departmentLabel, slotCapacityAt } from "./visit-board";

type BoardMode = "day" | "week" | "month" | "year";

const LIST_CAP = 5000;

function dowOf(ymd: string): number {
  const [year, month, day] = ymd.split("-").map(Number);
  return new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1)).getUTCDay();
}

function monthBounds(ymd: string): { from: string; to: string } {
  const [year, month] = ymd.split("-").map(Number);
  const last = new Date(Date.UTC(year ?? 1970, month ?? 1, 0)).getUTCDate();
  const mm = String(month ?? 1).padStart(2, "0");
  return {
    from: `${year}-${mm}-01`,
    to: `${year}-${mm}-${String(last).padStart(2, "0")}`,
  };
}

function shiftMonth(ymd: string, delta: number): string {
  const [year, month] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1 + delta, 1));
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${date.getUTCFullYear()}-${mm}-01`;
}

function shiftYear(ymd: string, delta: number): string {
  const year = Number(ymd.slice(0, 4)) + delta;
  return `${year}-01-01`;
}

function minutesOf(hhmm: string): number {
  const [hours, mins] = hhmm.slice(0, 5).split(":");
  return Number(hours) * 60 + Number(mins);
}

function toTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function toBookingStatus(status: string): BookingPopoverStatus | null {
  switch (status) {
    case "confirmed":
    case "checked_in":
    case "completed":
    case "no_show":
      return status;
    default:
      return null;
  }
}

function matchesVisitor(row: VisitListRow, query: string): boolean {
  if (!query) return true;
  const name = row.driver_name.toLowerCase();
  const phone = (row.driver_phone ?? "").toLowerCase();
  return name.includes(query) || phone.includes(query);
}

function formatYmd(ymd: string, locale: string, withWeekday: boolean): string {
  const [year, month, day] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1));
  return new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    numberingSystem: "latn",
    weekday: withWeekday ? "short" : undefined,
    day: "numeric",
    month: "short",
    year: withWeekday ? undefined : "numeric",
  }).format(date);
}

const CALENDAR_DATE_STYLES = {
  day: { weekday: "short", day: "numeric", month: "short", year: "numeric" },
  dayLong: { weekday: "long", day: "numeric", month: "long" },
  dayMonth: { day: "numeric", month: "short" },
  dayMonthLong: { day: "numeric", month: "long" },
  dayMonthYear: { day: "numeric", month: "short", year: "numeric" },
  dayOnly: { day: "numeric" },
  weekdayDay: { weekday: "short", day: "numeric" },
  weekdayDayMonth: { weekday: "short", day: "numeric", month: "short" },
  monthLong: { month: "long" },
} as const;

/** The frames print `Tue, 27 Oct 2026` / `Tuesday, 27 October`, which en-US
 *  would render as `Tue, Oct 27, 2026` / `Tuesday, October 27`. */
function calendarLabel(
  ymd: string,
  locale: string,
  style: keyof typeof CALENDAR_DATE_STYLES,
): string {
  const [year, month, day] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1));
  const formatted = new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en-GB", {
    timeZone: "UTC",
    numberingSystem: "latn",
    ...CALENDAR_DATE_STYLES[style],
  }).format(date);
  if (locale !== "ar" && style === "dayLong") {
    return formatted.replace(/^(\S+) /, "$1, ");
  }
  return formatted;
}

/** ISO week of the Wednesday inside the Sunday-first week, so 25–31 Oct 2026
 *  reads as week 44 the way the frames number it. */
function isoWeekNumber(ymd: string): number {
  const [year, month, day] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1));
  const thursday = new Date(date);
  const dayNr = (date.getUTCDay() + 6) % 7;
  thursday.setUTCDate(thursday.getUTCDate() - dayNr + 3);
  const firstThursday = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
  const firstDayNr = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNr + 3);
  return 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / 604_800_000);
}

export function VisitsCalendarShell({
  fromEsignHub = false,
}: {
  fromEsignHub?: boolean;
}) {
  const t = useTranslations("pages.visitBookings");
  const locale = useLocale();
  const { permissions, isSuperAdmin } = useAuth();
  const canOperate = hasPermissionInSet(new Set(permissions), "visits.operate", isSuperAdmin);
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<BoardMode>("day");
  const [cursor, setCursor] = useState(() => kuwaitTodayYmd());
  const [branchId, setBranchId] = useState<string | null>(null);
  const [serviceKey, setServiceKey] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [agendaDay, setAgendaDay] = useState<string | null>(null);
  const [slotTarget, setSlotTarget] = useState<{ ymd: string; time: string } | null>(null);
  const [rescheduleFor, setRescheduleFor] = useState<VisitListRow | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState("");
  const [rescheduleSlotId, setRescheduleSlotId] = useState("");
  const [nowTick, setNowTick] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const today = kuwaitTodayYmd();
  const nowMinutes = kuwaitClockMinutes(new Date(nowTick));
  const weekStart = kuwaitWeekStartYmd(cursor);
  const gridMode = mode === "month" || mode === "year";
  const searchDisabled = gridMode;
  const monthWindow = monthBounds(cursor);
  const prevWindow = monthBounds(shiftMonth(cursor, -1));
  const year = Number(cursor.slice(0, 4));

  const rangeFrom =
    mode === "year"
      ? `${year}-01-01`
      : mode === "month"
        ? monthWindow.from
        : mode === "week"
          ? weekStart
          : cursor;
  const rangeTo =
    mode === "year"
      ? `${year}-12-31`
      : mode === "month"
        ? monthWindow.to
        : mode === "week"
          ? addKuwaitDays(weekStart, 6)
          : cursor;

  const { data: configData } = useQuery({
    queryKey: queryKeys.visits.list({ bookingConfig: true }),
    queryFn: fetchVisitBookingConfigs,
  });
  const { data: branchData } = useQuery({
    queryKey: queryKeys.visits.list({ branches: true }),
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
  const { data: blockedData } = useQuery({
    queryKey: queryKeys.visits.list({ blockedDates: true }),
    queryFn: fetchVisitBlockedDates,
  });
  const { data: visitsData, isLoading } = useQuery({
    queryKey: queryKeys.visits.list({ board: mode, from: rangeFrom, to: rangeTo, branch: branchId }),
    queryFn: () =>
      fetchAdminVisitsList({
        dateFrom: rangeFrom,
        dateTo: rangeTo,
        branch: branchId,
        limit: LIST_CAP,
      }),
    enabled: !gridMode,
  });
  const { data: dayCounts, isLoading: countsLoading } = useQuery({
    queryKey: queryKeys.visits.list({
      summary: "days",
      from: rangeFrom,
      to: rangeTo,
      branch: branchId,
    }),
    queryFn: () => fetchVisitDayCounts({ dateFrom: rangeFrom, dateTo: rangeTo, branch: branchId }),
    enabled: gridMode,
  });
  const agendaDate = mode === "month" ? (agendaDay ?? cursor) : null;
  const { data: agendaList } = useQuery({
    queryKey: queryKeys.visits.list({ agenda: agendaDate, branch: branchId }),
    queryFn: () =>
      fetchAdminVisitsList({
        dateFrom: agendaDate,
        dateTo: agendaDate,
        branch: branchId,
        limit: LIST_CAP,
      }),
    enabled: agendaDate != null,
  });
  const { data: monthNoShows } = useQuery({
    queryKey: queryKeys.visits.list({ noShow: monthWindow.from, branch: branchId }),
    queryFn: () =>
      fetchAdminVisitsList({
        status: "no_show",
        dateFrom: monthWindow.from,
        dateTo: monthWindow.to,
        branch: branchId,
        limit: LIST_CAP,
      }),
    enabled: mode === "month",
  });
  const { data: prevNoShows } = useQuery({
    queryKey: queryKeys.visits.list({ noShow: prevWindow.from, branch: branchId }),
    queryFn: () =>
      fetchAdminVisitsList({
        status: "no_show",
        dateFrom: prevWindow.from,
        dateTo: prevWindow.to,
        branch: branchId,
        limit: LIST_CAP,
      }),
    enabled: mode === "month",
  });
  const { data: prevCounts } = useQuery({
    queryKey: queryKeys.visits.list({
      summary: "days",
      from: prevWindow.from,
      to: prevWindow.to,
      branch: branchId,
    }),
    queryFn: () =>
      fetchVisitDayCounts({
        dateFrom: prevWindow.from,
        dateTo: prevWindow.to,
        branch: branchId,
      }),
    enabled: mode === "month",
  });

  const configs = useMemo(() => configData?.rows ?? [], [configData?.rows]);
  const config = useMemo(
    () => configs.find((row) => row.branch_id === branchId) ?? configs[0] ?? null,
    [configs, branchId],
  );
  const departments = useMemo(
    () => (deptData?.rows ?? []).filter((row) => row.is_active),
    [deptData?.rows],
  );
  const visibleDepartments = useMemo(
    () =>
      serviceKey ? departments.filter((row) => row.key === serviceKey) : departments,
    [departments, serviceKey],
  );
  const branchNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of branchData?.rows ?? []) {
      const label = row.name?.trim() || row.key?.trim();
      if (label) map.set(row.id, label);
    }
    return map;
  }, [branchData?.rows]);
  const branchItems = useMemo<{ value: string; label: string }[]>(
    () =>
      configs.map((row) => ({
        value: row.branch_id ?? "",
        label: branchNames.get(row.branch_id ?? "") ?? row.branch_name ?? row.branch_id ?? "",
      })),
    [configs, branchNames],
  );
  const blockedDates = useMemo(() => {
    const set = new Set<string>();
    for (const row of blockedData?.rows ?? []) {
      if (row.branch_id && config && row.branch_id !== config.branch_id) continue;
      set.add(row.blocked_date);
    }
    return set;
  }, [blockedData?.rows, config]);

  const query = search.trim().toLowerCase();
  const activeRows = useMemo(() => {
    return (visitsData?.rows ?? []).filter((row) => {
      if (row.status === "cancelled") return false;
      if (config && row.branch_id && row.branch_id !== config.branch_id) return false;
      if (serviceKey && row.department_key !== serviceKey) return false;
      if (!searchDisabled && !matchesVisitor(row, query)) return false;
      return true;
    });
  }, [visitsData?.rows, config, serviceKey, query, searchDisabled]);

  const truncated = (visitsData?.rows.length ?? 0) >= LIST_CAP;

  const step = config ? Math.max(5, config.slot_length_minutes + config.slot_buffer_minutes) : 30;
  const times = useMemo(() => {
    if (!config?.opening_time || !config.closing_time) return [];
    const open = minutesOf(config.opening_time);
    const close = minutesOf(config.closing_time);
    const lunch =
      config.lunch_start && config.lunch_end
        ? { from: minutesOf(config.lunch_start), to: minutesOf(config.lunch_end) }
        : null;
    const rows: string[] = [];
    for (let minutes = open; minutes + config.slot_length_minutes <= close; minutes += step) {
      if (lunch && minutes >= lunch.from && minutes < lunch.to) continue;
      rows.push(toTime(minutes));
    }
    return rows;
  }, [config, step]);

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

  function slotFor(day: string, deptKey: string, time: string): VisitSlotRow | undefined {
    return slotIndex.get(`${day}|${deptKey}|${time}`) ?? slotIndex.get(`dow${dowOf(day)}|${deptKey}|${time}`);
  }

  function dayClosed(day: string): boolean {
    if (!config) return blockedDates.has(day);
    return !isBranchWorkingDay(config.working_dows, dowOf(day)) || blockedDates.has(day);
  }

  function capacityFor(day: string, deptKey: string, time: string): number {
    return slotCapacityAt(
      slotsData?.rows ?? [],
      config?.branch_id ?? null,
      day,
      dowOf(day),
      deptKey,
      time,
      config?.default_slot_capacity ?? 0,
    );
  }

  function dayCapacity(day: string): number {
    if (dayClosed(day) || !config) return 0;
    let total = 0;
    for (const dept of visibleDepartments) {
      for (const time of times) total += capacityFor(day, dept.key, time);
    }
    return total;
  }

  const bookings = useMemo(() => {
    const map = new Map<string, VisitListRow[]>();
    for (const row of activeRows) {
      if (!row.slot_start) continue;
      const key = `${row.scheduled_date}|${row.department_key}|${row.slot_start.slice(0, 5)}`;
      const list = map.get(key) ?? [];
      list.push(row);
      map.set(key, list);
    }
    return map;
  }, [activeRows]);

  const selected = activeRows.find((row) => row.id === selectedId) ?? null;
  const popoverStatus = selected ? toBookingStatus(selected.status) : null;

  function serviceName(key: string): string {
    const dept = departments.find((row) => row.key === key);
    return dept ? departmentLabel(dept, locale) : "—";
  }

  function statusText(status: string): string {
    switch (status) {
      case "confirmed":
        return t("calendarUi.confirmed");
      case "checked_in":
        return t("calendarUi.checkedIn");
      case "completed":
        return t("calendarUi.completed");
      case "no_show":
        return t("calendarUi.noShow");
      default:
        return t("calendarUi.completed");
    }
  }

  function shift(delta: number) {
    setSelectedId(null);
    setSlotTarget(null);
    if (mode === "year") setCursor((current) => shiftYear(current, delta));
    else if (mode === "month") setCursor((current) => shiftMonth(current, delta));
    else if (mode === "week") setCursor(addKuwaitDays(weekStart, delta * 7));
    else setCursor((current) => addKuwaitDays(current, delta));
  }

  const weekdayLabels = Array.from({ length: 7 }, (_, index) =>
    new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(
      new Date(Date.UTC(2026, 0, 4 + index)),
    ),
  );

  const periodLabel =
    mode === "year"
      ? String(year)
      : mode === "month"
        ? `${calendarLabel(monthWindow.from, locale, "monthLong")} ${year}`
        : mode === "week"
          ? `${calendarLabel(weekStart, locale, "dayOnly")} – ${calendarLabel(addKuwaitDays(weekStart, 6), locale, "dayMonthYear")}`
          : calendarLabel(cursor, locale, "day");

  const dayServices = visibleDepartments.map((dept) => {
    const rows = activeRows.filter(
      (row) => row.scheduled_date === cursor && row.department_key === dept.key,
    );
    const capacity = times.reduce((total, time) => total + capacityFor(cursor, dept.key, time), 0);
    return { key: dept.key, label: departmentLabel(dept, locale), booked: rows.length, capacity };
  });

  const weekDays = Array.from({ length: 7 }, (_, index) => {
    const ymd = addKuwaitDays(weekStart, index);
    const [yearPart, monthPart, dayPart] = ymd.split("-").map(Number);
    return {
      ymd,
      label: formatYmd(ymd, locale, true).split(" ")[0] ?? ymd,
      dateLabel: formatYmd(ymd, locale, true),
      isToday: ymd === today,
      dayNumber: dayPart ?? 1,
      weekday: new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en-GB", {
        timeZone: "UTC",
        numberingSystem: "latn",
        weekday: "short",
      }).format(new Date(Date.UTC(yearPart ?? 1970, (monthPart ?? 1) - 1, dayPart ?? 1))),
      bookings: activeRows.filter((row) => row.scheduled_date === ymd).length,
    };
  });

  function statFor(day: string) {
    const found = (dayCounts ?? []).find((entry) => entry.date === day);
    const departmentsForDay = { ...(found?.departments ?? {}) };
    if (serviceKey) {
      const count = departmentsForDay[serviceKey] ?? 0;
      for (const key of Object.keys(departmentsForDay)) delete departmentsForDay[key];
      if (count) departmentsForDay[serviceKey] = count;
    }
    const booked = serviceKey
      ? (found?.departments[serviceKey] ?? 0)
      : (found?.booked ?? 0);
    return {
      booked,
      capacity: dayCapacity(day),
      departments: departmentsForDay,
      closed: dayClosed(day),
      outside: false,
    };
  }

  const monthBooked = (dayCounts ?? []).reduce((total, day) => {
    if (serviceKey) return total + (day.departments[serviceKey] ?? 0);
    return total + day.booked;
  }, 0);
  const prevBooked = (prevCounts ?? []).reduce((total, day) => total + day.booked, 0);

  function noShowRate(
    payload: { rows: VisitListRow[]; error?: string } | undefined,
    booked: number,
  ): number | null {
    if (!payload || payload.error || booked <= 0) return null;
    return (payload.rows.length / booked) * 100;
  }

  const monthRate = noShowRate(monthNoShows, monthBooked);
  const prevRate = noShowRate(prevNoShows, prevBooked);

  async function refreshVisits() {
    await queryClient.invalidateQueries({ queryKey: queryKeys.visits.all() });
  }

  async function checkIn() {
    if (!selected) return;
    const result = await updateAdminVisitStatus({ bookingId: selected.id, status: "checked_in" });
    if (!result.ok) {
      toast.error(result.error ?? t("calendarUi.incomplete"));
      return;
    }
    toast.success(t("calendarUi.checkedIn"));
    await refreshVisits();
  }

  async function saveReschedule() {
    if (!rescheduleFor || !rescheduleSlotId) return;
    const result = await rescheduleAdminVisit({
      bookingId: rescheduleFor.id,
      scheduledDate: rescheduleDate,
      slotId: rescheduleSlotId,
    });
    if (!result.ok) {
      toast.error(result.error ?? t("calendarUi.incomplete"));
      return;
    }
    setRescheduleFor(null);
    await refreshVisits();
  }

  function exportRows() {
    if (gridMode) {
      downloadWorkbookXlsx("visit-calendar.xlsx", [
        {
          name: "Days",
          aoa: [
            ["Date", "Booked"],
            ...(dayCounts ?? []).map((day) => [day.date, serviceKey ? (day.departments[serviceKey] ?? 0) : day.booked]),
          ],
        },
      ]);
      return;
    }
    downloadWorkbookXlsx("visit-calendar.xlsx", [
      {
        name: "Bookings",
        aoa: [
          ["Name", "Phone", "Service", "Date", "Time", "Status"],
          ...activeRows.map((row) => [
            row.driver_name,
            row.driver_phone ?? "",
            serviceName(row.department_key),
            row.scheduled_date,
            row.slot_start?.slice(0, 5) ?? "",
            row.status,
          ]),
        ],
      },
    ]);
  }

  const slotChoices = (slotsData?.rows ?? []).filter((slot) => {
    if (!rescheduleFor) return false;
    if (slot.department_key !== rescheduleFor.department_key) return false;
    if (config && slot.branch_id && slot.branch_id !== config.branch_id) return false;
    if (slot.slot_date) return slot.slot_date === rescheduleDate;
    return slot.day_of_week === dowOf(rescheduleDate);
  });

  const agendaRows = (agendaList?.rows ?? []).filter((row) => row.status !== "cancelled");
  const agendaServices = visibleDepartments.map((dept) => ({
    key: dept.key,
    label: departmentLabel(dept, locale),
    booked: agendaRows.filter((row) => row.department_key === dept.key).length,
    capacity: times.reduce(
      (total, time) => total + (agendaDate ? capacityFor(agendaDate, dept.key, time) : 0),
      0,
    ),
  }));

  const yearDays = dayCounts ?? [];
  const mix = serviceMix(
    yearDays.map((day) => ({
      departments: serviceKey
        ? { [serviceKey]: day.departments[serviceKey] ?? 0 }
        : day.departments,
    })),
  );
  const busiest = busiestDays(
    yearDays.map((day) => ({
      date: day.date,
      booked: serviceKey ? (day.departments[serviceKey] ?? 0) : day.booked,
      capacity: dayCapacity(day.date),
    })),
  );
  const monthTotals = Array.from({ length: 12 }, (_, month) => {
    const key = `${year}-${String(month + 1).padStart(2, "0")}`;
    const booked = yearDays
      .filter((day) => day.date.startsWith(key))
      .reduce((total, day) => total + (serviceKey ? (day.departments[serviceKey] ?? 0) : day.booked), 0);
    return {
      label: new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" }).format(
        new Date(Date.UTC(year, month, 1)),
      ),
      booked,
      isCurrent: today.startsWith(key),
    };
  });

  const checkedIn = activeRows.filter((row) => row.status === "checked_in").length;
  const completed = activeRows.filter((row) => row.status === "completed").length;
  const stillToArrive = activeRows.filter((row) => {
    if (row.status !== "confirmed" || !row.slot_start) return false;
    if (row.scheduled_date > today) return true;
    if (row.scheduled_date < today) return false;
    return minutesOf(row.slot_start) >= nowMinutes;
  }).length;
  const noShows = activeRows.filter((row) => row.status === "no_show").length;
  const dayBooked = activeRows.filter((row) => row.scheduled_date === cursor).length;
  const dayCap = dayCapacity(cursor);

  const loading = gridMode ? countsLoading : isLoading;
  const slotCell = slotTarget
    ? (() => {
        const rows = visibleDepartments.flatMap(
          (dept) => bookings.get(`${slotTarget.ymd}|${dept.key}|${slotTarget.time}`) ?? [],
        );
        const capacity = visibleDepartments.reduce(
          (total, dept) => total + capacityFor(slotTarget.ymd, dept.key, slotTarget.time),
          0,
        );
        const counts = new Map<string, number>();
        for (const row of rows) counts.set(row.department_key, (counts.get(row.department_key) ?? 0) + 1);
        return { rows, capacity, counts };
      })()
    : null;

  const slotMinutes = config?.slot_length_minutes ?? step;
  const serviceCount = visibleDepartments.length;
  const dayPct = dayCap > 0 ? (dayBooked / dayCap) * 100 : null;
  const nextVisitorRow =
    activeRows
      .filter(
        (row) =>
          row.status === "confirmed" &&
          row.scheduled_date === today &&
          row.slot_start != null &&
          minutesOf(row.slot_start) >= nowMinutes,
      )
      .sort((a, b) => (a.slot_start ?? "").localeCompare(b.slot_start ?? ""))[0] ?? null;

  const weekCapacity = weekDays.reduce((total, day) => total + dayCapacity(day.ymd), 0);
  const weekBooked = activeRows.length;
  const fullSlotLabels = weekDays.flatMap((day) =>
    times
      .filter((time) => {
        const booked = visibleDepartments.reduce(
          (sum, dept) => sum + (bookings.get(`${day.ymd}|${dept.key}|${time}`)?.length ?? 0),
          0,
        );
        const capacity = visibleDepartments.reduce(
          (sum, dept) => sum + capacityFor(day.ymd, dept.key, time),
          0,
        );
        return capacity > 0 && booked >= capacity;
      })
      .map((time) => `${calendarLabel(day.ymd, locale, "weekdayDay")} · ${time}`),
  );
  const weekBusiest = busiestDays(
    weekDays.map((day) => ({
      date: day.ymd,
      booked: activeRows.filter((visit) => visit.scheduled_date === day.ymd).length,
      capacity: dayCapacity(day.ymd),
    })),
  )[0];
  const weekTop = serviceMix([
    {
      departments: Object.fromEntries(
        visibleDepartments.map((dept) => [
          dept.key,
          activeRows.filter((row) => row.department_key === dept.key).length,
        ]),
      ),
    },
  ])[0];

  const monthDays = dayCounts ?? [];
  const trailingDays = monthDays.filter((day) => day.date > today);
  const trailingBooked = trailingDays.reduce(
    (total, day) => total + (serviceKey ? (day.departments[serviceKey] ?? 0) : day.booked),
    0,
  );
  const trailingRange =
    trailingDays.length > 0
      ? `${calendarLabel(trailingDays[0]?.date ?? today, locale, "dayOnly")} – ${calendarLabel(monthWindow.to, locale, "dayMonthYear")}`
      : "";
  const sunThuDays = monthDays.filter((day) => {
    const dow = dowOf(day.date);
    return dow >= 0 && dow <= 4 && dayCapacity(day.date) > 0;
  });
  const sunThuAverage =
    sunThuDays.length > 0
      ? Math.round(sunThuDays.reduce((total, day) => total + day.booked, 0) / sunThuDays.length)
      : null;
  const monthBusiest = busiestDays(
    monthDays.map((row) => ({
      date: row.date,
      booked: row.booked,
      capacity: dayCapacity(row.date),
    })),
  )[0];
  const monthBusiestCapacity = monthBusiest ? dayCapacity(monthBusiest.date) : 0;
  const bestMonthIndex = monthTotals.reduce(
    (best, month, index, all) => (month.booked > all[best].booked ? index : best),
    0,
  );
  const bestMonth = monthTotals[bestMonthIndex];
  const bestMonthLabel = calendarLabel(
    `${year}-${String(bestMonthIndex + 1).padStart(2, "0")}-01`,
    locale,
    "monthLong",
  );
  const bestMonthCapacity = monthDays
    .filter((day) => Number(day.date.slice(5, 7)) - 1 === bestMonthIndex)
    .reduce((total, day) => total + dayCapacity(day.date), 0);

  const yearTotal = yearDays.reduce((total, day) => total + day.booked, 0);
  const scheduledAfterToday = yearDays
    .filter((day) => day.date > today)
    .reduce((total, day) => total + day.booked, 0);
  const peakCapacity = busiest[0] ? dayCapacity(busiest[0].date) : 0;
  const closedDaysCount = Array.from({ length: 12 }, (_, month) =>
    new Date(Date.UTC(year, month + 1, 0)).getUTCDate(),
  ).reduce((total, daysInMonth, month) => {
    let closed = 0;
    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      if (dayClosed(date)) closed += 1;
    }
    return total + closed;
  }, 0);

  const agendaUpNext = agendaRows
    .filter((row) => row.slot_start != null && row.status !== "cancelled")
    .sort((a, b) => (a.slot_start ?? "").localeCompare(b.slot_start ?? ""))
    .slice(0, 3)
    .map((row) => ({
      id: row.id,
      time: row.slot_start?.slice(0, 5) ?? "",
      name: row.driver_name,
      serviceLabel: `${serviceName(row.department_key)} · ${t("calendar.desk")}`,
      status: row.status,
    }));

  return (
    <AppPage className="space-y-3">
      {fromEsignHub ? (
        <Link href="/requests/esign" className="text-xs text-primary hover:underline">
          {t("calendar.backToEsign")}
        </Link>
      ) : null}
      <CalendarPageHeader
        apps={t("calendarUi.apps")}
        visitSlots={t("calendarUi.visitSlots")}
        calendar={t("calendarUi.calendar")}
        title={t("calendarUi.pageTitle")}
        subtitle={t("calendarUi.subtitle")}
        exportLabel={t("calendarUi.export")}
        onExport={exportRows}
        newBookingLabel={t("calendarUi.newBooking")}
        comingSoon={t("calendarUi.comingSoon")}
      />
      <CalendarToolbar
        branchItems={branchItems}
        branchId={config?.branch_id ?? ""}
        onBranchChange={(value) => setBranchId(value || null)}
        branchLabel={t("calendarUi.branch")}
        label={periodLabel}
        onPrevious={() => shift(-1)}
        onNext={() => shift(1)}
        previousLabel={t("calendarUi.previous")}
        nextLabel={t("calendarUi.next")}
        todayLabel={t("calendarUi.today")}
        onToday={() => {
          setCursor(today);
          setSelectedId(null);
        }}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder={t("calendarUi.searchPlaceholder")}
        searchDisabled={searchDisabled}
        searchDisabledHint={t("calendarUi.searchDisabled")}
        mode={mode}
        onModeChange={(next) => {
          setMode(next);
          setSelectedId(null);
          setSlotTarget(null);
        }}
        viewLabels={{
          day: t("calendar.day"),
          week: t("calendar.week"),
          month: t("calendar.viewMonth"),
          year: t("calendar.year"),
        }}
        services={
          <ServiceChips
            allLabel={t("calendarUi.allServices")}
            allCount={departments.length}
            servicesLabel={t("calendarUi.services")}
            selectedKey={serviceKey}
            onSelect={setServiceKey}
            items={departments.map((dept) => ({
              key: dept.key,
              label: departmentLabel(dept, locale),
              colorClass: serviceColorVar(dept.key, departmentLabel(dept, locale)),
            }))}
          />
        }
      />
      {truncated ? <p className="text-xs text-muted-foreground">{t("calendarUi.incomplete")}</p> : null}

      <div className="visit-kpi-grid grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {mode === "day" ? (
          <>
            <KpiCard
              layout="portal"
              portalAccent="ink"
              label={t("calendarUi.bookingsToday")}
              value={dayBooked}
              caption={
                dayPct != null
                  ? t("calendarUi.slotsBooked", { pct: formatPct(dayPct), count: dayCap })
                  : undefined
              }
            />
            <KpiCard
              layout="portal"
              portalAccent="green"
              label={t("calendarUi.checkedIn")}
              value={checkedIn + completed}
              caption={t("calendarUi.onSiteNow", { checked: checkedIn, completed })}
            />
            <KpiCard
              layout="portal"
              portalAccent="blue"
              label={t("calendarUi.stillToArrive")}
              value={stillToArrive}
              caption={
                nextVisitorRow
                  ? t("calendarUi.nextVisitorAt", {
                      name: nextVisitorRow.driver_name,
                      time: nextVisitorRow.slot_start?.slice(0, 5) ?? "",
                    })
                  : undefined
              }
            />
            <KpiCard
              layout="portal"
              portalAccent="red"
              label={t("calendarUi.noShows")}
              value={noShows}
              caption={t("calendarUi.noShowGrace")}
            />
          </>
        ) : null}
        {mode === "week" ? (
          <>
            <KpiCard
              layout="portal"
              portalAccent="ink"
              label={t("calendarUi.bookingsWeek")}
              value={weekBooked}
              caption={
                weekCapacity > 0
                  ? t("calendarUi.slotsBooked", {
                      pct: formatPct((weekBooked / weekCapacity) * 100),
                      count: weekCapacity,
                    })
                  : undefined
              }
            />
            <KpiCard
              layout="portal"
              portalAccent="ochre"
              label={t("calendarUi.busiestDay")}
              value={weekBusiest ? calendarLabel(weekBusiest.date, locale, "weekdayDay") : "—"}
              caption={t("calendarUi.acrossServices", {
                count: weekBusiest?.booked ?? 0,
                services: serviceCount,
              })}
            />
            <KpiCard
              layout="portal"
              portalAccent="red"
              label={t("calendarUi.fullSlots")}
              value={fullSlotLabels.length}
              caption={
                fullSlotLabels.length > 0
                  ? `${fullSlotLabels.slice(0, 2).join(", ")}${
                      fullSlotLabels.length > 2
                        ? ` ${t("calendarUi.moreCount", { count: fullSlotLabels.length - 2 })}`
                        : ""
                    }`
                  : undefined
              }
            />
            <KpiCard
              layout="portal"
              portalAccent="plum"
              label={t("calendarUi.topService")}
              value={weekTop ? serviceName(weekTop.key) : "—"}
              caption={
                weekTop && weekBooked > 0
                  ? t("calendarUi.shareOfWeek", {
                      pct: formatPct((weekTop.count / weekBooked) * 100),
                    })
                  : undefined
              }
            />
          </>
        ) : null}
        {mode === "month" ? (
          <>
            <KpiCard
              layout="portal"
              portalAccent="ink"
              label={t("calendarUi.bookingsMonth")}
              value={monthBooked}
              caption={
                trailingBooked > 0
                  ? t("calendarUi.alreadyBooked", {
                      count: trailingBooked,
                      range: trailingRange,
                    })
                  : undefined
              }
            />
            <KpiCard
              layout="portal"
              portalAccent="ochre"
              label={t("calendarUi.busiestDay")}
              value={monthBusiest ? calendarLabel(monthBusiest.date, locale, "weekdayDayMonth") : "—"}
              caption={
                monthBusiest && monthBusiestCapacity > 0
                  ? t("calendarUi.slotsBookedOf", {
                      booked: monthBusiest.booked,
                      capacity: monthBusiestCapacity,
                      pct: formatPct((monthBusiest.booked / monthBusiestCapacity) * 100),
                    })
                  : undefined
              }
            />
            <KpiCard
              layout="portal"
              portalAccent="blue"
              label={t("calendarUi.dailyAverage")}
              value={monthDays.length > 0 ? Math.round(monthBooked / monthDays.length) : 0}
              caption={
                sunThuAverage != null
                  ? t("calendarUi.sunThuAverage", { value: sunThuAverage })
                  : undefined
              }
            />
            <KpiCard
              layout="portal"
              portalAccent="green"
              label={t("calendarUi.noShowRate")}
              value={monthRate == null ? "—" : formatPct(monthRate)}
              caption={
                monthRate != null && prevRate != null
                  ? t("calendarUi.downFrom", {
                      value: formatPct(prevRate),
                      month: calendarLabel(prevWindow.from, locale, "monthLong"),
                    })
                  : undefined
              }
            />
          </>
        ) : null}
        {mode === "year" ? (
          <>
            <KpiCard
              layout="portal"
              portalAccent="ink"
              label={t("calendarUi.bookingsYear")}
              value={yearTotal}
              caption={t("calendarUi.soFar", {
                from: calendarLabel(`${year}-01-01`, locale, "dayMonth"),
                to: calendarLabel(today, locale, "dayMonth"),
                count: scheduledAfterToday,
              })}
            />
            <KpiCard
              layout="portal"
              portalAccent="ochre"
              label={t("calendarUi.busiestMonth")}
              value={bestMonth ? bestMonthLabel : "—"}
              caption={
                bestMonth
                  ? t("calendarUi.monthCapacityNote", {
                      count: bestMonth.booked,
                      pct: formatPct(
                        bestMonthCapacity > 0 ? (bestMonth.booked / bestMonthCapacity) * 100 : 0,
                      ),
                    })
                  : undefined
              }
            />
            <KpiCard
              layout="portal"
              portalAccent="red"
              label={t("calendarUi.peakDay")}
              value={busiest[0] ? calendarLabel(busiest[0].date, locale, "dayMonth") : "—"}
              caption={
                busiest[0] && peakCapacity > 0
                  ? t("calendarUi.slotsBookedOf", {
                      booked: busiest[0].booked,
                      capacity: peakCapacity,
                      pct: formatPct((busiest[0].booked / peakCapacity) * 100),
                    })
                  : undefined
              }
            />
            <KpiCard
              layout="portal"
              portalAccent="grey"
              label={t("calendarUi.closedDays")}
              value={closedDaysCount}
              caption={t("calendarUi.closedDaysNote")}
            />
          </>
        ) : null}
      </div>

      {loading ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : mode === "day" ? (
        times.length === 0 || visibleDepartments.length === 0 ? (
          <AppEmptyState title={t("calendar.noSlotsTitle")} description={t("calendar.noSlotsDescription")} />
        ) : (
          <DayGrid
            title={calendarLabel(cursor, locale, "dayLong")}
            subtitle={`${t("calendarUi.servicesCount", { count: serviceCount })} · ${t("calendarUi.slotMinutes", { minutes: slotMinutes })} · ${t("calendarUi.branchTime")}`}
            legend={
              <StatusLegend
                items={[
                  ...(["confirmed", "checked_in", "completed", "no_show"] as const).map((status) => ({
                    label: statusText(status),
                    className: bookingStatusStyle(status).bar,
                  })),
                  {
                    label: t("calendarUi.openSlot"),
                    className: "border border-[var(--portal-border)] bg-card",
                  },
                ]}
              />
            }
            services={dayServices}
            times={times}
            nowMinutes={cursor === today ? nowMinutes : null}
            slotMinutes={step}
            selectedId={selectedId}
            onSelect={(row) => setSelectedId(row.id)}
            statusLabel={statusText}
            labels={{
              serviceDesk: t("calendarUi.serviceDesk"),
              unused: (count) => t("calendarUi.unused", { count }),
              open: (count) => t("calendarUi.openPlaces", { count }),
              blocked: t("calendarUi.blocked"),
              deskBooked: (desk, booked, capacity) =>
                t("calendarUi.deskBooked", { desk, booked, capacity }),
            }}
            cell={(deptKey, time) => {
              const rows = bookings.get(`${cursor}|${deptKey}|${time}`) ?? [];
              const slot = slotFor(cursor, deptKey, time);
              const capacity = capacityFor(cursor, deptKey, time);
              const blocked = dayClosed(cursor) || (slot != null && !slot.is_active);
              return {
                blocked,
                open: Math.max(capacity - rows.length, 0),
                rows: rows.map((row) => ({
                  id: row.id,
                  name: row.driver_name,
                  status: row.status,
                  phone: row.driver_phone ?? "",
                })),
              };
            }}
          />
        )
      ) : mode === "week" ? (
        <WeekGrid
          title={t("calendarUi.weekTitle", {
            week: isoWeekNumber(addKuwaitDays(weekStart, 3)),
            range: `${calendarLabel(weekStart, locale, "dayOnly")} – ${calendarLabel(addKuwaitDays(weekStart, 6), locale, "dayMonthLong")}`,
          })}
          subtitle={t("calendarUi.weekSubtitle")}
          legend={
            <StatusLegend
              items={[
                {
                  label: t("calendarUi.openPlace"),
                  className: "border border-[var(--portal-border)] bg-card",
                },
                { label: t("calendarUi.busyHigh"), className: "bg-[var(--visit-cap-high)]" },
                { label: t("calendarUi.full"), className: "bg-[var(--visit-cap-full)]" },
              ]}
            />
          }
          days={weekDays}
          times={times}
          labels={{ full: t("calendarUi.full") }}
          shortLabel={(service) => shortServiceLabel(service.key, service.label)}
          timeLabel={t("calendarUi.timeColumn")}
          bookingsLabel={(count) => t("calendarUi.bookingsCount", { count })}
          todayLabel={t("calendarUi.today")}
          onOpenSlot={(ymd, time) => setSlotTarget({ ymd, time })}
          cell={(ymd, time) => {
            const services = visibleDepartments
              .map((dept) => ({
                key: dept.key,
                label: departmentLabel(dept, locale),
                count: bookings.get(`${ymd}|${dept.key}|${time}`)?.length ?? 0,
              }))
              .filter((row) => row.count > 0);
            const booked = services.reduce((total, row) => total + row.count, 0);
            const capacity = visibleDepartments.reduce((total, dept) => total + capacityFor(ymd, dept.key, time), 0);
            const past = ymd < today || (ymd === today && minutesOf(time) + step <= nowMinutes);
            return { services, booked, capacity, past, blocked: dayClosed(ymd) };
          }}
        />
      ) : mode === "month" ? (
        <div className="flex flex-col gap-4 lg:flex-row">
          <div className="min-w-0 flex-1">
            <MonthGrid
              title={`${calendarLabel(monthWindow.from, locale, "monthLong")} ${year}`}
              subtitle={t("calendarUi.monthSubtitle")}
              legend={
                <LoadLegend
                  variant="month"
                  labels={{
                    quiet: t("calendarUi.quiet"),
                    busy: t("calendarUi.busy"),
                    full: t("calendarUi.fullyBooked"),
                    closed: t("calendarUi.closed"),
                  }}
                />
              }
              year={year}
              monthIndex={Number(cursor.slice(5, 7)) - 1}
              weekdayLabels={weekdayLabels}
              statFor={statFor}
              selectedYmd={agendaDate}
              todayYmd={today}
              serviceLabel={serviceName}
              onSelectDay={(day) => setAgendaDay(day)}
              fullLabel={t("calendarUi.full")}
            />
          </div>
          <DayAgenda
            dateLabel={agendaDate ? calendarLabel(agendaDate, locale, "dayLong") : ""}
            hoursLabel={
              agendaDate
                ? t("calendarUi.openHours", {
                    booked: statFor(agendaDate).booked,
                    services: serviceCount,
                    from: config?.opening_time?.slice(0, 5) ?? "",
                    to: config?.closing_time?.slice(0, 5) ?? "",
                  })
                : ""
            }
            isToday={agendaDate === today}
            todayLabel={t("calendarUi.today")}
            booked={agendaDate ? statFor(agendaDate).booked : 0}
            checkedIn={
              agendaRows.filter(
                (row) => row.status === "checked_in" || row.status === "completed",
              ).length
            }
            noShows={agendaRows.filter((row) => row.status === "no_show").length}
            services={agendaServices}
            upNext={agendaUpNext}
            fromLabel={t("calendarUi.fromTime", { time: agendaUpNext[0]?.time ?? "" })}
            onOpenDay={() => {
              if (!agendaDate) return;
              setCursor(agendaDate);
              setMode("day");
            }}
            openDayLabel={t("calendarUi.openDayIn", {
              date: calendarLabel(agendaDate ?? today, locale, "dayMonth"),
            })}
            emptyLabel={t("calendar.noSlotsDescription")}
            bookedLabel={t("calendarUi.bookedShort")}
            checkedInLabel={t("calendarUi.checkedIn")}
            noShowsLabel={t("calendarUi.noShows")}
            byServiceLabel={t("calendarUi.byService")}
            capacityLabel={t("calendarUi.capacityHeader")}
            upNextLabel={t("calendarUi.upNext")}
            statusLabel={statusText}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-4 lg:flex-row">
          <div className="min-w-0 flex-1">
            <YearGrid
              title={t("calendarUi.yearTitle", { year })}
              subtitle={t("calendarUi.yearSubtitle")}
              legend={
                <LoadLegend
                  variant="year"
                  labels={{
                    quiet: t("calendarUi.quiet"),
                    busy: t("calendarUi.busy"),
                    full: t("calendarUi.full"),
                    closed: t("calendarUi.closed"),
                  }}
                />
              }
              year={year}
              monthLabels={monthTotals.map((month) => month.label)}
              monthTotals={monthTotals.map((month, index) => ({
                booked: month.booked,
                isFuture: `${year}-${String(index + 1).padStart(2, "0")}` > today.slice(0, 7),
              }))}
              weekdayLabels={weekdayLabels}
              statFor={statFor}
              todayYmd={today}
              onOpenDay={(day) => {
                setCursor(day);
                setMode("day");
              }}
              onOpenMonth={(month) => {
                setCursor(`${year}-${String(month + 1).padStart(2, "0")}-01`);
                setMode("month");
              }}
              peakLabel={(day, count) => t("calendarUi.peak", { day, count })}
              bookedSuffix={t("calendarUi.bookedSuffix")}
            />
          </div>
          <YearInsights
            year={year}
            months={monthTotals.map((month, index) => ({
              ...month,
              isFuture: `${year}-${String(index + 1).padStart(2, "0")}` > today.slice(0, 7),
            }))}
            mix={mix.map((row) => ({ ...row, label: serviceName(row.key) }))}
            busiest={busiest.map((day, index) => ({
              rank: index + 1,
              label: calendarLabel(day.date, locale, "weekdayDayMonth"),
              booked: day.booked,
              capacityPct: day.capacity > 0 ? Math.round((day.booked / day.capacity) * 100) : 0,
            }))}
            labels={{
              byMonth: t("calendarUi.byMonth"),
              serviceMix: t("calendarUi.serviceMix"),
              share: t("calendarUi.shareOfBookings"),
              busiestDays: t("calendarUi.busiestDays"),
              topThree: t("calendarUi.topThree"),
              completed: t("calendarUi.legendCompleted"),
              thisMonth: t("calendarUi.thisMonth"),
              scheduled: t("calendarUi.scheduled"),
              ofCapacity: (pct) => t("calendarUi.ofCapacity", { pct: formatPct(pct) }),
            }}
          />
        </div>
      )}


      <BookingPopover
        open={popoverStatus != null && selected != null}
        onClose={() => setSelectedId(null)}
        visit={
          selected && popoverStatus
            ? {
                id: selected.id,
                name: selected.driver_name,
                phone: selected.driver_phone ?? "",
                serviceLabel: serviceName(selected.department_key),
                timeLabel: `${selected.slot_start?.slice(0, 5) ?? ""} – ${selected.slot_end?.slice(0, 5) ?? ""}`,
                status: popoverStatus,
              }
            : null
        }
        statusLabel={statusText}
        canOperate={canOperate}
        detailHref={selected ? `/visit-bookings/${selected.id}` : "/visit-bookings"}
        onCheckIn={() => void checkIn()}
        onReschedule={() => {
          if (!selected) return;
          setRescheduleFor(selected);
          setRescheduleDate(selected.scheduled_date);
          setRescheduleSlotId(selected.slot_id);
        }}
        labels={{
          service: t("calendarUi.fieldService"),
          time: t("calendarUi.fieldTime"),
          phone: t("calendarUi.fieldPhone"),
          status: t("calendarUi.fieldStatus"),
          checkIn: t("calendarUi.checkIn"),
          reschedule: t("calendarUi.reschedule"),
          close: t("calendarUi.close"),
        }}
      />
      <SlotPopover
        open={slotCell != null && slotTarget != null}
        onClose={() => setSlotTarget(null)}
        title={slotTarget ? `${formatYmd(slotTarget.ymd, locale, true)} · ${slotTarget.time}` : ""}
        subtitle={
          slotCell && slotTarget
            ? `${slotCell.rows.length} / ${slotCell.capacity} · ${slotTarget.time}`
            : ""
        }
        full={slotCell != null && slotCell.capacity > 0 && slotCell.rows.length >= slotCell.capacity}
        services={[...(slotCell?.counts.entries() ?? [])].map(([key, count]) => ({
          key,
          label: serviceName(key),
          count,
        }))}
        openDayLabel={t("calendarUi.openDay")}
        onOpenDay={() => {
          if (!slotTarget) return;
          setCursor(slotTarget.ymd);
          setMode("day");
          setSlotTarget(null);
        }}
      />
      {rescheduleFor ? (
        <div className={cn("fixed end-3 top-[22rem] z-50 w-[300px] rounded-xl border border-border bg-card p-3 shadow-sm")}>
          <label className="block text-xs text-muted-foreground">
            {t("calendarUi.rescheduleDate")}
            <input
              type="date"
              value={rescheduleDate}
              onChange={(event) => setRescheduleDate(event.target.value)}
              className="mt-1 h-9 w-full rounded-md border border-border bg-card px-2 text-sm"
            />
          </label>
          <label className="mt-2 block text-xs text-muted-foreground">
            {t("calendarUi.rescheduleSlot")}
            <select
              value={rescheduleSlotId}
              onChange={(event) => setRescheduleSlotId(event.target.value)}
              className="mt-1 h-9 w-full rounded-md border border-border bg-card px-2 text-sm"
            >
              <option value="">{t("calendarUi.rescheduleSlot")}</option>
              {slotChoices.map((slot) => (
                <option key={slot.id} value={slot.id}>
                  {slot.start_time.slice(0, 5)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="mt-2 h-9 rounded-md bg-[var(--portal-btn)] px-3 text-sm font-semibold text-white"
            onClick={() => void saveReschedule()}
          >
            {t("calendarUi.rescheduleSave")}
          </button>
        </div>
      ) : null}
    </AppPage>
  );
}
