"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useRouter, Link } from "@/i18n/navigation";
import { useSearchParams } from "next/navigation";
import {
  ArchiveRestore,
  ArrowUpDown,
  CheckCircle2,
  Download,
  Eye,
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { customFieldColumnId } from "@/lib/custom-fields/types";
import { formatCustomFieldDisplay } from "@/lib/custom-fields/validate";
import { useDriversListColumns } from "./use-drivers-list-columns";
import { useDriverFormOptions } from "./use-driver-form-options";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/query-keys";
import { useRealtimeInvalidator } from "@/lib/realtime/use-realtime-invalidator";
import { fetchDriverDetail } from "./drivers-actions";
import { useAuth } from "@/contexts/auth-context";
import { useApproveDriverIntake, useDriversList, useDriversMultiDeviceRecent, useRestoreDriverIntake, type DriversTabFilter } from "./use-drivers";
import { DriverBulkImportDialog } from "./import/bulk-import-dialog";
import { isDriverErrorKey } from "./driver-errors";
import {
  DRIVERS_PAGE_SIZE,
  DRIVERS_SORT_KEYS,
  sortDrivers,
  type DriversSortKey,
} from "./drivers-list-utils";
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
import { DriversKpiStrip } from "./drivers-kpi-strip";
import {
  countActiveDriversFilters,
  DEFAULT_DRIVERS_FILTERS,
  DriversFiltersButton,
  DriversFiltersDialog,
  type DriversFiltersState,
} from "./drivers-filters-dialog";
import { riderCategoryMessageKey } from "./driver-rider-category";
import { type DriverAccountStatus, type DriverListRow } from "./types";

function shouldIgnoreRowNavigation(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.closest(
      'button, a, input, select, textarea, [role="checkbox"], [data-no-row-nav]',
    ),
  );
}

const SORT_I18N: Record<DriversSortKey, string> = {
  name_asc: "sortNameAsc",
  name_desc: "sortNameDesc",
  driver_code_asc: "sortDriverCodeAsc",
  driver_code_desc: "sortDriverCodeDesc",
  employee_id_asc: "sortEmployeeIdAsc",
  employee_id_desc: "sortEmployeeIdDesc",
  zone_asc: "sortZoneAsc",
  zone_desc: "sortZoneDesc",
  partner_asc: "sortPartnerAsc",
  partner_desc: "sortPartnerDesc",
  deliveries_desc: "sortDeliveriesDesc",
  deliveries_asc: "sortDeliveriesAsc",
  status_active_first: "sortStatusActiveFirst",
  on_duty_first: "sortOnDutyFirst",
};

function applyDriversListFilters(
  rows: DriverListRow[],
  filters: DriversFiltersState,
  search: string,
): DriverListRow[] {
  const q = search.trim().toLowerCase();
  const qDigits = q.replace(/\D/g, "");
  return rows.filter((d) => {
    if (filters.zoneId && d.zone_id !== filters.zoneId) return false;
    if (filters.partnerId && d.partner_id !== filters.partnerId) return false;
    if (filters.status !== "all" && d.account_status !== filters.status) return false;
    if (filters.restaurantId && !d.restaurant_ids.includes(filters.restaurantId)) {
      return false;
    }
    if (!q) return true;
    const matchesText =
      d.full_name.toLowerCase().includes(q) ||
      d.driver_code.toLowerCase().includes(q) ||
      (d.employee_id?.toLowerCase().includes(q) ?? false) ||
      d.partner_name.toLowerCase().includes(q) ||
      d.zone_name.toLowerCase().includes(q);
    if (matchesText) return true;
    if (qDigits && d.phone.replace(/\D/g, "").includes(qDigits)) return true;
    return false;
  });
}

