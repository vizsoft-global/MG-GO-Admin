"use client";

import { useDeferredValue, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  Activity,
  AlertTriangle,
  CalendarDays,
  Check,
  CheckCheck,
  Clock,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  RefreshCw,
  X,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AppEmptyState, AppListCard, AppPage, AppPageHeader } from "@/components/app";
import {
  AppDataTable,
  AppDataTableRow,
  TableCell,
} from "@/components/app/app-data-table";
import {
  AppListControls,
  GroupedSections,
  fieldSearchMatch,
  groupRows,
  useListControlLabels,
  useListViewPrefs,
} from "@/components/app/app-list-controls";
import { ClearAllModuleButton } from "@/features/settings/clear-all-module-button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DATE_RANGE_ALL,
  DateRangeFilter,
  type DateRangeValue,
} from "@/components/app/date-range-filter";
import { SortableTableHeadLabel } from "@/components/app/sortable-table-head-label";
import { ToggleChip } from "@/components/app/toggle-chip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusPill } from "@/components/dashboard/status-pill";
import { useAuth } from "@/contexts/auth-context";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { kuwaitTodayYmd } from "@/lib/date/kuwait-dates";
import { queryKeys } from "@/lib/query/query-keys";
import { selectOptions, selectOptionsFrom } from "@/lib/select-items";
import { cn } from "@/lib/utils";
import {
  fetchAdminVisitsList,
  fetchVisitBranches,
  fetchVisitDepartments,
  fetchVisitSlots,
  updateAdminVisitStatus,
  updateAdminVisitStatusBulk,
  type VisitListRow,
} from "./visits-actions";
import { departmentLabel, kpiListQuery, type VisitKpiCard } from "./visit-board";
import { upcomingVisitCount } from "./visit-upcoming";
import {
  avatarTintClass,
  departmentBadgeClass,
  initialsOf,
  visitStatusVariant,
} from "./visit-status-utils";

type DataTab = "all" | "today" | "upcoming" | "past";

/**
 * Only a live booking can be acted on in bulk. Completed, cancelled and no-show rows are
 * already terminal, so selecting them would only produce per-row failures.
 */
const BULK_OPEN_STATUSES = new Set(["confirmed", "checked_in"]);

/** Bulk targets per action — check-in only applies to a booking that is still confirmed. */
const BULK_ACTIONS = [
  { status: "checked_in", from: ["confirmed"] },
  { status: "completed", from: ["checked_in"] },
  { status: "no_show", from: ["confirmed", "checked_in"] },
  { status: "cancelled", from: ["confirmed", "checked_in"] },
] as const;

type BulkStatus = (typeof BULK_ACTIONS)[number]["status"];

const STATUS_KEYS = [
  "confirmed",
  "checked_in",
  "completed",
  "no_show",
  "cancelled",
] as const;

function isoDate(d: string | null): string {
  return d ? d.slice(0, 10) : "";
}

/**
 * `2026-08-12` -> `12 Aug` (Figma column format). Built from parts because
 * `toLocaleDateString` puts the month first for en-US.
 */
function shortDate(value: string, locale: string): string {
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  const month = parsed.toLocaleDateString(locale, { month: "short" });
  return `${parsed.getDate()} ${month}`;
}

function toCsv(rows: VisitListRow[]): string {
  const header = [
    "Booking",
    "Rider",
    "Phone",
    "Branch",
    "Department",
    "Status",
    "Slot",
    "Date",
  ];
  const lines = rows.map((r) =>
    [
      r.booking_code,
      r.driver_name,
      r.driver_phone ?? "",
      r.branch_name ?? "",
      r.department_label,
      r.status,
      r.slot_start ? r.slot_start.slice(0, 5) : "",
      r.scheduled_date,
    ]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(","),
  );
  return [header.join(","), ...lines].join("\n");
}

