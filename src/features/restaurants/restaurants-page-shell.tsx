"use client";

import { useMemo, useState } from "react";
import { useTableColumnVisibility } from "@/hooks/use-table-column-visibility";
import { useLocale, useTranslations } from "next-intl";
import { useRouter, Link } from "@/i18n/navigation";
import {
  Download,
  Eye,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Users,
  X,
} from "lucide-react";
import { AppListCard, AppPage, AppPageHeader } from "@/components/app";
import {
  AppDataTable,
  AppDataTableEmpty,
  AppDataTableRow,
  AppTableColumnPicker,
  TableCell,
  VisibleTableCell,
} from "@/components/app";
import { AppEmptyState } from "@/components/app/app-empty-state";
import { TabBar } from "@/components/dashboard/tab-bar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { CardContent } from "@/components/ui/card";
import { SearchSelect } from "@/components/ui/search-select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAuth } from "@/contexts/auth-context";
import { canManageRestaurants, hasPermissionInSet } from "@/lib/auth/permissions";
import { useHasMounted } from "@/hooks/use-has-mounted";
import { cn } from "@/lib/utils";
import { useRestaurantsList } from "./use-restaurants";
import { DriverAssignSheet } from "@/features/drivers/driver-assign-sheet";
import type { RestaurantRow, RestaurantStatus } from "./types";

type StatusFilter = "all" | RestaurantStatus;
type HasDriversFilter = "all" | "yes" | "no";
type HasLocationFilter = "all" | "yes" | "no";

function shouldIgnoreRowNavigation(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.closest(
      'button, a, input, select, textarea, [role="checkbox"], [data-no-row-nav]',
    ),
  );
}

