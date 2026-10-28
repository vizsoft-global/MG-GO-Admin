"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter, Link } from "@/i18n/navigation";
import { Eye, Loader2, Pencil, Plus, RefreshCw, Users } from "lucide-react";
import { AppListCard, AppPage, AppPageHeader } from "@/components/app";
import {
  FlatListPager,
  GroupedSections,
  GroupTableHeaderRow,
  fieldSearchMatch,
  groupRows,
  useGroupedListView,
} from "@/components/app/app-list-controls";
import {
  AppDataTable,
  AppDataTableEmpty,
  AppDataTableRow,
  TableCell,
} from "@/components/app";
import {
  EmptyCell,
  TableNameCell,
  TableToolbar,
  useTablePrefs,
  type TableToolbarColumn,
} from "@/components/app/table-toolbar";
import { AppEmptyState } from "@/components/app/app-empty-state";
import { TabBar } from "@/components/dashboard/tab-bar";
import { Button } from "@/components/ui/button";
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
  const toolbarColumns = useMemo((): TableToolbarColumn[] => {
    const cols: TableToolbarColumn[] = [
      { id: "restaurant", label: t("colRestaurant"), locked: true },
      { id: "partner", label: t("colPartner"), categorical: true },
      { id: "zone", label: t("colZone"), categorical: true },
      { id: "externalId", label: t("colExternalId") },
      { id: "status", label: t("colStatus"), categorical: true },
      { id: "drivers", label: t("colDrivers") },
      { id: "activeDeliveries", label: t("colActiveDeliveries") },
      { id: "created", label: t("colCreated") },
      { id: "actions", label: t("colActions") },
    ];
    return cols;
  }, [t]);
  const tablePrefs = useTablePrefs("restaurants", toolbarColumns);
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

  const visible = useMemo(() => {
    return restaurants.filter((r) => {
      if (
        !fieldSearchMatch(r, tablePrefs.appliedQuery, {
          name: (row) => row.name,
          zone: (row) => row.zone_name,
          status: (row) => row.status,
          partner: (row) => row.partner_name,
          merchant: (row) => row.external_merchant_id,
        })
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
    tablePrefs.appliedQuery,
    statusFilter,
    partnerFilter,
    zoneFilter,
    hasDriversFilter,
    hasLocationFilter,
  ]);
  const grouped = useMemo(
    () =>
      groupRows(
        visible,
        tablePrefs.groupBy,
        {
          status: (row) => row.status,
          zone: (row) => row.zone_name,
          partner: (row) => row.partner_name,
        },
        {},
        "—",
      ),
    [tablePrefs.groupBy, visible],
  );
  const listView = useGroupedListView(
    grouped,
    tablePrefs.groupBy !== "none",
    `${tablePrefs.groupBy}\u0001${tablePrefs.appliedQuery}\u0001${statusFilter}\u0001${partnerFilter}\u0001${zoneFilter}\u0001${hasDriversFilter}\u0001${hasLocationFilter}`,
  );

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

  const showEmptySearch =
    !isLoading && restaurants.length > 0 && visible.length === 0;
  const showEmptyAll = !isLoading && restaurants.length === 0;

  const tableColumns = tablePrefs.orderedColumns
    .filter((column) => tablePrefs.isVisible(column.id))
    .map((column) => ({
      id: column.id,
      label: column.label,
      className:
        column.id === "actions"
          ? cn("text-end", canManage || canAssignDrivers ? "w-28" : "w-16")
          : undefined,
    }));

  const filterChips = [
    ...(statusFilter !== "all"
      ? [{ id: "status", label: `${t("filterStatus")}: ${statusFilterLabel(statusFilter)}` }]
      : []),
    ...(partnerFilter !== "all"
      ? [{
          id: "partner",
          label: `${t("filterPartner")}: ${partnerSelectItems.find((item) => item.value === partnerFilter)?.label ?? ""}`,
        }]
      : []),
    ...(zoneFilter !== "all"
      ? [{
          id: "zone",
          label: `${t("filterZone")}: ${zoneSelectItems.find((item) => item.value === zoneFilter)?.label ?? ""}`,
        }]
      : []),
    ...(hasDriversFilter !== "all"
      ? [{
          id: "drivers",
          label: `${t("filterHasDrivers")}: ${hasDriversSelectItems.find((item) => item.value === hasDriversFilter)?.label ?? ""}`,
        }]
      : []),
    ...(hasLocationFilter !== "all"
      ? [{
          id: "location",
          label: `${t("filterHasLocation")}: ${hasLocationSelectItems.find((item) => item.value === hasLocationFilter)?.label ?? ""}`,
        }]
      : []),
  ];

  const toolbar = (
    <TableToolbar
      prefs={tablePrefs}
      entity={t("title")}
      columns={toolbarColumns}
      rowKind="dynamic"
      entityList
      filteredCount={visible.length}
      totalCount={restaurants.length}
      onExport={() => exportRestaurantsCsv(visible, t)}
      onAdd={canManage ? handleAdd : undefined}
      addLabel={t("addRestaurant")}
      chips={filterChips}
      onRemoveChip={(id) => {
        if (id === "status") setStatusFilter("all");
        if (id === "partner") setPartnerFilter("all");
        if (id === "zone") setZoneFilter("all");
        if (id === "drivers") setHasDriversFilter("all");
        if (id === "location") setHasLocationFilter("all");
      }}
      onClearChips={clearAllFilters}
    />
  );

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
          </div>
        }
      />
      <AppListCard
        toolbar={
          <div className="flex flex-col gap-2">
            <TabBar
              items={statusTabs}
              activeId={statusFilter}
              onSelect={(id) => setStatusFilter(id as StatusFilter)}
              className="border-b-0"
            />
            <div className="flex flex-wrap gap-2">
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
                onChange={(v) => setHasDriversFilter((v as HasDriversFilter) ?? "all")}
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
                onChange={(v) => setHasLocationFilter((v as HasLocationFilter) ?? "all")}
                placeholder={t("filterHasLocation")}
                searchPlaceholder={t("filterHasLocation")}
                defaultLimit={8}
                recentsKey="restaurants-has-location-filter"
                className="w-full min-w-[140px] sm:w-[160px]"
                clearable={false}
              />
            </div>
          </div>
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
        ) : tablePrefs.view === "grid" ? (
          <CardContent className="p-0">
            {toolbar}
            {showEmptySearch ? (
              <AppEmptyState
                title={t("emptySearchTitle")}
                description={t("emptySearchDescription")}
              />
            ) : (
              <GroupedSections
                groups={grouped}
                paged
                resetKey={`${tablePrefs.groupBy}\u0001${tablePrefs.appliedQuery}\u0001${statusFilter}\u0001${partnerFilter}\u0001${zoneFilter}\u0001${hasDriversFilter}\u0001${hasLocationFilter}`}
              >
                {(rows) => (
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {rows.map((row) => (
                      <button
                        type="button"
                        key={row.id}
                        className="w-full rounded-xl border border-border bg-card p-4 text-start shadow-sm hover:bg-muted/40"
                        onClick={() => handleRowClick(row)}
                      >
                        <p className="truncate text-sm font-semibold">{row.name}</p>
                        <p className="mt-1 truncate text-xs text-muted-foreground">
                          {row.partner_name || row.zone_name || "—"}
                        </p>
                        <div className="mt-2">
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
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </GroupedSections>
            )}
          </CardContent>
        ) : (
          <CardContent className="p-0">
            <FlatListPager pager={listView.flatPager} onStep={listView.stepFlat} />
            <AppDataTable
              toolbar={toolbar}
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
                ? listView.sections.flatMap((section) => [
                    ...(section.showHeader
                      ? [
                          <GroupTableHeaderRow
                            key={`g-${section.key}`}
                            colSpan={tableColumns.length}
                            label={section.label}
                            total={section.total}
                            open={section.open}
                            page={section.page}
                            showPager={section.showPager}
                            onToggle={() => listView.toggle(section.key)}
                            onStep={(dir) => listView.step(section.key, dir)}
                          />,
                        ]
                      : []),
                    ...section.visibleRows.map((row) => (
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
                      {tableColumns.map((column) => {
                        if (column.id === "restaurant") {
                          return (
                      <TableCell key={column.id}>
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
                              <span className="text-xs font-medium text-muted-foreground">
                                {row.name.slice(0, 2).toUpperCase()}
                              </span>
                            )}
                          </div>
                          <div className="min-w-0">
                            <TableNameCell name={row.name} />
                            <Link
                              href={`/restaurants/${row.id}`}
                              className="mt-0.5 block text-xs text-primary hover:underline"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {t("viewRestaurant")}
                            </Link>
                          </div>
                        </div>
                      </TableCell>
                          );
                        }
                        if (column.id === "partner") {
                          return (
                      <TableCell key={column.id} className="text-sm text-muted-foreground">
                        {row.partner_name ? row.partner_name : <EmptyCell />}
                      </TableCell>
                          );
                        }
                        if (column.id === "zone") {
                          return (
                      <TableCell key={column.id} className="text-sm text-muted-foreground">
                        {row.zone_name ? row.zone_name : <EmptyCell />}
                      </TableCell>
                          );
                        }
                        if (column.id === "externalId") {
                          return (
                      <TableCell key={column.id} className="font-mono text-xs text-muted-foreground">
                        {row.external_merchant_id ? row.external_merchant_id : <EmptyCell />}
                      </TableCell>
                          );
                        }
                        if (column.id === "status") {
                          return (
                      <TableCell key={column.id}>
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
                      </TableCell>
                          );
                        }
                        if (column.id === "drivers") {
                          return (
                      <TableCell key={column.id} className="text-sm text-muted-foreground">
                        {t("driversCount", { count: row.driver_count })}
                      </TableCell>
                          );
                        }
                        if (column.id === "activeDeliveries") {
                          return (
                      <TableCell key={column.id} className="text-sm tabular-nums text-muted-foreground">
                        {row.active_deliveries}
                      </TableCell>
                          );
                        }
                        if (column.id === "created") {
                          return (
                      <TableCell key={column.id} className="text-sm text-muted-foreground">
                        {formatCreatedAt(row.created_at, locale)}
                      </TableCell>
                          );
                        }
                        if (column.id === "actions") {
                          return (
                      <TableCell
                        key={column.id}
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
                      </TableCell>
                          );
                        }
                        return null;
                      })}
                    </AppDataTableRow>
                    )),
                  ])
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
  return <RestaurantsPageContent />;
}