export function VisitsPageShell() {
  const t = useTranslations("pages.visitBookings");
  const labels = useListControlLabels();
  const { prefs, update: updateListPrefs } = useListViewPrefs("visits");
  const locale = useLocale();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const { can } = useAuth();
  const canOperate = can("visits.operate");
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [tab, setTab] = useState<DataTab>("all");
  const [dateRange, setDateRange] = useState<DateRangeValue>(DATE_RANGE_ALL);
  const [branchFilter, setBranchFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [slotFilter, setSlotFilter] = useState("all");
  const [codeQuery, setCodeQuery] = useState("");
  const [driverQuery, setDriverQuery] = useState("");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<"code" | "date" | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc" | false>(false);
  const [kpiCard, setKpiCard] = useState<VisitKpiCard | null>(null);
  const savedRange = useRef<DateRangeValue | null>(null);
  const savedStatus = useRef<string | null>(null);
  const deptFilter = searchParams.get("department") ?? "all";
  const deferredCode = useDeferredValue(codeQuery);
  const deferredDriver = useDeferredValue(driverQuery);
  const today = kuwaitTodayYmd();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const kpiWindow = kpiCard ? kpiListQuery(kpiCard, today) : null;
  const serverNarrow =
    Boolean(kpiCard) ||
    deptFilter !== "all" ||
    branchFilter !== "all" ||
    statusFilter !== "all" ||
    slotFilter !== "all" ||
    deferredCode.trim() !== "" ||
    deferredDriver.trim() !== "" ||
    Boolean(dateRange.from || dateRange.to);
  const listQuery = kpiWindow
    ? {
        dateFrom: kpiWindow.dateFrom,
        dateTo: kpiWindow.dateTo ?? undefined,
        status: kpiWindow.status ?? undefined,
        department: deptFilter === "all" ? undefined : deptFilter,
        branch: branchFilter === "all" ? undefined : branchFilter,
        limit: 2000,
      }
    : {
        dateFrom: isoDate(dateRange.from) || undefined,
        dateTo: isoDate(dateRange.to) || undefined,
        status: statusFilter === "all" ? undefined : statusFilter,
        department: deptFilter === "all" ? undefined : deptFilter,
        branch: branchFilter === "all" ? undefined : branchFilter,
        driver: deferredDriver.trim() || undefined,
        code: deferredCode.trim() || undefined,
        slot: slotFilter === "all" ? undefined : slotFilter,
        limit: serverNarrow ? 2000 : 200,
      };

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: queryKeys.visits.list(listQuery),
    queryFn: () => fetchAdminVisitsList(listQuery),
  });

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

  const rows = useMemo(() => data?.rows ?? [], [data?.rows]);
  const kpi = data?.kpi;
  const upcomingCount = useMemo(() => upcomingVisitCount(rows, today), [rows, today]);

  const setDeptFilter = (key: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (key === "all") params.delete("department");
    else params.set("department", key);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  };

  const clearKpiRestore = () => {
    setKpiCard(null);
    savedRange.current = null;
    savedStatus.current = null;
  };

  const toggleKpi = (card: VisitKpiCard) => {
    if (kpiCard === card) {
      if (savedRange.current) setDateRange(savedRange.current);
      if (savedStatus.current != null) setStatusFilter(savedStatus.current);
      clearKpiRestore();
      return;
    }
    if (!kpiCard) {
      savedRange.current = dateRange;
      savedStatus.current = statusFilter;
    }
    setTab("all");
    setKpiCard(card);
  };

  const changeDateRange = (next: DateRangeValue) => {
    setDateRange(next);
    clearKpiRestore();
  };

  const changeStatus = (next: string) => {
    setStatusFilter(next);
    clearKpiRestore();
  };

  const selectTab = (id: DataTab) => {
    if (kpiCard) {
      if (savedRange.current) setDateRange(savedRange.current);
      if (savedStatus.current != null) setStatusFilter(savedStatus.current);
      clearKpiRestore();
    }
    setTab(id);
  };

  const onSort = (key: "code" | "date") => {
    if (sortKey !== key || !sortDir) {
      setSortKey(key);
      setSortDir("asc");
      return;
    }
    if (sortDir === "asc") {
      setSortDir("desc");
      return;
    }
    setSortKey(null);
    setSortDir(false);
  };

  const visibleRows = useMemo(() => {
    let list = rows;
    if (!kpiCard) {
      if (tab === "today") list = list.filter((r) => r.scheduled_date === today);
      else if (tab === "upcoming") list = list.filter((r) => r.scheduled_date > today);
      else if (tab === "past") list = list.filter((r) => r.scheduled_date < today);
      if (statusFilter !== "all") list = list.filter((r) => r.status === statusFilter);
      const from = isoDate(dateRange.from);
      const to = isoDate(dateRange.to);
      if (from) list = list.filter((r) => r.scheduled_date >= from);
      if (to) list = list.filter((r) => r.scheduled_date <= to);
    }
    if (branchFilter !== "all") list = list.filter((r) => r.branch_id === branchFilter);
    if (deptFilter !== "all") list = list.filter((r) => r.department_key === deptFilter);
    if (slotFilter !== "all") {
      list = list.filter((r) => (r.slot_start ?? "").slice(0, 5) === slotFilter);
    }
    const codeNeedle = codeQuery.trim().toLowerCase();
    if (codeNeedle) {
      list = list.filter((r) => r.booking_code.toLowerCase().includes(codeNeedle));
    }
    const driverNeedle = driverQuery.trim().toLowerCase();
    if (driverNeedle) {
      list = list.filter(
        (r) =>
          r.driver_name.toLowerCase().includes(driverNeedle) ||
          (r.driver_code ?? "").toLowerCase().includes(driverNeedle),
      );
    }
    list = list.filter((r) =>
      fieldSearchMatch(r, search, {
        name: (item) => item.driver_name,
        employee_id: (item) => item.driver_code,
        status: (item) => item.status,
        code: (item) => item.booking_code,
      }),
    );
    const effective = sortKey ?? (deptFilter !== "all" ? "date" : null);
    const direction = sortDir || (effective === "date" && sortKey == null ? "asc" : false);
    if (effective && direction) {
      list = [...list].sort((a, b) => {
        const left = effective === "code" ? a.booking_code : a.scheduled_date;
        const right = effective === "code" ? b.booking_code : b.scheduled_date;
        return direction === "asc" ? left.localeCompare(right) : right.localeCompare(left);
      });
    }
    return list;
  }, [
    rows,
    kpiCard,
    tab,
    today,
    statusFilter,
    dateRange,
    branchFilter,
    deptFilter,
    slotFilter,
    codeQuery,
    driverQuery,
    search,
    sortKey,
    sortDir,
  ]);

  const grouped = useMemo(
    () =>
      groupRows(
        visibleRows,
        prefs.groupBy,
        {
          status: (row) => row.status,
          date: (row) => row.scheduled_date,
        },
        Object.fromEntries(
          STATUS_KEYS.map((status) => [status, t(`status.${status}` as "status.confirmed")]),
        ),
        "—",
      ),
    [prefs.groupBy, t, visibleRows],
  );
  const visitColCount = canOperate ? 9 : 8;

  const setStatus = async (
    bookingId: string,
    status: "checked_in" | "completed" | "no_show" | "cancelled",
  ) => {
    setBusyId(bookingId);
    const result = await updateAdminVisitStatus({ bookingId, status });
    setBusyId(null);
    if (!result.ok) {
      toast.error(result.error ?? t("actionFailed"));
      return;
    }
    toast.success(t("actionOk"));
    await queryClient.invalidateQueries({ queryKey: queryKeys.visits.all() });
  };

  const selectableRows = useMemo(
    () => visibleRows.filter((r) => BULK_OPEN_STATUSES.has(r.status)),
    [visibleRows],
  );
  const selectedRows = useMemo(
    () => visibleRows.filter((r) => selected.has(r.id)),
    [visibleRows, selected],
  );

  const toggleRow = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = () =>
    setSelected((current) =>
      current.size === selectableRows.length
        ? new Set()
        : new Set(selectableRows.map((r) => r.id)),
    );

  const runBulk = async (status: BulkStatus) => {
    const action = BULK_ACTIONS.find((a) => a.status === status);
    const targets = selectedRows.filter((r) =>
      (action?.from as readonly string[]).includes(r.status),
    );
    if (targets.length === 0) return;

    setBulkBusy(true);
    const result = await updateAdminVisitStatusBulk({
      bookingIds: targets.map((r) => r.id),
      status,
    });
    setBulkBusy(false);

    if (result.error) {
      toast.error(result.error);
      return;
    }
    if (result.failed.length > 0) {
      toast.warning(
        t("bulk.partial", {
          done: `${result.succeeded.length}`,
          failed: `${result.failed.length}`,
        }),
      );
    } else {
      toast.success(t("bulk.done", { done: `${result.succeeded.length}` }));
    }
    setSelected(new Set());
    await queryClient.invalidateQueries({ queryKey: queryKeys.visits.all() });
  };

  const exportCsv = () => {
    const csv = toCsv(visibleRows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `visit-bookings-${today}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const pastCount = useMemo(
    () => rows.filter((r) => r.scheduled_date < today).length,
    [rows, today],
  );

  const TABS: { id: DataTab; label: string; count?: number }[] = [
    { id: "all", label: t("allVisits.tabAll"), count: rows.length },
    { id: "today", label: t("allVisits.tabToday"), count: kpi?.today },
    { id: "upcoming", label: t("allVisits.tabUpcoming"), count: upcomingCount },
    { id: "past", label: t("allVisits.tabPast"), count: pastCount },
  ];

  const branchItems = useMemo(
    () => [
      { value: "all", label: t("allVisits.filterAllBranches") },
      ...selectOptionsFrom(
        branchesData?.rows ?? [],
        (b) => b.id,
        (b) => b.name,
      ),
    ],
    [branchesData?.rows, t],
  );
  const departments = useMemo(
    () =>
      (deptData?.rows ?? [])
        .filter((dept) => dept.is_active)
        .sort((a, b) => a.sort_order - b.sort_order),
    [deptData?.rows],
  );
  const deptItems = useMemo(
    () => [
      { value: "all", label: t("allVisits.filterAllDepartments") },
      ...selectOptionsFrom(departments, (d) => d.key, (d) => departmentLabel(d, locale)),
    ],
    [departments, locale, t],
  );
  const slotItems = useMemo(() => {
    const times = new Set<string>();
    for (const slot of slotsData?.rows ?? []) {
      if (slot.start_time) times.add(slot.start_time.slice(0, 5));
    }
    return [
      { value: "all", label: t("allVisits.filterAllSlots") },
      ...[...times].sort().map((time) => ({ value: time, label: time })),
    ];
  }, [slotsData?.rows, t]);
  const statusItems = useMemo(
    () =>
      selectOptions([
        { value: "all", label: t("allVisits.filterAllStatus") },
        ...STATUS_KEYS.map((s) => ({
          value: s,
          label: t(`status.${s}` as "status.confirmed"),
        })),
      ]),
    [t],
  );

  return (
    <AppPage>
      <AppPageHeader
        breadcrumbs={[
          { label: t("title"), href: "/visit-bookings" },
          { label: t("allVisits.title") },
        ]}
        title={t("allVisits.title")}
        description={t("subtitle")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ClearAllModuleButton entity="visits" />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9"
              onClick={exportCsv}
            >
              <Download className="me-1.5 h-3.5 w-3.5" />
              {t("allVisits.export")}
            </Button>
            <Button variant="outline" size="sm" className="h-9" render={<Link href="/visit-bookings/calendar" />}>
              <CalendarDays className="me-1.5 h-3.5 w-3.5" />
              {t("nav.calendar")}
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

      <div className="flex flex-wrap items-center gap-2">
        <ToggleChip
          size="md"
          className="h-9"
          selected={deptFilter === "all"}
          onClick={() => setDeptFilter("all")}
        >
          {t("allVisits.departmentsAll")}
        </ToggleChip>
        {departments.map((dept) => (
          <ToggleChip
            key={dept.key}
            size="md"
            className="h-9"
            selected={deptFilter === dept.key}
            onClick={() => setDeptFilter(dept.key)}
          >
            {departmentLabel(dept, locale)}
          </ToggleChip>
        ))}
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <KpiTile
          active={kpiCard === "today"}
          onClick={() => toggleKpi("today")}
          icon={<FileText className="h-3.5 w-3.5" />}
          iconClass="bg-primary/10 text-primary"
          label={t("kpi.today")}
          value={kpi?.today ?? "—"}
          sub={t("allVisits.kpiTodaySub", { count: kpi?.today_checked_in ?? 0 })}
        />
        <KpiTile
          active={kpiCard === "upcoming"}
          onClick={() => toggleKpi("upcoming")}
          icon={<Clock className="h-3.5 w-3.5" />}
          iconClass="bg-warning/10 text-warning"
          label={t("kpi.upcoming")}
          value={kpi?.upcoming ?? "—"}
          sub={t("allVisits.kpiUpcomingSub")}
        />
        <KpiTile
          active={kpiCard === "awaiting"}
          onClick={() => toggleKpi("awaiting")}
          icon={<Activity className="h-3.5 w-3.5" />}
          iconClass="bg-primary/10 text-primary"
          label={t("kpi.awaitingCheckin")}
          value={kpi?.awaiting_checkin ?? "—"}
          sub={t("allVisits.kpiAwaitingSub")}
          accent="warning"
        />
        <KpiTile
          active={kpiCard === "no_shows"}
          onClick={() => toggleKpi("no_shows")}
          icon={<AlertTriangle className="h-3.5 w-3.5" />}
          iconClass="bg-danger/10 text-danger"
          label={t("kpi.noShows")}
          value={kpi?.no_shows ?? "—"}
          sub={t("allVisits.kpiNoShowsSub")}
          accent="danger"
        />
      </div>

      <div className="flex flex-wrap items-center gap-1 border-b border-border pb-0">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => selectTab(item.id)}
            className={cn(
              "flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              tab === item.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {item.label}
            {item.count != null ? (
              <span className="text-xs tabular-nums text-muted-foreground">{item.count}</span>
            ) : null}
          </button>
        ))}
      </div>

      <AppListControls
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder={t("allVisits.searchPlaceholder")}
        clearSearchLabel={labels.clearSearch}
        groupByOptions={[labels.group.none, labels.group.status, labels.group.date]}
        groupBy={prefs.groupBy}
        onGroupByChange={(value) => updateListPrefs({ groupBy: value })}
        groupByLabel={labels.groupBy}
        viewMode={prefs.viewMode}
        onViewModeChange={(value) => updateListPrefs({ viewMode: value })}
        tableViewLabel={labels.viewTable}
        cardsViewLabel={labels.viewCards}
        trailing={
          <p className="text-xs text-muted-foreground">
            {t("allVisits.countLabel", {
              shown: visibleRows.length,
              total: rows.length,
            })}
          </p>
        }
      />

      {canOperate && selected.size > 0 ? (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
          <p className="text-xs font-medium text-foreground">
            {t("bulk.selected", { count: `${selected.size}` })}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {BULK_ACTIONS.map((action) => {
              const count = selectedRows.filter((r) =>
                (action.from as readonly string[]).includes(r.status),
              ).length;
              const destructive =
                action.status === "cancelled" || action.status === "no_show";
              return (
                <Button
                  key={action.status}
                  type="button"
                  size="sm"
                  variant={destructive ? "ghost" : "default"}
                  className={cn(
                    "h-8",
                    destructive && "text-destructive hover:bg-destructive/10",
                  )}
                  disabled={count === 0 || bulkBusy}
                  onClick={() => void runBulk(action.status)}
                >
                  {t(`bulk.${action.status}` as "bulk.checked_in", { count: `${count}` })}
                </Button>
              );
            })}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8"
              onClick={() => setSelected(new Set())}
            >
              {t("bulk.clear")}
            </Button>
          </div>
        </div>
      ) : null}

      <AppListCard className="mt-2 p-0">
        {isLoading ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : visibleRows.length === 0 ? (
          <div className="flex min-h-48 items-center justify-center p-4">
            <AppEmptyState
              title={t("emptyTitle")}
              description={t("emptyDescription")}
            />
          </div>
        ) : prefs.viewMode === "cards" ? (
          <div className="p-4">
            <GroupedSections groups={grouped}>
              {(groupRowsList) => (
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {groupRowsList.map((row) => (
                    <Link
                      key={row.id}
                      href={`/visit-bookings/${row.id}`}
                      className="w-full rounded-xl border border-border bg-card p-4 text-start shadow-sm hover:bg-muted/40"
                    >
                      <p className="truncate text-sm font-semibold">{row.booking_code}</p>
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        {row.driver_name}
                        {row.driver_code ? ` · ${row.driver_code}` : ""}
                      </p>
                      <div className="mt-2">
                        <StatusPill variant={visitStatusVariant(row.status)} dot>
                          {t(`status.${row.status}` as "status.confirmed")}
                        </StatusPill>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </GroupedSections>
          </div>
        ) : (
          <AppDataTable
            columns={[
              ...(canOperate
                ? [
                    {
                      id: "select",
                      className: "w-10",
                      label: (
                        <Checkbox
                          aria-label={t("bulk.selectAll")}
                          checked={
                            selectableRows.length > 0 &&
                            selected.size === selectableRows.length
                          }
                          onCheckedChange={toggleAll}
                        />
                      ),
                    },
                  ]
                : []),
              {
                id: "code",
                label: (
                  <HeaderFilter label={t("allVisits.colVisId")}>
                    <SortableTableHeadLabel
                      className="h-7"
                      label={t("allVisits.sortCode")}
                      direction={sortKey === "code" ? sortDir : false}
                      onSort={() => onSort("code")}
                    />
                    <Input
                      className="h-9"
                      value={codeQuery}
                      placeholder={t("allVisits.filterVisId")}
                      onChange={(event) => setCodeQuery(event.target.value)}
                    />
                  </HeaderFilter>
                ),
              },
              {
                id: "driver",
                label: (
                  <HeaderFilter label={t("colDriver")}>
                    <Input
                      className="h-9"
                      value={driverQuery}
                      placeholder={t("allVisits.filterDriver")}
                      onChange={(event) => setDriverQuery(event.target.value)}
                    />
                  </HeaderFilter>
                ),
              },
              {
                id: "branch",
                label: (
                  <HeaderFilter label={t("colBranch")}>
                    <HeaderSelect
                      items={branchItems}
                      value={branchFilter}
                      onValueChange={setBranchFilter}
                    />
                  </HeaderFilter>
                ),
              },
              {
                id: "dept",
                label: (
                  <HeaderFilter label={t("colDepartment")}>
                    <HeaderSelect
                      items={deptItems}
                      value={deptFilter}
                      onValueChange={setDeptFilter}
                    />
                  </HeaderFilter>
                ),
              },
              {
                id: "status",
                label: (
                  <HeaderFilter label={t("colStatus")}>
                    <HeaderSelect
                      items={statusItems}
                      value={statusFilter}
                      onValueChange={changeStatus}
                    />
                  </HeaderFilter>
                ),
              },
              {
                id: "time",
                label: (
                  <HeaderFilter label={t("allVisits.colSlot")}>
                    <HeaderSelect
                      items={slotItems}
                      value={slotFilter}
                      onValueChange={setSlotFilter}
                    />
                  </HeaderFilter>
                ),
              },
              {
                id: "date",
                label: (
                  <HeaderFilter label={t("colDate")}>
                    <SortableTableHeadLabel
                      className="h-7"
                      label={t("allVisits.sortDate")}
                      direction={sortKey === "date" ? sortDir : false}
                      onSort={() => onSort("date")}
                    />
                    <DateRangeFilter
                      value={dateRange}
                      onChange={changeDateRange}
                      allowFutureDates
                    />
                  </HeaderFilter>
                ),
              },
              { id: "actions", label: t("colActions") },
            ]}
          >
            {grouped.flatMap((group) => [
              ...(prefs.groupBy !== "none"
                ? [
                    <AppDataTableRow key={`g-${group.key}`} className="hover:bg-transparent">
                      <TableCell
                        colSpan={visitColCount}
                        className="bg-muted/40 py-2 text-xs font-semibold text-foreground"
                      >
                        {group.label}
                        <span className="ms-2 rounded-full bg-muted px-1.5 text-xs tabular-nums text-muted-foreground">
                          {group.rows.length}
                        </span>
                      </TableCell>
                    </AppDataTableRow>,
                  ]
                : []),
              ...group.rows.map((row) => {
              const variant = visitStatusVariant(row.status);
              return (
                <AppDataTableRow key={row.id}>
                  {canOperate ? (
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      {BULK_OPEN_STATUSES.has(row.status) ? (
                        <Checkbox
                          aria-label={row.booking_code}
                          checked={selected.has(row.id)}
                          onCheckedChange={() => toggleRow(row.id)}
                        />
                      ) : null}
                    </TableCell>
                  ) : null}
                  <TableCell className="font-medium tabular-nums">
                    <Link
                      href={`/visit-bookings/${row.id}`}
                      className="text-primary hover:underline"
                    >
                      {row.booking_code}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                          avatarTintClass(row.driver_name),
                        )}
                      >
                        {initialsOf(row.driver_name)}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{row.driver_name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {row.driver_phone ?? row.driver_code}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {row.branch_name ?? "—"}
                  </TableCell>
                  <TableCell>
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
                        departmentBadgeClass(row.department_key),
                      )}
                    >
                      {row.department_label}
                    </span>
                  </TableCell>
                  <TableCell>
                    <StatusPill variant={variant} dot>
                      {t(`status.${row.status}` as "status.confirmed")}
                    </StatusPill>
                  </TableCell>
                  <TableCell className="text-sm tabular-nums text-muted-foreground">
                    {row.slot_start ? row.slot_start.slice(0, 5) : "—"}
                    {row.slot_end ? `–${row.slot_end.slice(0, 5)}` : ""}
                  </TableCell>
                  <TableCell
                    className="text-sm tabular-nums"
                    title={row.scheduled_date}
                  >
                    {shortDate(row.scheduled_date, locale)}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Link
                        href={`/visit-bookings/${row.id}`}
                        title={t("viewDetails")}
                        aria-label={t("viewDetails")}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-primary hover:bg-primary/10"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Link>
                      {canOperate && row.status === "confirmed" ? (
                        <>
                          <Button
                            type="button"
                            size="icon"
                            className="h-8 w-8"
                            title={t("checkIn")}
                            aria-label={t("checkIn")}
                            disabled={busyId === row.id}
                            onClick={() => void setStatus(row.id, "checked_in")}
                          >
                            <Check className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 text-destructive hover:bg-destructive/10"
                            title={t("cancel")}
                            aria-label={t("cancel")}
                            disabled={busyId === row.id}
                            onClick={() => void setStatus(row.id, "cancelled")}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      ) : canOperate && row.status === "checked_in" ? (
                        <Button
                          type="button"
                          size="icon"
                          className="h-8 w-8"
                          title={t("complete")}
                          aria-label={t("complete")}
                          disabled={busyId === row.id}
                          onClick={() => void setStatus(row.id, "completed")}
                        >
                          <CheckCheck className="h-3.5 w-3.5" />
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </AppDataTableRow>
              );
            }),
            ])}
          </AppDataTable>
        )}
      </AppListCard>
    </AppPage>
  );
}

function HeaderFilter({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-[8.5rem] flex-col gap-1 py-1">
      <span className="text-xs font-semibold text-accent">{label}</span>
      {children}
    </div>
  );
}

function HeaderSelect({
  items,
  value,
  onValueChange,
}: {
  items: { value: string; label: React.ReactNode }[];
  value: string;
  onValueChange: (value: string) => void;
}) {
  return (
    <Select items={items} value={value} onValueChange={(next) => next && onValueChange(next)}>
      <SelectTrigger className="h-9 w-full min-w-0 px-2 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function KpiTile({
  icon,
  iconClass,
  label,
  value,
  sub,
  accent,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  iconClass: string;
  label: string;
  value: string | number;
  sub: string;
  accent?: "warning" | "danger";
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "rounded-xl border border-border bg-card p-4 text-start shadow-sm",
        active && "ring-2 ring-primary",
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn("flex h-6 w-6 items-center justify-center rounded-md", iconClass)}
        >
          {icon}
        </span>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
      </div>
      <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-foreground">
        {value}
      </p>
      <p
        className={cn(
          "mt-0.5 text-xs",
          accent === "warning" && "text-warning",
          accent === "danger" && "text-danger",
          !accent && "text-muted-foreground",
        )}
      >
        {sub}
      </p>
    </button>
  );
}