function exportDriversCsv(
  rows: DriverListRow[],
  customKeys: { key: string; label: string }[] = [],
) {
  const header = [
    "id",
    "driver_code",
    "employee_id",
    "full_name",
    "phone",
    "partner",
    "zone",
    "account_status",
    "on_duty",
    "today_deliveries",
    "workflow_status",
    "linked",
    "app_passcode",
    ...customKeys.map((c) => c.key),
  ];
  const escape = (v: string | number | boolean) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [
    header.join(","),
    ...rows.map((r) =>
      [
        r.id,
        r.driver_code,
        r.employee_id ?? "",
        r.full_name,
        r.phone,
        r.partner_name,
        r.zone_name,
        r.is_blocked ? "blocked" : r.account_status,
        r.is_on_duty ? "yes" : "no",
        r.today_deliveries,
        r.workflow_status,
        r.linked ? "yes" : "no",
        r.archived_at ? "" : (r.app_passcode ?? ""),
        ...customKeys.map((c) => {
          const v = r.custom_fields?.[c.key];
          return v == null ? "" : String(v);
        }),
      ]
        .map(escape)
        .join(","),
    ),
  ];
  const blob = new Blob(["\uFEFF" + lines.join("\n")], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `drivers-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function DriversPageSkeleton() {
  return (
    <div className="flex h-48 items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}

function DriversPageContent() {
  const t = useTranslations("pages.drivers");
  const tCommon = useTranslations("common");
  const { can } = useAuth();
  const canManage = can("drivers.manage");
  const { data: customFieldDefs = [] } = useCustomFieldDefinitions();
  const activeCustomDefs = useMemo(
    () => customFieldDefs.filter((d) => d.is_active && !d.archived_at),
    [customFieldDefs],
  );
  const approveDriver = useApproveDriverIntake();
  const restoreDriver = useRestoreDriverIntake();
  const [bulkOpen, setBulkOpen] = useState(false);
  const router = useRouter();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const [tabFilter, setTabFilter] = useState<DriversTabFilter>("all");
  const listArchived = tabFilter === "archived";
  const { data: drivers = [], isLoading, refetch } = useDriversList(listArchived);
  const { data: multiDeviceRows = [] } = useDriversMultiDeviceRecent(7, tabFilter === "multi_device");
  const multiDeviceDriverIds = useMemo(
    () => new Set(multiDeviceRows.map((row) => row.driver_id)),
    [multiDeviceRows],
  );
  const { data: formOptions } = useDriverFormOptions();

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

  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<DriversFiltersState>(DEFAULT_DRIVERS_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sortKey, setSortKey] = useState<DriversSortKey>("name_asc");
  const [visibleCount, setVisibleCount] = useState(DRIVERS_PAGE_SIZE);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const loadMoreRef = useRef<HTMLTableRowElement | null>(null);

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
    }
  }, [searchParams, router]);

  useEffect(() => {
    setVisibleCount(DRIVERS_PAGE_SIZE);
  }, [tabFilter, search, filters, sortKey, drivers.length]);

  const activeFilterCount = countActiveDriversFilters(filters);

  const sortSelectItems = useMemo(
    () =>
      DRIVERS_SORT_KEYS.map((key) => ({
        value: key,
        label: t(SORT_I18N[key]),
      })),
    [t],
  );

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

  const tabFiltered = useMemo(() => {
    if (tabFilter === "archived") return drivers;
    return drivers.filter((d) => {
      if (tabFilter === "pending") {
        return (
          !d.linked_profile_id ||
          d.workflow_status === "pending" ||
          d.account_status === "pending"
        );
      }
      if (tabFilter === "on_duty") return d.is_on_duty;
      if (tabFilter === "multi_device") {
        return Boolean(d.linked_profile_id && multiDeviceDriverIds.has(d.linked_profile_id));
      }
      return true;
    });
  }, [drivers, tabFilter, multiDeviceDriverIds]);

  const filtered = useMemo(
    () => applyDriversListFilters(tabFiltered, filters, search),
    [tabFiltered, filters, search],
  );

  const sorted = useMemo(() => sortDrivers(filtered, sortKey), [filtered, sortKey]);

  const visible = useMemo(
    () => sorted.slice(0, visibleCount),
    [sorted, visibleCount],
  );

  const hasMore = visible.length < sorted.length;

  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el || !hasMore) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((prev) => Math.min(prev + DRIVERS_PAGE_SIZE, sorted.length));
        }
      },
      { rootMargin: "240px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore, sorted.length]);

  const kpiCounts = useMemo(() => {
    const total = drivers.length;
    const activeToday = drivers.filter((d) => d.account_status === "active").length;
    const onlineNow = drivers.filter((d) => d.is_on_duty).length;
    const inactive = drivers.filter(
      (d) => d.account_status === "active" && !d.is_on_duty,
    ).length;
    const pendingVerification = drivers.filter(
      (d) =>
        !d.linked_profile_id ||
        d.workflow_status === "pending" ||
        d.account_status === "pending",
    ).length;
    const suspended = drivers.filter((d) => d.account_status === "suspended").length;

    return { total, activeToday, onlineNow, inactive, pendingVerification, suspended };
  }, [drivers]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refetch();
    } finally {
      setIsRefreshing(false);
    }
  };

  const showEmptySearch = !isLoading && drivers.length > 0 && sorted.length === 0;
  const showEmptyAll = !isLoading && drivers.length === 0;

  const allVisibleSelected =
    visible.length > 0 && visible.every((d) => selectedIds.has(d.id));

  const toggleSelectAll = () => {
    if (allVisibleSelected) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(visible.map((d) => d.id)));
  };

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
      { id: "name", label: t("colName") },
      { id: "phone", label: t("colPhone") },
      { id: "restaurants", label: t("colRestaurants") },
      { id: "zone", label: t("colZone") },
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
    orderedVisibleIds,
    hiddenToggleableCount,
    source: columnSource,
  } = useDriversListColumns(columnVisibilityOptions);

  const columnSourceLabel =
    columnSource === "user"
      ? tCommon("columnSourceUser")
      : columnSource === "role"
        ? tCommon("columnSourceRole")
        : tCommon("columnSourceSystem");

  const tableColumns = useMemo(() => {
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
      { id: "driverId", label: t("colDriverId") },
      { id: "employeeId", label: t("colEmployeeId") },
      { id: "riderCategory", label: t("colRiderCategory") },
      { id: "name", label: t("colName") },
      { id: "phone", label: t("colPhone") },
      { id: "restaurants", label: t("colRestaurants") },
      { id: "zone", label: t("colZone") },
      { id: "todayDeliveries", label: t("colTodayDeliveries") },
      { id: "status", label: t("colStatus") },
      { id: "attendance", label: t("colAttendance") },
      { id: "passcode", label: t("colPasscode") },
      ...activeCustomDefs.map((d) => ({
        id: customFieldColumnId(d.key),
        label: d.label,
      })),
      { id: "actions", label: t("colActions"), className: "w-[88px] text-end" },
    ];
    const byId = new Map(defs.map((c) => [c.id, c]));
    return orderedVisibleIds
      .map((id) => byId.get(id))
      .filter((c): c is { id: string; label: ReactNode; className?: string } => Boolean(c));
  }, [
    allVisibleSelected,
    orderedVisibleIds,
    t,
    toggleSelectAll,
    activeCustomDefs,
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

  const currentSortLabel = sortSelectItems.find((item) => item.value === sortKey)?.label ?? "";

  const getPreviewCount = useCallback(
    (next: DriversFiltersState) =>
      applyDriversListFilters(tabFiltered, next, search).length,
    [tabFiltered, search],
  );

  const filterChips = useMemo(() => {
    if (activeFilterCount === 0) return undefined;
    const chips: ReactNode[] = [];

    if (filters.zoneId) {
      const name =
        formOptions?.zones.find((z) => z.id === filters.zoneId)?.name ?? filters.zoneId;
      chips.push(
        <Badge key="zone" variant="secondary" className="gap-1 rounded-lg pe-1">
          {t("filterZone")}: {name}
          <button
            type="button"
            className="cursor-pointer rounded p-0.5 hover:bg-muted"
            onClick={() => setFilters((f) => ({ ...f, zoneId: "" }))}
            aria-label={t("clearFilters")}
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>,
      );
    }
    if (filters.partnerId) {
      const name =
        formOptions?.partners.find((p) => p.id === filters.partnerId)?.name ??
        filters.partnerId;
      chips.push(
        <Badge key="partner" variant="secondary" className="gap-1 rounded-lg pe-1">
          {t("filterPartner")}: {name}
          <button
            type="button"
            className="cursor-pointer rounded p-0.5 hover:bg-muted"
            onClick={() => setFilters((f) => ({ ...f, partnerId: "" }))}
            aria-label={t("clearFilters")}
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>,
      );
    }
    if (filters.status !== "all") {
      chips.push(
        <Badge key="status" variant="secondary" className="gap-1 rounded-lg pe-1">
          {t("filterStatus")}: {accountStatusLabelFor(filters.status)}
          <button
            type="button"
            className="cursor-pointer rounded p-0.5 hover:bg-muted"
            onClick={() => setFilters((f) => ({ ...f, status: "all" }))}
            aria-label={t("clearFilters")}
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>,
      );
    }
    if (filters.restaurantId) {
      const name =
        formOptions?.restaurants.find((r) => r.id === filters.restaurantId)?.name ??
        filters.restaurantId;
      chips.push(
        <Badge key="restaurant" variant="secondary" className="gap-1 rounded-lg pe-1">
          {t("filterRestaurant")}: {name}
          <button
            type="button"
            className="cursor-pointer rounded p-0.5 hover:bg-muted"
            onClick={() => setFilters((f) => ({ ...f, restaurantId: "" }))}
            aria-label={t("clearFilters")}
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>,
      );
    }

    chips.push(
      <button
        key="clear-all"
        type="button"
        className="cursor-pointer text-xs text-primary hover:underline"
        onClick={() => setFilters({ ...DEFAULT_DRIVERS_FILTERS })}
      >
        {t("clearFilters")}
      </button>,
    );

    return chips;
  }, [activeFilterCount, filters, formOptions, t]);

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
        filterChips={filterChips}
        toolbar={
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
              <Select
                items={tabSelectItems}
                value={tabFilter}
                onValueChange={(value) => {
                  if (value) setTabFilter(value as DriversTabFilter);
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

              <DriversFiltersButton
                activeCount={activeFilterCount}
                onClick={() => setFiltersOpen(true)}
              />

              <AppTableColumnPicker
                options={columnPickerOptions}
                isVisible={isColumnVisible}
                onToggle={toggleColumn}
                onMove={moveColumn}
                onReset={resetColumns}
                sourceLabel={columnSourceLabel}
                hiddenCount={hiddenToggleableCount}
              />

              <DropdownMenu>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <DropdownMenuTrigger
                        className={cn(
                          "inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-input bg-background hover:bg-accent",
                        )}
                        aria-label={t("sortTooltip", { label: currentSortLabel })}
                      >
                        <ArrowUpDown className="h-4 w-4" />
                      </DropdownMenuTrigger>
                    }
                  />
                  <TooltipContent>
                    {t("sortTooltip", { label: currentSortLabel })}
                  </TooltipContent>
                </Tooltip>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>{t("sortBy")}</DropdownMenuLabel>
                    <DropdownMenuRadioGroup
                      value={sortKey}
                      onValueChange={(v) => {
                        if (v) setSortKey(v as DriversSortKey);
                      }}
                    >
                      {sortSelectItems.map((item) => (
                        <DropdownMenuRadioItem
                          key={item.value}
                          value={item.value}
                          className="cursor-pointer"
                        >
                          {item.label}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              {sorted.length > 0 ? (
                <p className="hidden text-xs tabular-nums text-muted-foreground lg:inline">
                  {t("showingCount", { visible: visible.length, total: sorted.length })}
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
                      onClick={() =>
                        exportDriversCsv(
                          sorted,
                          activeCustomDefs.map((d) => ({ key: d.key, label: d.label })),
                        )
                      }
                      disabled={sorted.length === 0}
                      aria-label={t("export")}
                    >
                      <Download className="h-4 w-4" />
                      <span className="ms-1.5 hidden md:inline">{t("export")}</span>
                    </Button>
                  }
                />
                <TooltipContent>{t("export")}</TooltipContent>
              </Tooltip>
              {canManage ? (
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
              <Button
                type="button"
                size="sm"
                className="h-9 shrink-0 cursor-pointer rounded-lg px-2.5"
                onClick={() => setAddOpen(true)}
              >
                <Plus className="h-4 w-4" />
                <span className="ms-1.5 hidden sm:inline">{t("addDriver")}</span>
              </Button>
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
            <Button
              type="button"
              size="sm"
              className="mt-4 cursor-pointer rounded-lg"
              onClick={() => setAddOpen(true)}
            >
              <Plus className="me-2 h-3.5 w-3.5" />
              {t("addDriver")}
            </Button>
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
                  {visible.map((driver) => (
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
                            passcode={driver.archived_at ? null : driver.app_passcode}
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
                            {canManage &&
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
                            {canManage && driver.archived_at ? (
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
                            {!driver.archived_at ? (
                            <Tooltip>
                              <TooltipTrigger
                                render={
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-sm"
                                    className="h-8 w-8 cursor-pointer rounded-md text-primary hover:bg-primary/10 hover:text-primary"
                                    onClick={() =>
                                      router.push(`/drivers/${driver.id}?edit=1`)
                                    }
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
                    {hasMore ? (
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
      <DriversFiltersDialog
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        filters={filters}
        onApply={setFilters}
        formOptions={formOptions}
        getPreviewCount={getPreviewCount}
        baselineTotal={tabFiltered.length}
      />
      <DriverFormSheet mode="create" open={addOpen} onOpenChange={setAddOpen} />
      {canManage ? (
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
