"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useRouter, Link } from "@/i18n/navigation";
import { useSearchParams } from "next/navigation";
import {
  ArchiveRestore,
  CheckCircle2,
  Download,
  Eye,
  FilterX,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { AppListCard, AppPage } from "@/components/app";
import {
  AppDataTable,
  AppDataTableEmpty,
  AppDataTableRow,
  AppTableColumnPicker,
  TableCell,
  VisibleTableCell,
} from "@/components/app";
import { AppEmptyState } from "@/components/app/app-empty-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useHasMounted } from "@/hooks/use-has-mounted";
import { cn } from "@/lib/utils";
import { useCustomFieldDefinitions } from "@/features/custom-fields/use-custom-fields";
import { customFieldColumnId, type CustomFieldDefinition } from "@/lib/custom-fields/types";
import { formatCustomFieldDisplay } from "@/lib/custom-fields/validate";
import { useDriversListColumns } from "./use-drivers-list-columns";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/query-keys";
import { useRealtimeInvalidator } from "@/lib/realtime/use-realtime-invalidator";
import { fetchDriverDetail } from "./drivers-actions";
import { fetchDriversForExport } from "./drivers-list-actions";
import { useAuth } from "@/contexts/auth-context";
import { useApproveDriverIntake, useDriverDetail, useRestoreDriverIntake } from "./use-drivers";
import { useDriversPage } from "./use-drivers-page";
import { DriverBulkImportDialog } from "./import/bulk-import-dialog";
import { DriversExportDialog } from "./export-drivers-dialog";
import { isDriverErrorKey } from "./driver-errors";
import { StatusPill } from "@/components/dashboard/status-pill";
import {
  AccountStatusPill,
  AttendancePill,
  formatDriverCodeDisplay,
  formatPhoneInternational,
  PasscodeCell,
  RestaurantsCell,
} from "./driver-list-ui";
import { DriverFormSheet } from "./driver-form-sheet";
import { DriverEditSheet } from "./driver-edit-sheet";
import { DriversKpiStrip } from "./drivers-kpi-strip";
import { DriversColumnHeader, type DriversHeaderLabels } from "./drivers-column-header";
import {
  DEFAULT_DRIVERS_SORT,
  DRIVERS_FILTER_KINDS,
  countActiveFilters,
  customFilterColumn,
  nextSort,
  withColumnFilter,
  type DriversColumnFilters,
  type DriversFixedColumn,
  type DriversSort,
  type DriversTab,
} from "./drivers-list-query";
import { riderCategoryMessageKey } from "./driver-rider-category";
import { type DriverAccountStatus, type DriverListPageRow } from "./types";

function shouldIgnoreRowNavigation(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.closest(
      'button, a, input, select, textarea, [role="checkbox"], [data-no-row-nav]',
    ),
  );
}

/** Table column id → server filter/sort column. Passcode, select and actions have none. */
const COLUMN_FILTER_KEY: Record<string, DriversFixedColumn> = {
  driverId: "driverId",
  employeeId: "mgId",
  riderCategory: "riderCategory",
  companyClientId: "companyClientId",
  companyName: "companyName",
  name: "name",
  phone: "phone",
  restaurants: "restaurants",
  zone: "zone",
  clientId: "platformId",
  clientName: "platformName",
  todayDeliveries: "todayDeliveries",
  status: "status",
  attendance: "attendance",
};

function customFilterKind(def: CustomFieldDefinition): "text" | "list" {
  return def.field_type === "select" || def.field_type === "checkbox" ? "list" : "text";
}

const EMPTY_KPIS = {
  total: 0,
  activeToday: 0,
  onlineNow: 0,
  inactive: 0,
  pendingVerification: 0,
  suspended: 0,
};