function exportRestaurantsCsv(rows: RestaurantRow[], t: (key: string) => string) {
  const header = [
    "id",
    "name",
    "partner_name",
    "external_merchant_id",
    "zone_name",
    "status",
    "driver_count",
    "active_deliveries",
    "deliveries_total",
    "deliveries_verified",
    "deliveries_cancelled",
    "has_coordinates",
    "geofence_count",
    "created_at",
  ];
  const escape = (v: string | number | boolean | null) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [
    header.join(","),
    ...rows.map((r) =>
      [
        r.id,
        r.name,
        r.partner_name,
        r.external_merchant_id,
        r.zone_name,
        r.status,
        r.driver_count,
        r.active_deliveries,
        r.deliveries_total,
        r.deliveries_verified,
        r.deliveries_cancelled,
        r.has_coordinates ? t("exportYes") : t("exportNo"),
        r.geofence_count,
        r.created_at,
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
  a.download = `restaurants-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function formatCreatedAt(iso: string, locale: string) {
  try {
    return new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

function RestaurantsPageSkeleton() {
  return (
    <div className="flex h-48 items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}

function RestaurantsPageContent() {
  const locale = useLocale();
  const router = useRouter();
  const t = useTranslations("pages.restaurants");
  const { permissions, isSuperAdmin } = useAuth();
  const canManage = canManageRestaurants(new Set(permissions), isSuperAdmin);
  const canAssignDrivers = hasPermissionInSet(
    new Set(permissions),
    "drivers.manage",
    isSuperAdmin,
  );

  const { data: restaurants = [], isLoading, isError, refetch } = useRestaurantsList();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [partnerFilter, setPartnerFilter] = useState("all");
  const [zoneFilter, setZoneFilter] = useState("all");
  const [hasDriversFilter, setHasDriversFilter] = useState<HasDriversFilter>("all");
  const [hasLocationFilter, setHasLocationFilter] = useState<HasLocationFilter>("all");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [assignRestaurant, setAssignRestaurant] = useState<RestaurantRow | null>(null);

  const partnerSelectItems = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of restaurants) {
      if (r.partner_id && r.partner_name !== "—") {
        seen.set(r.partner_id, r.partner_name);
      }
    }
    return [
      { value: "all", label: t("filterPartnerAll") },
      ...[...seen.entries()]
        .sort((a, b) => a[1].localeCompare(b[1]))
        .map(([value, label]) => ({ value, label })),
    ];
  }, [restaurants, t]);

  const zoneSelectItems = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of restaurants) {
      if (r.zone_id && r.zone_name !== "—") {
        seen.set(r.zone_id, r.zone_name);
      }
    }
    return [
      { value: "all", label: t("filterZoneAll") },
      ...[...seen.entries()]
        .sort((a, b) => a[1].localeCompare(b[1]))
        .map(([value, label]) => ({ value, label })),
    ];
  }, [restaurants, t]);

  const hasDriversSelectItems = useMemo(
    () => [
      { value: "all", label: t("filterHasDriversAll") },
      { value: "yes", label: t("filterHasDriversYes") },
      { value: "no", label: t("filterHasDriversNo") },
    ],
    [t],
  );

  const hasLocationSelectItems = useMemo(
    () => [
      { value: "all", label: t("filterHasLocation") },
      { value: "yes", label: t("filterHasLocationYes") },
      { value: "no", label: t("filterHasLocationNo") },
    ],
    [t],
  );

  const hasActiveFilters =
    statusFilter !== "all" ||
    partnerFilter !== "all" ||
    zoneFilter !== "all" ||
    hasDriversFilter !== "all" ||
    hasLocationFilter !== "all";

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return restaurants.filter((r) => {
      if (
        q &&
        !(
          r.name.toLowerCase().includes(q) ||
          r.partner_name.toLowerCase().includes(q) ||
          (r.external_merchant_id?.toLowerCase().includes(q) ?? false)
        )
      ) {
        return false;
      }
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (partnerFilter !== "all" && r.partner_id !== partnerFilter) return false;
      if (zoneFilter !== "all" && r.zone_id !== zoneFilter) return false;
      if (hasDriversFilter === "yes" && r.driver_count === 0) return false;
      if (hasDriversFilter === "no" && r.driver_count > 0) return false;
      if (hasLocationFilter === "yes" && !r.has_coordinates) return false;
      if (hasLocationFilter === "no" && r.has_coordinates) return false;
      return true;
    });
  }, [
    restaurants,
    search,
    statusFilter,
    partnerFilter,
    zoneFilter,
    hasDriversFilter,
    hasLocationFilter,
  ]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refetch();
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleAdd = () => {
    router.push("/restaurants/new");
  };

  const handleRowClick = (row: RestaurantRow) => {
    router.push(`/restaurants/${row.id}`);
  };

  const handleEdit = (row: RestaurantRow) => {
    router.push(`/restaurants/${row.id}/edit`);
  };

  const clearAllFilters = () => {
    setStatusFilter("all");
    setPartnerFilter("all");
    setZoneFilter("all");
    setHasDriversFilter("all");
    setHasLocationFilter("all");
  };

  const statusFilterLabel = (value: StatusFilter) => {
    switch (value) {
      case "draft":
        return t("filterDraft");
      case "published":
        return t("filterPublished");
      case "archived":
        return t("filterArchived");
      default:
        return t("filterStatusAll");
    }
  };

  const statusBadgeLabel = (status: RestaurantStatus) => {
    switch (status) {
      case "published":
        return t("statusPublished");
      case "archived":
        return t("statusArchived");
      default:
        return t("statusDraft");
    }
  };

  const countLabel =
    visible.length !== restaurants.length
      ? `${t("totalRestaurants", { count: visible.length })} ${t("ofTotal", { total: restaurants.length })}`
      : t("totalRestaurants", { count: visible.length });

  const showEmptySearch =
    !isLoading && restaurants.length > 0 && visible.length === 0;
  const showEmptyAll = !isLoading && restaurants.length === 0;

  const columnVisibilityOptions = useMemo(
    () => [
      { id: "restaurant", label: t("colRestaurant") },
      { id: "partner", label: t("colPartner") },
      { id: "zone", label: t("colZone") },
      { id: "externalId", label: t("colExternalId") },
      { id: "status", label: t("colStatus") },
      { id: "drivers", label: t("colDrivers") },
      { id: "activeDeliveries", label: t("colActiveDeliveries") },
      { id: "created", label: t("colCreated") },
      { id: "actions", label: t("colActions"), locked: true as const },
    ],
    [t],
  );

  const {
    isVisible: isColumnVisible,
    toggle: toggleColumn,
    reset: resetColumns,
    pickerOptions: columnPickerOptions,
    hiddenToggleableCount,
  } = useTableColumnVisibility("dpd:restaurants:list-columns", columnVisibilityOptions);

  const tableColumns = useMemo(() => {
    const cols = [
      { id: "restaurant", label: t("colRestaurant") },
      { id: "partner", label: t("colPartner") },
      { id: "zone", label: t("colZone") },
      { id: "externalId", label: t("colExternalId") },
      { id: "status", label: t("colStatus") },
      { id: "drivers", label: t("colDrivers") },
      { id: "activeDeliveries", label: t("colActiveDeliveries") },
      { id: "created", label: t("colCreated") },
      {
        id: "actions",
        label: t("colActions"),
        className: cn(
          "text-end",
          canManage || canAssignDrivers ? "w-28" : "w-16",
        ),
      },
    ];
    return cols.filter((col) => isColumnVisible(col.id));
  }, [canAssignDrivers, canManage, isColumnVisible, t]);

  const statusTabs = [
    { id: "all", label: t("filterStatusAll") },
    { id: "draft", label: t("filterDraft") },
    { id: "published", label: t("filterPublished") },
    { id: "archived", label: t("filterArchived") },
  ];

  return (
    <AppPage>
      <AppPageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 cursor-pointer rounded-lg"
              onClick={handleRefresh}
              disabled={isRefreshing}
            >
              <RefreshCw
                className={`me-2 h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`}
              />
              {t("refresh")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 cursor-pointer rounded-lg"
              onClick={() => exportRestaurantsCsv(visible, t)}
              disabled={visible.length === 0}
            >
              <Download className="me-2 h-3.5 w-3.5" />
              {t("export")}
            </Button>
            {canManage ? (
              <Button
                type="button"
                size="sm"
                className="h-9 cursor-pointer rounded-lg"
                onClick={handleAdd}
              >
                <Plus className="me-2 h-3.5 w-3.5" />
                {t("addRestaurant")}
              </Button>
            ) : null}
          </div>
        }
      />
      <AppListCard
        toolbar={
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <TabBar
                items={statusTabs}
                activeId={statusFilter}
                onSelect={(id) => setStatusFilter(id as StatusFilter)}
                className="border-b-0"
              />
              <p className="shrink-0 text-sm tabular-nums text-muted-foreground">
                {countLabel}
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t("searchPlaceholder")}
                  className="h-9 rounded-lg bg-background ps-9 pe-9"
                  aria-label={t("searchPlaceholder")}
                />
                {search ? (
                  <button
                    type="button"
                    onClick={() => setSearch("")}
                    className="absolute end-2 top-1/2 -translate-y-1/2 cursor-pointer rounded p-1 text-muted-foreground hover:bg-muted"
                    aria-label={t("clearSearch")}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <SearchSelect
                  items={partnerSelectItems}
                  value={partnerFilter}
                  onChange={(v) => setPartnerFilter(v ?? "all")}
                  placeholder={t("filterPartner")}
                  searchPlaceholder={t("filterPartner")}
                  defaultLimit={8}
                  recentsKey="restaurants-partner-filter"
                  className="w-full min-w-[140px] sm:w-[160px]"
                  clearable={false}
                />
                <SearchSelect
                  items={zoneSelectItems}
                  value={zoneFilter}
                  onChange={(v) => setZoneFilter(v ?? "all")}
                  placeholder={t("filterZone")}
                  searchPlaceholder={t("filterZone")}
                  defaultLimit={8}
                  recentsKey="restaurants-zone-filter"
                  className="w-full min-w-[140px] sm:w-[160px]"
                  clearable={false}
                />
                <SearchSelect
                  items={hasDriversSelectItems}
                  value={hasDriversFilter}
                  onChange={(v) =>
                    setHasDriversFilter((v as HasDriversFilter) ?? "all")
                  }
                  placeholder={t("filterHasDrivers")}
                  searchPlaceholder={t("filterHasDrivers")}
                  defaultLimit={8}
                  recentsKey="restaurants-has-drivers-filter"
                  className="w-full min-w-[140px] sm:w-[160px]"
                  clearable={false}
                />
                <SearchSelect
                  items={hasLocationSelectItems}
                  value={hasLocationFilter}
                  onChange={(v) =>
                    setHasLocationFilter((v as HasLocationFilter) ?? "all")
                  }
                  placeholder={t("filterHasLocation")}
                  searchPlaceholder={t("filterHasLocation")}
                  defaultLimit={8}
                  recentsKey="restaurants-has-location-filter"
                  className="w-full min-w-[140px] sm:w-[160px]"
                  clearable={false}
                />
                <AppTableColumnPicker
                  options={columnPickerOptions}
                  isVisible={isColumnVisible}
                  onToggle={toggleColumn}
                  onReset={resetColumns}
                  hiddenCount={hiddenToggleableCount}
                />
              </div>
            </div>
          </div>
        }
        filterChips={
          hasActiveFilters ? (
            <>
              {statusFilter !== "all" ? (
                <Badge variant="secondary" className="gap-1 rounded-lg pe-1">
                  {t("filterStatus")}: {statusFilterLabel(statusFilter)}
                  <button
                    type="button"
                    className="cursor-pointer rounded p-0.5 hover:bg-muted"
                    onClick={() => setStatusFilter("all")}
                    aria-label={t("clearFilters")}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ) : null}
              {partnerFilter !== "all" ? (
                <Badge variant="secondary" className="gap-1 rounded-lg pe-1">
                  {t("filterPartner")}:{" "}
                  {partnerSelectItems.find((i) => i.value === partnerFilter)?.label}
                  <button
                    type="button"
                    className="cursor-pointer rounded p-0.5 hover:bg-muted"
                    onClick={() => setPartnerFilter("all")}
                    aria-label={t("clearFilters")}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ) : null}
              {zoneFilter !== "all" ? (
                <Badge variant="secondary" className="gap-1 rounded-lg pe-1">
                  {t("filterZone")}:{" "}
                  {zoneSelectItems.find((i) => i.value === zoneFilter)?.label}
                  <button
                    type="button"
                    className="cursor-pointer rounded p-0.5 hover:bg-muted"
                    onClick={() => setZoneFilter("all")}
                    aria-label={t("clearFilters")}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ) : null}
              {hasDriversFilter !== "all" ? (
                <Badge variant="secondary" className="gap-1 rounded-lg pe-1">
                  {t("filterHasDrivers")}:{" "}
                  {
                    hasDriversSelectItems.find((i) => i.value === hasDriversFilter)
                      ?.label
                  }
                  <button
                    type="button"
                    className="cursor-pointer rounded p-0.5 hover:bg-muted"
                    onClick={() => setHasDriversFilter("all")}
                    aria-label={t("clearFilters")}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ) : null}
              {hasLocationFilter !== "all" ? (
                <Badge variant="secondary" className="gap-1 rounded-lg pe-1">
                  {t("filterHasLocation")}:{" "}
                  {
                    hasLocationSelectItems.find((i) => i.value === hasLocationFilter)
                      ?.label
                  }
                  <button
                    type="button"
                    className="cursor-pointer rounded p-0.5 hover:bg-muted"
                    onClick={() => setHasLocationFilter("all")}
                    aria-label={t("clearFilters")}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ) : null}
              <button
                type="button"
                className="cursor-pointer text-xs text-primary hover:underline"
                onClick={clearAllFilters}
              >
                {t("clearFilters")}
              </button>
            </>
          ) : undefined
        }
      >
        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : isError ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm font-medium text-foreground">{t("loadFailedTitle")}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t("loadFailedDescription")}</p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-4 cursor-pointer rounded-lg"
              onClick={() => void refetch()}
            >
              <RefreshCw className="me-2 h-3.5 w-3.5" />
              {t("refresh")}
            </Button>
          </div>
        ) : showEmptyAll ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm font-medium text-foreground">{t("emptyTitle")}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t("emptyDescription")}</p>
            {canManage ? (
              <Button
                type="button"
                size="sm"
                className="mt-4 cursor-pointer rounded-lg"
                onClick={handleAdd}
              >
                <Plus className="me-2 h-3.5 w-3.5" />
                {t("addRestaurant")}
              </Button>
            ) : null}
          </div>
        ) : (
          <CardContent className="p-0">
            <AppDataTable
              columns={tableColumns}
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
              {!showEmptySearch
                ? visible.map((row) => (
                    <AppDataTableRow
                      key={row.id}
                      tabIndex={0}
                      aria-label={t("viewRestaurant")}
                      onClick={(event) => {
                        if (shouldIgnoreRowNavigation(event.target)) return;
                        handleRowClick(row);
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" && event.key !== " ") return;
                        if (shouldIgnoreRowNavigation(event.target)) return;
                        event.preventDefault();
                        handleRowClick(row);
                      }}
                    >
                      <VisibleTableCell columnId="restaurant" isVisible={isColumnVisible}>
                        <div className="flex items-center gap-2.5">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted/40">
                            {row.logo_display_url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={row.logo_display_url}
                                alt=""
                                className="h-full w-full object-contain p-0.5"
                              />
                            ) : (
                              <span className="text-[9px] font-medium text-muted-foreground">
                                {row.name.slice(0, 2).toUpperCase()}
                              </span>
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate font-medium text-foreground">{row.name}</p>
                            <Link
                              href={`/restaurants/${row.id}`}
                              className="mt-0.5 block text-xs text-primary hover:underline"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {t("viewRestaurant")}
                            </Link>
                          </div>
                        </div>
                      </VisibleTableCell>
                      <VisibleTableCell
                        columnId="partner"
                        isVisible={isColumnVisible}
                        className="text-sm text-muted-foreground"
                      >
                        {row.partner_name}
                      </VisibleTableCell>
                      <VisibleTableCell
                        columnId="zone"
                        isVisible={isColumnVisible}
                        className="text-sm text-muted-foreground"
                      >
                        {row.zone_name}
                      </VisibleTableCell>
                      <VisibleTableCell
                        columnId="externalId"
                        isVisible={isColumnVisible}
                        className="font-mono text-xs text-muted-foreground"
                      >
                        {row.external_merchant_id ?? "—"}
                      </VisibleTableCell>
                      <VisibleTableCell columnId="status" isVisible={isColumnVisible}>
                        <Badge
                          variant={
                            row.status === "published"
                              ? "default"
                              : row.status === "archived"
                                ? "outline"
                                : "secondary"
                          }
                          className="rounded-lg"
                        >
                          {statusBadgeLabel(row.status)}
                        </Badge>
                      </VisibleTableCell>
                      <VisibleTableCell
                        columnId="drivers"
                        isVisible={isColumnVisible}
                        className="text-sm text-muted-foreground"
                      >
                        {t("driversCount", { count: row.driver_count })}
                      </VisibleTableCell>
                      <VisibleTableCell
                        columnId="activeDeliveries"
                        isVisible={isColumnVisible}
                        className="text-sm tabular-nums text-muted-foreground"
                      >
                        {row.active_deliveries}
                      </VisibleTableCell>
                      <VisibleTableCell
                        columnId="created"
                        isVisible={isColumnVisible}
                        className="text-sm text-muted-foreground"
                      >
                        {formatCreatedAt(row.created_at, locale)}
                      </VisibleTableCell>
                      <VisibleTableCell
                        columnId="actions"
                        isVisible={isColumnVisible}
                        className="text-end"
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                      >
                        <div
                          className="inline-flex items-center justify-end gap-0.5"
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
                                  className="h-8 w-8 shrink-0 cursor-pointer rounded-md text-muted-foreground hover:text-foreground"
                                  onClick={() => router.push(`/restaurants/${row.id}`)}
                                  aria-label={t("viewRestaurant")}
                                >
                                  <Eye className="h-4 w-4" />
                                </Button>
                              }
                            />
                            <TooltipContent>{t("viewRestaurant")}</TooltipContent>
                          </Tooltip>
                          {canAssignDrivers ? (
                            <Tooltip>
                              <TooltipTrigger
                                render={
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-sm"
                                    className="h-8 w-8 shrink-0 cursor-pointer rounded-md text-muted-foreground hover:text-foreground"
                                    onClick={() => setAssignRestaurant(row)}
                                    aria-label={t("assignDrivers")}
                                  >
                                    <Users className="h-3.5 w-3.5" />
                                  </Button>
                                }
                              />
                              <TooltipContent>{t("assignDrivers")}</TooltipContent>
                            </Tooltip>
                          ) : null}
                          {canManage ? (
                            <Tooltip>
                              <TooltipTrigger
                                render={
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-sm"
                                    className="h-8 w-8 shrink-0 cursor-pointer rounded-md text-muted-foreground hover:text-foreground"
                                    onClick={() => handleEdit(row)}
                                    aria-label={t("editRestaurant")}
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </Button>
                                }
                              />
                              <TooltipContent>{t("editRestaurant")}</TooltipContent>
                            </Tooltip>
                          ) : null}
                        </div>
                      </VisibleTableCell>
                    </AppDataTableRow>
                  ))
                : null}
            </AppDataTable>
          </CardContent>
        )}
      </AppListCard>
      {assignRestaurant ? (
        <DriverAssignSheet
          open={Boolean(assignRestaurant)}
          onOpenChange={(open) => !open && setAssignRestaurant(null)}
          mode="restaurant"
          entityId={assignRestaurant.id}
          entityName={assignRestaurant.name}
          defaultZoneId={assignRestaurant.zone_id}
        />
      ) : null}
    </AppPage>
  );
}

export function RestaurantsPageShell() {
  const mounted = useHasMounted();
  if (!mounted) return <RestaurantsPageSkeleton />;
  return <RestaurantsPageContent />;
}
