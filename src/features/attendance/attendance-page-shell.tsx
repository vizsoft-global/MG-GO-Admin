"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  BarChart3,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Edit3,
  ExternalLink,
  History,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import {
  AppEmptyState,
  AppListCard,
  AppPage,
  AppPageHeader,
  AppTableColumnPicker,
  SortableTableHeadLabel,
  VisibleTableCell,
} from "@/components/app";
import {
  AppDataTable,
  AppDataTableRow,
  TableCell,
} from "@/components/app/app-data-table";
import { KpiGrid } from "@/components/dashboard/kpi-grid";
import { TabBar } from "@/components/dashboard/tab-bar";
import { StatusPill } from "@/components/dashboard/status-pill";
import { TrackingTableToolbar } from "@/features/driver-tracking/table-toolbar";
import { downloadCsv } from "@/features/driver-tracking/csv-export";
import { Link } from "@/i18n/navigation";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { queryKeys } from "@/lib/query/query-keys";
import { useRealtimeInvalidator } from "@/lib/realtime/use-realtime-invalidator";
import { useTableColumnVisibility } from "@/hooks/use-table-column-visibility";
import { resolveStatusVariant } from "@/lib/ui/resolve-status-variant";
import { AttendanceAnalyticsPanel } from "./attendance-analytics-panel";
import { AttendanceCorrectionSheet } from "./attendance-correction-sheet";
import { AttendanceDriverExplorePanel } from "./attendance-driver-explore-panel";
import {
  AttendanceFiltersButton,
  AttendanceFiltersSheet,
  DEFAULT_ATTENDANCE_FILTERS,
  type AttendanceFiltersState,
} from "./attendance-filters-sheet";
import {
  ATTENDANCE_SORT_OPTIONS,
  EXCEPTION_TYPE_LABEL_KEYS,
  LIVE_STATUS_LABEL_KEYS,
  addDays,
  attendanceSortDirection,
  dailyRowToListRow,
  formatDateTimeKuwait,
  formatDurationSeconds,
  formatTimeKuwait,
  groupDailyRows,
  kuwaitToday,
  nextAttendanceSortKey,
  sortAttendanceDailyRows,
  type AttendanceSortColumn,
  type HistoryGroupKey,
} from "./attendance-list-utils";
import { AttendanceResolveSheet } from "./attendance-resolve-sheet";
import { AttendancePaginationFooter, AttendanceTableShell } from "./attendance-table-shell";
import { isAutoCheckoutReason } from "./auto-checkout-rules";
import { exportAttendanceDailyCsv } from "./attendance-reporting-actions";
import type {
  AttendanceDailyRow,
  AttendanceExceptionRow,
  AttendanceHubTab,
  AttendanceSortKey,
} from "./attendance-reporting-types";
import {
  useAttendanceDailyList,
  useAttendanceExceptionsList,
  useAttendanceReportingKpis,
} from "./use-attendance-table";
import {
  formatWorkingHoursList,
  resolveWorkingSeconds,
} from "./working-hours";

const PAGE_SIZE = 50;

function countActiveFilters(filters: AttendanceFiltersState): number {
  return [
    filters.partnerId,
    filters.zoneId,
    filters.restaurantId,
    filters.status !== "all" ? filters.status : "",
  ].filter(Boolean).length;
}