function DriversPageSkeleton() {
  return (
    <div className="flex h-48 items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}

function CompanyNameCell({ row, unassigned }: { row: DriverListPageRow; unassigned: string }) {
  if (row.company_tone === "unassigned") {
    return (
      <Badge variant="outline" className="border-amber-200 bg-amber-100 text-amber-800">
        {unassigned}
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className={cn(
        "max-w-[160px] truncate",
        row.company_tone === "mg"
          ? "border-primary/20 bg-primary/10 text-primary"
          : "border-border bg-muted/40 text-foreground",
      )}
    >
      {row.company_name}
    </Badge>
  );
}

function CompanyClientIdCell({ row, notSet }: { row: DriverListPageRow; notSet: string }) {
  if (row.company_tone === "unassigned") return <span className="text-muted-foreground">—</span>;
  if (!row.company_client_code) {
    return (
      <Badge variant="outline" className="border-amber-200 bg-amber-100 text-amber-800">
        {notSet}
      </Badge>
    );
  }
  return <span className="font-mono text-sm text-muted-foreground">{row.company_client_code}</span>;
}

function DriversPageContent() {
  const t = useTranslations("pages.drivers");
  const tCommon = useTranslations("common");
  const { can } = useAuth();
  const canCreate = can("drivers.create");
  const canEdit = can("drivers.edit");
  const { data: customFieldDefs } = useCustomFieldDefinitions();
  const activeCustomDefs = useMemo(
    () => (customFieldDefs ?? []).filter((d) => d.is_active && !d.archived_at),
    [customFieldDefs],
  );
  const approveDriver = useApproveDriverIntake();
  const restoreDriver = useRestoreDriverIntake();
  const [bulkOpen, setBulkOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const router = useRouter();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const [tabFilter, setTabFilter] = useState<DriversTab>("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [columnFilters, setColumnFilters] = useState<DriversColumnFilters>({});
  const [sort, setSort] = useState<DriversSort>(DEFAULT_DRIVERS_SORT);

  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(id);
  }, [search]);

  const query = useMemo(
    () => ({ tab: tabFilter, search: debouncedSearch, filters: columnFilters, sort }),
    [tabFilter, debouncedSearch, columnFilters, sort],
  );
  const pageQuery = useDriversPage(query);
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = pageQuery;
  const drivers = useMemo(
    () => pageQuery.data?.pages.flatMap((p) => p.rows) ?? [],
    [pageQuery.data],
  );
  const firstPage = pageQuery.data?.pages[0];
  const kpiCounts = firstPage?.kpis ?? EMPTY_KPIS;
  const filteredTotal = firstPage?.filteredTotal ?? 0;
  const tabTotal = firstPage?.tabTotal ?? 0;
  const isLoading = pageQuery.isLoading;

  useRealtimeInvalidator({
    channel: "admin-drivers-list",
    tables: [
      { table: "drivers" },
      { table: "driver_intakes" },
      { table: "driver_restaurants" },
      { table: "driver_intake_restaurants" },
    ],
    invalidateKeys: [queryKeys.drivers.all()],
  });

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [quickEditId, setQuickEditId] = useState<string | null>(null);
  const loadMoreRef = useRef<HTMLTableRowElement | null>(null);
  const quickEditQuery = useDriverDetail(quickEditId ?? "");
  const quickEditDriver = quickEditQuery.data ?? null;

  const prefetchDriverDetail = (driverId: string) => {
    void queryClient.prefetchQuery({
      queryKey: queryKeys.drivers.detail(driverId),
      queryFn: () => fetchDriverDetail(driverId),
      staleTime: 60_000,
    });
  };

  useEffect(() => {
    if (searchParams.get("add") === "1") {
      setAddOpen(true);
      router.replace("/drivers");
      return;
    }
    if (searchParams.get("import") === "1") {
      setBulkOpen(true);
      router.replace("/drivers");
    }
  }, [searchParams, router]);

  useEffect(() => {
    if (!quickEditId) return;
    if (quickEditQuery.isError) {
      toast.error(t("notFoundTitle"));
      setQuickEditId(null);
      return;
    }
    if (!quickEditQuery.isSuccess || !quickEditDriver) return;
    if (!quickEditDriver.intake_id || quickEditDriver.archived_at) {
      toast.error(t("notFoundTitle"));
      setQuickEditId(null);
    }
  }, [
    quickEditId,
    quickEditQuery.isError,
    quickEditQuery.isSuccess,
    quickEditDriver,
    t,
  ]);

  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el || !hasNextPage) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !isFetchingNextPage) void fetchNextPage();
      },
      { rootMargin: "240px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, drivers.length]);

  const activeFilterCount = countActiveFilters(columnFilters);

  function accountStatusLabelFor(status: DriverAccountStatus) {
    switch (status) {
      case "active":
        return t("statusActive");
      case "suspended":
        return t("statusSuspended");
      case "pending":
        return t("statusPendingAccount");
      default:
        return status;
    }
  }

  const accountStatusLabel = accountStatusLabelFor;

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await pageQuery.refetch();
    } finally {
      setIsRefreshing(false);
    }
  };

  const hasNarrowing = activeFilterCount > 0 || debouncedSearch !== "";
  const showEmptySearch = !isLoading && drivers.length === 0 && (hasNarrowing || tabTotal > 0);
  const showEmptyAll = !isLoading && drivers.length === 0 && !showEmptySearch;

  const allVisibleSelected =
    drivers.length > 0 && drivers.every((d) => selectedIds.has(d.id));

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) =>
      drivers.length > 0 && drivers.every((d) => prev.has(d.id))
        ? new Set()
        : new Set(drivers.map((d) => d.id)),
    );
  }, [drivers]);

  const toggleRow = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const columnVisibilityOptions = useMemo(
    () => [
      { id: "select", label: t("selectAll"), locked: true as const },
      { id: "driverId", label: t("colDriverId") },
      { id: "employeeId", label: t("colEmployeeId") },
      { id: "riderCategory", label: t("colRiderCategory") },
      { id: "companyClientId", label: t("colCompanyClientId") },
      { id: "companyName", label: t("colCompanyName") },
      { id: "name", label: t("colName") },
      { id: "phone", label: t("colPhone") },
      { id: "restaurants", label: t("colRestaurants") },
      { id: "zone", label: t("colZone") },
      // Off by default: most operations never reference a platform, and the
      // list already runs to the edge of a 14" viewport.
      { id: "clientId", label: t("colClientId"), defaultVisible: false as const },
      { id: "clientName", label: t("colClientName"), defaultVisible: false as const },
      { id: "todayDeliveries", label: t("colTodayDeliveries") },
      { id: "status", label: t("colStatus") },
      { id: "attendance", label: t("colAttendance") },
      { id: "passcode", label: t("colPasscode") },
      ...activeCustomDefs.map((d) => ({
        id: customFieldColumnId(d.key),
        label: d.label,
        defaultVisible: false as const,
      })),
      { id: "actions", label: t("colActions"), locked: true as const },
    ],
    [t, activeCustomDefs],
  );

  const {
    isVisible: isColumnVisible,
    toggle: toggleColumn,
    move: moveColumn,
    resetToRoleDefault: resetColumns,
    pickerOptions: columnPickerOptions,
    hiddenToggleableCount,
    source: columnSource,
  } = useDriversListColumns(columnVisibilityOptions);

  const columnSourceLabel =
    columnSource === "user"
      ? tCommon("columnSourceUser")
      : columnSource === "role"
        ? tCommon("columnSourceRole")
        : tCommon("columnSourceSystem");

  const headerLabels = useMemo<DriversHeaderLabels>(
    () => ({
      search: t("columnFilter.search"),
      contains: t("columnFilter.contains"),
      all: t("columnFilter.all"),
      clear: t("columnFilter.clear"),
      apply: t("columnFilter.apply"),
      min: t("columnFilter.min"),
      max: t("columnFilter.max"),
      noOptions: t("columnFilter.noOptions"),
      sortBy: (label) => t("columnFilter.sortBy", { label }),
      filterBy: (label) => t("columnFilter.filterBy", { label }),
    }),
    [t],
  );

  const optionLabelFor = useCallback(
    (column: string, value: string, label: string | null): string => {
      if (value === "") {
        return column === "companyName" ? t("companyUnassigned") : t("columnFilter.blank");
      }
      switch (column) {
        case "riderCategory":
          return t(`riderCategory.${riderCategoryMessageKey(value as DriverListPageRow["rider_category"])}`);
        case "status":
          return value === "blocked"
            ? t("blockedBadge")
            : accountStatusLabelFor(value as DriverAccountStatus);
        case "attendance":
          return value === "on_duty" ? t("attendanceOnDuty") : t("attendanceOffDuty");
        default: {
          if (column.startsWith("cf:")) {
            const def = activeCustomDefs.find((d) => customFilterColumn(d.key) === column);
            const opt = def?.options?.find((o) => o.value === value);
            if (opt) return opt.label;
            if (value === "true") return tCommon("yes");
            if (value === "false") return tCommon("no");
          }
          return label ?? value;
        }
      }
    },
    // accountStatusLabelFor only reads `t`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, tCommon, activeCustomDefs],
  );

  const filterContext = useMemo(
    () => ({ tab: tabFilter, search: debouncedSearch, filters: columnFilters }),
    [tabFilter, debouncedSearch, columnFilters],
  );

  const tableColumns = useMemo(() => {
    const header = (
      filterColumn: string,
      label: string,
      kind: "text" | "list" | "range",
    ): ReactNode => (
      <DriversColumnHeader
        column={filterColumn}
        label={label}
        kind={kind}
        filter={columnFilters[filterColumn]}
        onApply={(next) => setColumnFilters((cur) => withColumnFilter(cur, filterColumn, next))}
        sort={sort}
        onSort={() => setSort((cur) => nextSort(cur, filterColumn))}
        context={filterContext}
        optionLabel={(value, optLabel) => optionLabelFor(filterColumn, value, optLabel)}
        labels={headerLabels}
      />
    );
    const fixed = (id: string, label: string) => {
      const key = COLUMN_FILTER_KEY[id];
      return { id, label: header(key, label, DRIVERS_FILTER_KINDS[key]) };
    };
    const defs: { id: string; label: ReactNode; className?: string }[] = [
      {
        id: "select",
        label: (
          <Checkbox
            checked={allVisibleSelected}
            onCheckedChange={toggleSelectAll}
            aria-label={t("selectAll")}
            className="cursor-pointer"
          />
        ),
        className: "w-10",
      },
      fixed("driverId", t("colDriverId")),
      fixed("employeeId", t("colEmployeeId")),
      fixed("riderCategory", t("colRiderCategory")),
      fixed("companyClientId", t("colCompanyClientId")),
      fixed("companyName", t("colCompanyName")),
      fixed("name", t("colName")),
      fixed("phone", t("colPhone")),
      fixed("restaurants", t("colRestaurants")),
      fixed("zone", t("colZone")),
      fixed("clientId", t("colClientId")),
      fixed("clientName", t("colClientName")),
      fixed("todayDeliveries", t("colTodayDeliveries")),
      fixed("status", t("colStatus")),
      fixed("attendance", t("colAttendance")),
      { id: "passcode", label: t("colPasscode") },
      ...activeCustomDefs.map((d) => ({
        id: customFieldColumnId(d.key),
        label: header(customFilterColumn(d.key), d.label, customFilterKind(d)),
      })),
      { id: "actions", label: t("colActions"), className: "w-[88px] text-end" },
    ];
    // Cells render in this fixed order, so headers must too or a saved
    // reorder paints one column's header (and filter) over another's data.
    return defs.filter((c) => isColumnVisible(c.id));
  }, [
    allVisibleSelected,
    isColumnVisible,
    t,
    toggleSelectAll,
    activeCustomDefs,
    columnFilters,
    sort,
    filterContext,
    optionLabelFor,
    headerLabels,
  ]);

  const visibleColumnCount = tableColumns.length;

  const tabSelectItems = useMemo(
    () => [
      { value: "all" as const, label: t("tabAll") },
      { value: "pending" as const, label: t("tabPendingVerification") },
      { value: "on_duty" as const, label: t("tabOnDuty") },
      { value: "multi_device" as const, label: t("filterMultiDevice") },
      { value: "archived" as const, label: t("tabArchived") },
    ],
    [t],
  );

  return (
    <AppPage className="space-y-4">
      <DriversKpiStrip
        {...kpiCounts}
        labels={{
          total: t("kpiTotal"),
          activeToday: t("kpiActiveToday"),
          onlineNow: t("kpiOnlineNow"),
          inactive: t("kpiInactive"),
          pending: t("kpiPending"),
          suspended: t("kpiSuspended"),
        }}
      />

      <AppListCard
        toolbar={
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
              <Select
                items={tabSelectItems}
                value={tabFilter}
                onValueChange={(value) => {
                  if (value) setTabFilter(value as DriversTab);
                }}
              >
                <SelectTrigger className="h-9 w-[108px] shrink-0 cursor-pointer rounded-lg text-xs">
                  <SelectValue placeholder={t("filterView")} />
                </SelectTrigger>
                <SelectContent>
                  {tabSelectItems.map((item) => (
                    <SelectItem key={item.value} value={item.value} className="cursor-pointer">
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t("searchPlaceholder")}
                  className="h-9 rounded-lg bg-background ps-8 pe-8 text-xs"
                  aria-label={t("searchPlaceholder")}
                />
                {search ? (
                  <button
                    type="button"
                    onClick={() => setSearch("")}
                    className="absolute end-1.5 top-1/2 -translate-y-1/2 cursor-pointer rounded p-1 text-muted-foreground hover:bg-muted"
                    aria-label={t("clearSearch")}
                  >
                    <X className="h-3 w-3" />
                  </button>
                ) : null}
              </div>

              {activeFilterCount > 0 ? (
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 shrink-0 cursor-pointer gap-1.5 rounded-lg px-2.5 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => setColumnFilters({})}
                >
                  <FilterX className="h-3.5 w-3.5" aria-hidden />
                  {t("clearAllFilters")}
                  <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-[10px] font-semibold text-white tabular-nums">
                    {activeFilterCount}
                  </span>
                </Button>
              ) : null}

              <AppTableColumnPicker
                options={columnPickerOptions}
                isVisible={isColumnVisible}
                onToggle={toggleColumn}
                onMove={moveColumn}
                onReset={resetColumns}
                sourceLabel={columnSourceLabel}
                hiddenCount={hiddenToggleableCount}
              />
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              {!isLoading ? (
                <p className="hidden text-xs tabular-nums text-muted-foreground lg:inline">
                  {t("showingCount", { visible: filteredTotal, total: tabTotal })}
                </p>
              ) : null}
              <div className="hidden h-6 w-px shrink-0 bg-border sm:block" aria-hidden />
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-9 w-9 shrink-0 cursor-pointer rounded-lg"
                      onClick={handleRefresh}
                      disabled={isRefreshing}
                      aria-label={t("refresh")}
                    >
                      <RefreshCw
                        className={cn("h-4 w-4", isRefreshing && "animate-spin")}
                      />
                    </Button>
                  }
                />
                <TooltipContent>{t("refresh")}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-9 w-9 shrink-0 cursor-pointer rounded-lg sm:w-auto sm:px-2.5"
                      onClick={() => setExportOpen(true)}
                      disabled={filteredTotal === 0}
                      aria-label={t("export")}
                    >
                      <Download className="h-4 w-4" />
                      <span className="ms-1.5 hidden md:inline">{t("export")}</span>
                    </Button>
                  }
                />
                <TooltipContent>{t("export")}</TooltipContent>
              </Tooltip>
              {canCreate ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="h-9 w-9 shrink-0 cursor-pointer rounded-lg sm:w-auto sm:px-2.5"
                        onClick={() => setBulkOpen(true)}
                        aria-label={t("bulkImport")}
                      >
                        <Upload className="h-4 w-4" />
                        <span className="ms-1.5 hidden md:inline">{t("bulkImport")}</span>
                      </Button>
                    }
                  />
                  <TooltipContent>{t("bulkImport")}</TooltipContent>
                </Tooltip>
              ) : null}
              {canCreate ? (
                <Button
                  type="button"
                  size="sm"
                  className="h-9 shrink-0 cursor-pointer rounded-lg px-2.5"
                  onClick={() => setAddOpen(true)}
                >
                  <Plus className="h-4 w-4" />
                  <span className="ms-1.5 hidden sm:inline">{t("addDriver")}</span>
                </Button>
              ) : null}
            </div>
          </div>
        }
      >
        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : showEmptyAll ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm font-medium text-foreground">{t("emptyTitle")}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("emptyDescription")}
            </p>
            {canCreate ? (
              <Button
                type="button"
                size="sm"
                className="mt-4 cursor-pointer rounded-lg"
                onClick={() => setAddOpen(true)}
              >
                <Plus className="me-2 h-3.5 w-3.5" />
                {t("addDriver")}
              </Button>
            ) : null}
          </div>
        ) : (
          <CardContent className="p-0">
            <AppDataTable
              columns={tableColumns}
              headerRowClassName="bg-primary/5 hover:bg-primary/5"
              empty={
                showEmptySearch ? (
                  <AppDataTableEmpty>
                    <AppEmptyState
                      title={t("emptySearchTitle")}
                      description={t("emptySearchDescription")}
                    />
                  </AppDataTableEmpty>
                ) : undefined
              }
            >
              {!showEmptySearch ? (
                <>
                  {drivers.map((driver) => (
                      <AppDataTableRow
                        key={driver.id}
                        className={cn(
                          selectedIds.has(driver.id) && "bg-muted/20",
                        )}
                        onClick={(event) => {
                          if (shouldIgnoreRowNavigation(event.target)) return;
                          router.push(`/drivers/${driver.id}`);
                        }}
                        onMouseEnter={() => prefetchDriverDetail(driver.id)}
                        onFocus={() => prefetchDriverDetail(driver.id)}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter" && event.key !== " ") return;
                          if (shouldIgnoreRowNavigation(event.target)) return;
                          event.preventDefault();
                          router.push(`/drivers/${driver.id}`);
                        }}
                        tabIndex={0}
                        aria-label={t("viewDriver")}
                      >
                        <VisibleTableCell
                          columnId="select"
                          isVisible={isColumnVisible}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Checkbox
                            checked={selectedIds.has(driver.id)}
                            onCheckedChange={() => toggleRow(driver.id)}
                            aria-label={t("selectDriver", { name: driver.full_name })}
                            className="cursor-pointer"
                          />
                        </VisibleTableCell>
                        <VisibleTableCell
                          columnId="driverId"
                          isVisible={isColumnVisible}
                          className="font-mono text-sm text-muted-foreground"
                        >
                          {formatDriverCodeDisplay(driver.driver_code)}
                        </VisibleTableCell>
                        <VisibleTableCell
                          columnId="employeeId"
                          isVisible={isColumnVisible}
                          className="font-mono text-sm text-muted-foreground"
                        >
                          {driver.employee_id ?? "—"}
                        </VisibleTableCell>
                        <VisibleTableCell
                          columnId="riderCategory"
                          isVisible={isColumnVisible}
                          className="text-sm text-muted-foreground"
                        >
                          {t(`riderCategory.${riderCategoryMessageKey(driver.rider_category)}`)}
                        </VisibleTableCell>
                        <VisibleTableCell columnId="companyClientId" isVisible={isColumnVisible}>
                          <CompanyClientIdCell row={driver} notSet={t("companyClientIdNotSet")} />
                        </VisibleTableCell>
                        <VisibleTableCell columnId="companyName" isVisible={isColumnVisible}>
                          <CompanyNameCell row={driver} unassigned={t("companyUnassigned")} />
                        </VisibleTableCell>
                        <VisibleTableCell columnId="name" isVisible={isColumnVisible}>
                          <div className="min-w-0">
                            <span className="truncate font-medium text-foreground">
                              {driver.full_name}
                            </span>
                            <Link
                              href={`/drivers/${driver.id}`}
                              className="mt-0.5 block text-xs text-primary hover:underline"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {t("viewDriver")}
                            </Link>
                          </div>
                        </VisibleTableCell>
                        <VisibleTableCell
                          columnId="phone"
                          isVisible={isColumnVisible}
                          className="text-sm text-muted-foreground"
                        >
                          {formatPhoneInternational(driver.phone)}
                        </VisibleTableCell>
                        <VisibleTableCell columnId="restaurants" isVisible={isColumnVisible}>
                          <RestaurantsCell names={driver.restaurant_names} />
                        </VisibleTableCell>
                        <VisibleTableCell
                          columnId="zone"
                          isVisible={isColumnVisible}
                          className="text-sm text-muted-foreground"
                        >
                          {driver.zone_name}
                        </VisibleTableCell>
                        <VisibleTableCell
                          columnId="clientId"
                          isVisible={isColumnVisible}
                          className="font-mono text-sm text-muted-foreground"
                        >
                          {driver.client_id ?? "—"}
                        </VisibleTableCell>
                        <VisibleTableCell
                          columnId="clientName"
                          isVisible={isColumnVisible}
                          className="text-sm text-muted-foreground"
                        >
                          {driver.client_name ?? "—"}
                        </VisibleTableCell>
                        <VisibleTableCell
                          columnId="todayDeliveries"
                          isVisible={isColumnVisible}
                          className="text-sm tabular-nums text-muted-foreground"
                        >
                          {driver.today_deliveries}
                        </VisibleTableCell>
                        <VisibleTableCell columnId="status" isVisible={isColumnVisible}>
                          <div className="flex flex-wrap items-center gap-1.5">
                            {driver.is_blocked ? (
                              <StatusPill variant="danger" dot={false}>
                                {t("blockedBadge")}
                              </StatusPill>
                            ) : (
                              <AccountStatusPill
                                status={driver.account_status}
                                label={accountStatusLabel(driver.account_status)}
                              />
                            )}
                          </div>
                        </VisibleTableCell>
                        <VisibleTableCell columnId="attendance" isVisible={isColumnVisible}>
                          <AttendancePill
                            onDuty={driver.is_on_duty}
                            onDutyLabel={t("attendanceOnDuty")}
                            offDutyLabel={t("attendanceOffDuty")}
                          />
                        </VisibleTableCell>
                        <VisibleTableCell
                          columnId="passcode"
                          isVisible={isColumnVisible}
                          data-no-row-nav
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => e.stopPropagation()}
                        >
                          <PasscodeCell
                            passcode={
                              driver.archived_at || driver.account_status !== "active"
                                ? null
                                : driver.app_passcode
                            }
                          />
                        </VisibleTableCell>
                        {activeCustomDefs.map((def) => {
                          const colId = customFieldColumnId(def.key);
                          const raw = driver.custom_fields?.[def.key] ?? null;
                          return (
                            <VisibleTableCell
                              key={colId}
                              columnId={colId}
                              isVisible={isColumnVisible}
                              className="text-sm text-muted-foreground"
                            >
                              {formatCustomFieldDisplay(def.field_type, raw, def.options) || "—"}
                            </VisibleTableCell>
                          );
                        })}
                        <VisibleTableCell
                          columnId="actions"
                          isVisible={isColumnVisible}
                          className="text-end"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div
                            className="inline-flex items-center gap-0.5"
                            role="group"
                            aria-label={t("rowActions")}
                          >
                            <Tooltip>
                              <TooltipTrigger
                                render={
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-sm"
                                    className="h-8 w-8 cursor-pointer rounded-md text-muted-foreground hover:text-foreground"
                                    onClick={() => router.push(`/drivers/${driver.id}`)}
                                    aria-label={t("viewDriver")}
                                  >
                                    <Eye className="h-4 w-4" />
                                  </Button>
                                }
                              />
                              <TooltipContent>{t("viewDriver")}</TooltipContent>
                            </Tooltip>
                            {canEdit &&
                            !driver.linked_profile_id &&
                            !driver.archived_at &&
                            driver.restaurant_names.length > 0 ? (
                              <Tooltip>
                                <TooltipTrigger
                                  render={
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon-sm"
                                      className="h-8 w-8 cursor-pointer rounded-md text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"
                                      disabled={approveDriver.isPending}
                                      onClick={async () => {
                                        if (!window.confirm(t("approveConfirmBody"))) return;
                                        try {
                                          await approveDriver.mutateAsync(driver.id);
                                          toast.success(t("approveSuccess"));
                                        } catch (err) {
                                          const key =
                                            err instanceof Error &&
                                            isDriverErrorKey(err.message)
                                              ? err.message
                                              : "save_failed";
                                          toast.error(
                                            isDriverErrorKey(key)
                                              ? t(
                                                  `approveErrors.${key}` as "approveErrors.save_failed",
                                                )
                                              : t("approveErrors.save_failed"),
                                          );
                                        }
                                      }}
                                      aria-label={t("approveAction")}
                                    >
                                      <CheckCircle2 className="h-4 w-4" />
                                    </Button>
                                  }
                                />
                                <TooltipContent>{t("approveAction")}</TooltipContent>
                              </Tooltip>
                            ) : null}
                            {canEdit && driver.archived_at ? (
                              <Tooltip>
                                <TooltipTrigger
                                  render={
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon-sm"
                                      className="h-8 w-8 cursor-pointer rounded-md text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"
                                      disabled={restoreDriver.isPending}
                                      onClick={async () => {
                                        if (!window.confirm(t("restoreConfirm"))) return;
                                        try {
                                          await restoreDriver.mutateAsync({
                                            intakeId: driver.id,
                                            detailId: driver.linked_profile_id ?? driver.id,
                                            profileId: driver.linked_profile_id,
                                          });
                                          toast.success(t("restored"));
                                        } catch (err) {
                                          const key =
                                            err instanceof Error &&
                                            isDriverErrorKey(err.message)
                                              ? err.message
                                              : "save_failed";
                                          toast.error(
                                            isDriverErrorKey(key)
                                              ? t(
                                                  `restoreErrors.${key}` as "restoreErrors.save_failed",
                                                )
                                              : t("restoreFailed"),
                                          );
                                        }
                                      }}
                                      aria-label={t("restoreDriver")}
                                    >
                                      <ArchiveRestore className="h-4 w-4" />
                                    </Button>
                                  }
                                />
                                <TooltipContent>{t("restoreDriver")}</TooltipContent>
                              </Tooltip>
                            ) : null}
                            {canEdit && !driver.archived_at ? (
                            <Tooltip>
                              <TooltipTrigger
                                render={
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-sm"
                                    className="h-8 w-8 cursor-pointer rounded-md text-primary hover:bg-primary/10 hover:text-primary"
                                    onClick={() => setQuickEditId(driver.id)}
                                    aria-label={t("quickEdit")}
                                  >
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                }
                              />
                              <TooltipContent>{t("quickEdit")}</TooltipContent>
                            </Tooltip>
                            ) : null}
                          </div>
                        </VisibleTableCell>
                      </AppDataTableRow>
                    ))}
                    {hasNextPage ? (
                      <AppDataTableRow ref={loadMoreRef} className="hover:bg-transparent">
                        <TableCell colSpan={visibleColumnCount} className="border-t border-border py-4 text-center">
                          <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            {t("loadMore")}
                          </span>
                        </TableCell>
                      </AppDataTableRow>
                    ) : null}
                </>
              ) : null}
            </AppDataTable>
          </CardContent>
        )}
      </AppListCard>
      <DriverFormSheet mode="create" open={addOpen} onOpenChange={setAddOpen} />
      {quickEditDriver?.intake_id ? (
        <DriverEditSheet
          driver={quickEditDriver}
          intakeId={quickEditDriver.intake_id}
          detailRouteId={quickEditId ?? quickEditDriver.id}
          open={quickEditId !== null}
          onOpenChange={(open) => {
            if (!open) setQuickEditId(null);
          }}
        />
      ) : null}
      <DriversExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        rowCount={filteredTotal}
        loadRows={() => fetchDriversForExport(query)}
        customFields={activeCustomDefs.map((d) => ({ key: d.key, label: d.label }))}
      />
      {canCreate ? (
        <DriverBulkImportDialog open={bulkOpen} onOpenChange={setBulkOpen} />
      ) : null}
    </AppPage>
  );
}

export function DriversPageShell() {
  const mounted = useHasMounted();
  if (!mounted) return <DriversPageSkeleton />;
  return <DriversPageContent />;
}