function AttendancePageContent() {
  const t = useTranslations("pages.attendance");
  const auth = useAuth();
  const canManage = auth.can("attendance.manage");
  const searchParams = useSearchParams();

  const today = kuwaitToday();
  const initialTab = (searchParams.get("tab") as AttendanceHubTab) ?? "today";

  const [tab, setTab] = useState<AttendanceHubTab>(
    ["today", "history", "problems", "analytics"].includes(initialTab)
      ? initialTab
      : "today",
  );
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filters, setFilters] = useState<AttendanceFiltersState>(DEFAULT_ATTENDANCE_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sortKey, setSortKey] = useState<AttendanceSortKey>(
    ATTENDANCE_SORT_OPTIONS[0].value,
  );
  const [page, setPage] = useState(0);
  const [fromDate, setFromDate] = useState(addDays(today, -6));
  const [toDate, setToDate] = useState(today);
  const [kpiFilter, setKpiFilter] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState<HistoryGroupKey>("none");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const [expandedRowKey, setExpandedRowKey] = useState<string | null>(null);
  const [exploreDate, setExploreDate] = useState("");
  const [resolveRow, setResolveRow] = useState<AttendanceExceptionRow | null>(null);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [correctionRow, setCorrectionRow] = useState<AttendanceDailyRow | null>(null);
  const [correctionOpen, setCorrectionOpen] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setPage(0);
    setExpandedRowKey(null);
  }, [tab, debouncedSearch, filters, sortKey, fromDate, toDate, kpiFilter]);

  useEffect(() => {
    setExpandedRowKey(null);
  }, [page]);

  useEffect(() => {
    if (tab !== "history" && (sortKey === "date_asc" || sortKey === "date_desc")) {
      setSortKey("problems_first");
    }
  }, [tab, sortKey]);

  const statusFilter = kpiFilter ?? (filters.status !== "all" ? filters.status : undefined);

  const dailyFilters = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      partnerId: filters.partnerId || undefined,
      zoneId: filters.zoneId || undefined,
      restaurantId: filters.restaurantId || undefined,
      status: statusFilter,
      fromDate: tab === "today" ? today : fromDate,
      toDate: tab === "today" ? today : toDate,
      liveOnly: tab === "today",
      sort: sortKey,
      page,
      pageSize: PAGE_SIZE,
    }),
    [
      debouncedSearch,
      filters,
      statusFilter,
      tab,
      today,
      fromDate,
      toDate,
      sortKey,
      page,
    ],
  );

  const kpiScope = useMemo(
    () => ({
      partnerId: filters.partnerId || undefined,
      zoneId: filters.zoneId || undefined,
      restaurantId: filters.restaurantId || undefined,
    }),
    [filters],
  );

  const dailyEnabled = tab === "today" || tab === "history";
  const { data: dailyData, isLoading: dailyLoading, refetch: refetchDaily } =
    useAttendanceDailyList(dailyFilters, {
      enabled: dailyEnabled,
      refetchInterval: tab === "today" ? 30_000 : false,
    });

  const { data: kpis, refetch: refetchKpis } = useAttendanceReportingKpis(
    today,
    kpiScope,
    tab === "today",
  );

  const { data: exceptionsData, isLoading: exceptionsLoading, refetch: refetchExceptions } =
    useAttendanceExceptionsList(
      {
        date: today,
        search: debouncedSearch || undefined,
        unresolvedOnly: true,
        page,
        pageSize: PAGE_SIZE,
      },
      tab === "problems",
    );

  useRealtimeInvalidator({
    channel: "admin-attendance-hub",
    enabled: tab === "today",
    tables: [
      { table: "attendance_logs" },
      { table: "driver_attendance" },
      { table: "drivers" },
      { table: "driver_sessions" },
    ],
    invalidateKeys: [queryKeys.attendance.all()],
  });

  const sortItems = ATTENDANCE_SORT_OPTIONS.map((o) => ({
    value: o.value,
    label: t(o.labelKey),
  }));

  const columnVisibilityOptions = useMemo(
    () => [
      { id: "driver", label: t("colDriver"), locked: true },
      { id: "date", label: t("colDate") },
      { id: "status", label: t("colStatus") },
      { id: "checkIn", label: t("colCheckIn") },
      { id: "checkOut", label: t("colCheckOut") },
      { id: "workingHours", label: t("colWorkingHours") },
      { id: "onDuty", label: t("colOnDuty") },
      { id: "lastSeen", label: t("colLastSeen") },
      { id: "actions", label: t("colActions"), locked: true },
    ],
    [t],
  );
  const {
    isVisible: isColumnVisible,
    toggle: toggleColumn,
    reset: resetColumns,
    pickerOptions: columnPickerOptions,
  } = useTableColumnVisibility(
    "dpd:attendance:list-columns",
    columnVisibilityOptions,
  );
  const availableColumnPickerOptions = columnPickerOptions.filter(
    (option) => tab === "history" || option.id !== "date",
  );
  const availableHiddenColumnCount = availableColumnPickerOptions.filter(
    (option) => !isColumnVisible(option.id),
  ).length;

  const tabItems = [
    { id: "today", label: t("tabToday"), icon: CalendarDays },
    { id: "history", label: t("tabHistory"), icon: History },
    { id: "problems", label: t("tabProblems"), icon: AlertTriangle },
    { id: "analytics", label: t("tabAnalytics"), icon: BarChart3 },
  ];

  const kpiItems = kpis
    ? [
        {
          label: t("kpiScheduled"),
          value: kpis.scheduled,
          accent: "default" as const,
          filterKey: "scheduled",
        },
        {
          label: t("kpiCheckedIn"),
          value: kpis.checked_in,
          accent: "success" as const,
          filterKey: "checked_in",
        },
        {
          label: t("kpiLate"),
          value: kpis.late,
          accent: "warning" as const,
          filterKey: "late",
        },
        {
          label: t("kpiAbsent"),
          value: kpis.absent,
          accent: "danger" as const,
          filterKey: "absent",
        },
        {
          label: t("kpiOnline"),
          value: kpis.online,
          accent: "primary" as const,
          filterKey: "online",
        },
        {
          label: t("kpiProblems"),
          value: kpis.problems,
          accent: "warning" as const,
          filterKey: "problems",
        },
      ]
    : [];

  async function handleRefresh() {
    setIsRefreshing(true);
    await Promise.all([
      dailyEnabled ? refetchDaily() : Promise.resolve(),
      tab === "today" ? refetchKpis() : Promise.resolve(),
      tab === "problems" ? refetchExceptions() : Promise.resolve(),
    ]);
    setIsRefreshing(false);
  }

  async function handleExport() {
    setIsExporting(true);
    toast.message(t("exportPreparing"));
    try {
      const csv =
        tab === "problems"
          ? await exportAttendanceDailyCsv({
              ...dailyFilters,
              status: "problems",
              liveOnly: true,
            })
          : await exportAttendanceDailyCsv(dailyFilters);
      downloadCsv(`attendance-${tab}-${today}.csv`, csv);
    } catch {
      toast.error(t("exportFailed"));
    } finally {
      setIsExporting(false);
    }
  }

  function toggleExplore(row: AttendanceDailyRow) {
    const key = `${row.driver_id}:${row.log_date}`;
    if (expandedRowKey === key) {
      setExpandedRowKey(null);
      return;
    }
    setExpandedRowKey(key);
    setExploreDate(row.log_date);
  }

  function renderDailyRow(row: AttendanceDailyRow) {
    const rowKey = `${row.driver_id}:${row.log_date}`;
    const expanded = expandedRowKey === rowKey;
    const liveLabelKey = LIVE_STATUS_LABEL_KEYS[row.live_status] ?? "livePresent";
    const colSpan =
      2 +
      [
        ...(tab === "history" ? ["date"] : []),
        "status",
        "checkIn",
        "checkOut",
        "workingHours",
        "onDuty",
        "lastSeen",
      ].filter(isColumnVisible).length;

    return (
      <Fragment key={rowKey}>
        <AppDataTableRow>
          <TableCell>
            <button
              type="button"
              className="me-2 inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-muted/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97]"
              onClick={() => toggleExplore(row)}
              aria-expanded={expanded}
              aria-label={expanded ? t("collapseDetail") : t("exploreDetail")}
            >
              {expanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </button>
            <div className="inline-block align-middle">
              <p className="font-medium">{row.driver_name}</p>
              <p className="text-xs text-muted-foreground">{row.driver_code}</p>
            </div>
          </TableCell>
          {tab === "history" ? (
            <VisibleTableCell
              columnId="date"
              isVisible={isColumnVisible}
              className="whitespace-nowrap"
            >
              {row.log_date}
            </VisibleTableCell>
          ) : null}
          <VisibleTableCell columnId="status" isVisible={isColumnVisible}>
            <StatusPill variant={resolveStatusVariant(row.live_status)}>
              {t(liveLabelKey)}
            </StatusPill>
          </VisibleTableCell>
          <VisibleTableCell
            columnId="checkIn"
            isVisible={isColumnVisible}
            className="whitespace-nowrap"
          >
            {formatTimeKuwait(row.check_in_at)}
          </VisibleTableCell>
          <VisibleTableCell
            columnId="checkOut"
            isVisible={isColumnVisible}
            className="whitespace-nowrap"
          >
            <div className="flex flex-col gap-0.5">
              <span>{formatTimeKuwait(row.check_out_at)}</span>
              {isAutoCheckoutReason(row.check_out_reason) ? (
                <span className="w-fit rounded border border-amber-200 bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                  {t("autoCheckoutBadge")}
                </span>
              ) : null}
            </div>
          </VisibleTableCell>
          <VisibleTableCell
            columnId="workingHours"
            isVisible={isColumnVisible}
            className="whitespace-nowrap tabular-nums"
          >
            {formatWorkingHoursList(
              resolveWorkingSeconds({
                dutySeconds: row.duty_seconds,
                checkInAt: row.check_in_at,
                checkOutAt: row.check_out_at,
              }),
              formatDurationSeconds,
            )}
          </VisibleTableCell>
          <VisibleTableCell columnId="onDuty" isVisible={isColumnVisible}>
            {row.is_on_duty ? (
              <StatusPill variant="success">{t("onDuty")}</StatusPill>
            ) : (
              <span className="text-muted-foreground">{t("offDuty")}</span>
            )}
          </VisibleTableCell>
          <VisibleTableCell
            columnId="lastSeen"
            isVisible={isColumnVisible}
            className="whitespace-nowrap text-muted-foreground"
          >
            {formatDateTimeKuwait(row.last_seen_at)}
          </VisibleTableCell>
          <TableCell>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-primary hover:bg-primary/10"
                render={
                  <Link href={`/attendance/drivers/${row.driver_id}?date=${row.log_date}`} />
                }
                aria-label={t("viewDetail")}
              >
                <ExternalLink className="h-4 w-4" />
              </Button>
              {canManage ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => {
                    setCorrectionRow(row);
                    setCorrectionOpen(true);
                  }}
                  aria-label={t("correct")}
                >
                  <Edit3 className="h-4 w-4" />
                </Button>
              ) : null}
            </div>
          </TableCell>
        </AppDataTableRow>
        {expanded ? (
          <AppDataTableRow className="bg-muted/20 hover:bg-muted/20">
            <TableCell colSpan={colSpan} className="p-0">
              <div className="border-t border-border px-4 py-3">
                <AttendanceDriverExplorePanel
                  driverId={row.driver_id}
                  date={exploreDate || row.log_date}
                  onDateChange={setExploreDate}
                  className="max-w-5xl"
                />
              </div>
            </TableCell>
          </AppDataTableRow>
        ) : null}
      </Fragment>
    );
  }

  const dailyRows = useMemo(
    () => sortAttendanceDailyRows(dailyData?.rows ?? [], sortKey),
    [dailyData?.rows, sortKey],
  );
  const groupedSections =
    tab === "history" && groupBy !== "none"
      ? groupDailyRows(dailyRows, groupBy)
      : [{ key: "all", label: "", rows: dailyRows }];

  const sortColumnHeader = (column: AttendanceSortColumn, label: string) => (
    <SortableTableHeadLabel
      label={label}
      direction={attendanceSortDirection(sortKey, column)}
      onSort={() => setSortKey((prev) => nextAttendanceSortKey(prev, column))}
    />
  );

  const dailyColumns = (
    tab === "history"
      ? [
          { id: "driver", label: sortColumnHeader("driver", t("colDriver")) },
          { id: "date", label: sortColumnHeader("date", t("colDate")) },
          { id: "status", label: sortColumnHeader("status", t("colStatus")) },
          { id: "checkIn", label: sortColumnHeader("check_in", t("colCheckIn")) },
          { id: "checkOut", label: sortColumnHeader("check_out", t("colCheckOut")) },
          {
            id: "workingHours",
            label: sortColumnHeader("duty_seconds", t("colWorkingHours")),
          },
          { id: "onDuty", label: sortColumnHeader("on_duty", t("colOnDuty")) },
          { id: "lastSeen", label: sortColumnHeader("last_seen", t("colLastSeen")) },
          { id: "actions", label: t("colActions") },
        ]
      : [
          { id: "driver", label: sortColumnHeader("driver", t("colDriver")) },
          { id: "status", label: sortColumnHeader("status", t("colStatus")) },
          { id: "checkIn", label: sortColumnHeader("check_in", t("colCheckIn")) },
          { id: "checkOut", label: sortColumnHeader("check_out", t("colCheckOut")) },
          {
            id: "workingHours",
            label: sortColumnHeader("duty_seconds", t("colWorkingHours")),
          },
          { id: "onDuty", label: sortColumnHeader("on_duty", t("colOnDuty")) },
          { id: "lastSeen", label: sortColumnHeader("last_seen", t("colLastSeen")) },
          { id: "actions", label: t("colActions") },
        ]
  ).filter((column) => isColumnVisible(column.id));

  const problemsColumns = [
    { id: "driver", label: t("colDriver") },
    { id: "problem", label: t("colProblem") },
    { id: "since", label: t("colSince") },
    { id: "status", label: t("colStatus") },
    { id: "actions", label: t("colActions") },
  ];

  const totalCount =
    tab === "problems"
      ? (exceptionsData?.totalCount ?? 0)
      : (dailyData?.totalCount ?? 0);

  const isLoading = tab === "problems" ? exceptionsLoading : dailyLoading;
  const isEmpty = !isLoading && totalCount === 0;

  return (
    <AppPage>
      <AppPageHeader title={t("title")} description={t("subtitle")} />
      <TabBar
        items={tabItems}
        activeId={tab}
        onSelect={(id) => setTab(id as AttendanceHubTab)}
        className="mb-4"
      />

      <AppListCard>
        {tab === "analytics" ? (
          <div className="space-y-4 p-1">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="w-[140px]"
                aria-label={t("fromDate")}
              />
              <span className="text-sm text-muted-foreground">{t("to")}</span>
              <Input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="w-[140px]"
                aria-label={t("toDate")}
              />
            </div>
            <AttendanceAnalyticsPanel fromDate={fromDate} toDate={toDate} />
          </div>
        ) : (
          <AttendanceTableShell
            kpis={
              tab === "today" && kpis ? (
                <div className="px-1 pb-2">
                  <KpiGrid
                    items={kpiItems.map((k) => ({
                      label: k.label,
                      value: k.value,
                      accent: k.accent,
                    }))}
                  />
                  <div className="mt-2 flex flex-wrap gap-2">
                    {kpiItems.map((k) => (
                      <Button
                        key={k.filterKey}
                        type="button"
                        size="sm"
                        variant={kpiFilter === k.filterKey ? "default" : "outline"}
                        onClick={() =>
                          setKpiFilter((prev) =>
                            prev === k.filterKey ? null : k.filterKey,
                          )
                        }
                      >
                        {k.label}
                      </Button>
                    ))}
                    {kpiFilter ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setKpiFilter(null)}
                      >
                        {t("clearFilters")}
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : undefined
            }
            toolbar={
              <div className="space-y-3 px-1">
                <TrackingTableToolbar
                  search={search}
                  onSearchChange={setSearch}
                  searchPlaceholder={t("searchPlaceholder")}
                  sortValue={sortKey}
                  onSortChange={(v) => {
                    if (!v) return;
                    setSortKey(v as AttendanceSortKey);
                  }}
                  sortItems={sortItems}
                  sortVariant="menu"
                  sortLabel={t("sortBy")}
                  resultSummary={t("showingCount", {
                    visible:
                      tab === "problems"
                        ? (exceptionsData?.rows.length ?? 0)
                        : dailyRows.length,
                    total: totalCount,
                  })}
                  onRefresh={() => void handleRefresh()}
                  isRefreshing={isRefreshing}
                  refreshLabel={t("refresh")}
                  onExport={() => void handleExport()}
                  exportDisabled={isExporting}
                  exportLabel={t("export")}
                  showExportLabel
                  dateSlot={
                    tab === "history" ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <Input
                          type="date"
                          value={fromDate}
                          onChange={(e) => setFromDate(e.target.value)}
                          className="w-[140px]"
                          aria-label={t("fromDate")}
                        />
                        <span className="text-sm text-muted-foreground">{t("to")}</span>
                        <Input
                          type="date"
                          value={toDate}
                          onChange={(e) => setToDate(e.target.value)}
                          className="w-[140px]"
                          aria-label={t("toDate")}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setFromDate(addDays(today, -6));
                            setToDate(today);
                          }}
                        >
                          {t("last7Days")}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setFromDate(addDays(today, -29));
                            setToDate(today);
                          }}
                        >
                          {t("last30Days")}
                        </Button>
                      </div>
                    ) : undefined
                  }
                  filterSlot={
                    <>
                      <AttendanceFiltersButton
                        activeCount={countActiveFilters(filters)}
                        onClick={() => setFiltersOpen(true)}
                      />
                      {dailyEnabled ? (
                        <AppTableColumnPicker
                          options={availableColumnPickerOptions}
                          isVisible={isColumnVisible}
                          onToggle={toggleColumn}
                          onReset={resetColumns}
                          hiddenCount={availableHiddenColumnCount}
                        />
                      ) : null}
                      {tab === "history" ? (
                        <Select
                          value={groupBy}
                          onValueChange={(v) => v && setGroupBy(v as HistoryGroupKey)}
                        >
                          <SelectTrigger className="w-[160px]">
                            <SelectValue placeholder={t("groupBy")} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">{t("groupNone")}</SelectItem>
                            <SelectItem value="partner">{t("groupPartner")}</SelectItem>
                            <SelectItem value="date">{t("groupDate")}</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : null}
                    </>
                  }
                />
              </div>
            }
            isEmpty={isEmpty}
            empty={
              <AppEmptyState
                title={
                  tab === "today"
                    ? t("emptyToday")
                    : tab === "history"
                      ? t("emptyHistory")
                      : t("emptyProblems")
                }
                description={t("emptyFiltersHint")}
              />
            }
            footer={
              <AttendancePaginationFooter
                page={page}
                pageSize={PAGE_SIZE}
                totalCount={totalCount}
                onPageChange={setPage}
              />
            }
          >
            {isLoading ? (
              <div className="flex justify-center py-16">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : tab === "problems" ? (
              <AppDataTable columns={problemsColumns}>
                {(exceptionsData?.rows ?? []).map((row) => {
                  const typeKey =
                    EXCEPTION_TYPE_LABEL_KEYS[row.exception_type] ?? row.exception_type;
                  return (
                    <AppDataTableRow key={row.exception_key}>
                      <TableCell>
                        <p className="font-medium">{row.driver_name}</p>
                        <p className="text-xs text-muted-foreground">{row.driver_code}</p>
                      </TableCell>
                      <TableCell>{t(typeKey)}</TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatDateTimeKuwait(row.detected_at)}
                      </TableCell>
                      <TableCell>
                        <StatusPill
                          variant={resolveStatusVariant(row.resolution_status ?? "open")}
                        >
                          {row.resolution_status ?? t("resolutionOpen")}
                        </StatusPill>
                      </TableCell>
                      <TableCell>
                        {canManage ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setResolveRow(row);
                              setResolveOpen(true);
                            }}
                          >
                            {t("resolve")}
                          </Button>
                        ) : null}
                      </TableCell>
                    </AppDataTableRow>
                  );
                })}
              </AppDataTable>
            ) : (
              groupedSections.map((section) => (
                <div key={section.key}>
                  {section.label ? (
                    <p className="border-b border-border bg-muted/20 px-4 py-2 text-sm font-semibold">
                      {section.label}
                    </p>
                  ) : null}
                  <AppDataTable columns={dailyColumns}>
                    {section.rows.map((row) => renderDailyRow(row))}
                  </AppDataTable>
                </div>
              ))
            )}
          </AttendanceTableShell>
        )}
      </AppListCard>

      <AttendanceFiltersSheet
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        filters={filters}
        onApply={setFilters}
        showStatus={tab !== "problems"}
      />
      <AttendanceResolveSheet row={resolveRow} open={resolveOpen} onOpenChange={setResolveOpen} />
      <AttendanceCorrectionSheet
        row={correctionRow ? dailyRowToListRow(correctionRow) : null}
        open={correctionOpen}
        onOpenChange={setCorrectionOpen}
        createMode={!correctionRow?.attendance_log_id}
      />
    </AppPage>
  );
}

export function AttendancePageShell() {
  return <AttendancePageContent />;
}
