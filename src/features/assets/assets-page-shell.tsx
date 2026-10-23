"use client";

import { Suspense, useCallback, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ClipboardList,
  Download,
  FileText,
  Filter,
  Loader2,
  Package,
  Pencil,
  Plus,
  RefreshCw,
  X,
} from "lucide-react";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
import { ClearAllModuleButton } from "@/features/settings/clear-all-module-button";
import { AppListCard, AppPage, AppPageHeader } from "@/components/app";
import { useFleetBreadcrumbs } from "@/features/fleet/use-fleet-breadcrumbs";
import {
  AppListControls,
  GroupedSections,
  fieldSearchMatch,
  groupRows,
  useListControlLabels,
  useListViewPrefs,
} from "@/components/app/app-list-controls";
import { AppEmptyState } from "@/components/app/app-empty-state";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/contexts/auth-context";
import { FleetRequestPageShell } from "@/features/fuel/fleet-request-page-shell";
import { useRouter } from "@/i18n/navigation";
import { queryKeys } from "@/lib/query/query-keys";
import { cn } from "@/lib/utils";
import { TabBar } from "@/components/dashboard/tab-bar";
import { AssetDetailSheet } from "./asset-detail-sheet";
import { AssetFormSheet } from "./asset-form-sheet";
import { AssetsAssignmentsPanel } from "./assets-assignments-panel";
import { AssetsKpiStrip } from "./assets-kpi-strip";
import { AssetCatalogIcon } from "./asset-catalog-icon";
import { useAssetsCatalog } from "./use-assets";
import type { AssetCatalogRow } from "./types";

type StatusFilter = "all" | "lowStock" | "inactive" | "assigned";
const ASSET_TABS = ["assignments", "catalog", "request"] as const;
type AssetTab = (typeof ASSET_TABS)[number];

function parseAssetTab(value: string | null): AssetTab | null {
  return ASSET_TABS.includes(value as AssetTab) ? (value as AssetTab) : null;
}

function exportAssetsCsv(rows: AssetCatalogRow[]) {
  const header = [
    "id",
    "name",
    "code",
    "category",
    "penalty_kwd",
    "total_quantity",
    "assigned_qty",
    "available_qty",
    "holder_count",
    "is_active",
    "reorder_level",
  ];
  const escape = (v: string | number | boolean | null) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [
    header.join(","),
    ...rows.map((row) =>
      [
        row.id,
        row.name,
        row.code,
        row.category ?? "",
        row.penalty_kwd ?? "",
        row.total_quantity,
        row.assigned_qty,
        row.available_qty,
        row.holder_count,
        row.is_active,
        row.reorder_level,
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
  a.download = `assets-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function AssetsPageSkeleton() {
  return (
    <div className="flex h-48 items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}

function AssetsPageContent() {
  const t = useTranslations("pages.assets");
  const withHub = useFleetBreadcrumbs();
  const { can } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const canCreate = can("assets.create");
  const canEdit = can("assets.edit");
  const canViewAssets = can("assets.view");
  const canViewRequests = can("asset_requests.view");
  const queryClient = useQueryClient();
  const allowedTabs = useMemo(() => {
    const tabs: AssetTab[] = [];
    if (canViewAssets) {
      tabs.push("assignments", "catalog");
    }
    if (canViewRequests) tabs.push("request");
    return tabs;
  }, [canViewAssets, canViewRequests]);
  const requestedTab = parseAssetTab(searchParams.get("tab"));
  const tab =
    requestedTab && allowedTabs.includes(requestedTab)
      ? requestedTab
      : (allowedTabs[0] ?? "assignments");

  const { data, isLoading, refetch } = useAssetsCatalog();
  const items = data?.items ?? [];
  const kpis = data?.kpis ?? {
    total_skus: 0,
    total_units: 0,
    assigned_units: 0,
    available_units: 0,
    low_stock_count: 0,
  };

  const labels = useListControlLabels();
  const { prefs, update: updateListPrefs } = useListViewPrefs("assets");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [formOpen, setFormOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [editingAsset, setEditingAsset] = useState<AssetCatalogRow | null>(null);
  const [detailAsset, setDetailAsset] = useState<AssetCatalogRow | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const hasActiveFilters = statusFilter !== "all" || categoryFilter !== "all";

  const categories = useMemo(
    () =>
      [...new Set(items.map((row) => row.category).filter(Boolean) as string[])].sort(
        (a, b) => a.localeCompare(b),
      ),
    [items],
  );

  const visible = useMemo(() => {
    return items.filter((row) => {
      if (
        !fieldSearchMatch(row, search, {
          name: (item) => item.name,
          status: (item) => (item.is_active ? "active" : "inactive"),
          code: (item) => item.code,
          category: (item) => item.category,
          description: (item) => item.description,
        })
      ) {
        return false;
      }
      if (statusFilter === "lowStock" && !row.is_low_stock) return false;
      if (statusFilter === "inactive" && row.is_active) return false;
      if (statusFilter === "assigned" && row.holder_count === 0) return false;
      if (categoryFilter !== "all" && row.category !== categoryFilter) return false;
      return true;
    });
  }, [items, search, statusFilter, categoryFilter]);
  const grouped = useMemo(
    () =>
      groupRows(
        visible,
        prefs.groupBy,
        {
          status: (row) => (row.is_active ? "active" : "inactive"),
        },
        {
          active: t("statusActive"),
          inactive: t("statusInactive"),
        },
        "—",
      ),
    [prefs.groupBy, t, visible],
  );

  const invalidateAssets = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.assets.all() });
  }, [queryClient]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refetch();
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleAdd = () => {
    setEditingAsset(null);
    setFormOpen(true);
  };

  const handleEdit = (asset: AssetCatalogRow) => {
    setEditingAsset(asset);
    setFormOpen(true);
  };

  const handleViewDetail = (asset: AssetCatalogRow) => {
    setDetailAsset(asset);
    setDetailOpen(true);
  };

  const filterLabel = (value: StatusFilter) => {
    switch (value) {
      case "lowStock":
        return t("filterLowStock");
      case "inactive":
        return t("filterInactive");
      case "assigned":
        return t("filterAssigned");
      default:
        return t("filterAll");
    }
  };

  const showEmptySearch = !isLoading && items.length > 0 && visible.length === 0;
  const showEmptyAll = !isLoading && items.length === 0;

  const countLabel =
    visible.length !== items.length
      ? `${t("totalAssets", { count: visible.length })} ${t("ofTotal", { total: items.length })}`
      : t("totalAssets", { count: visible.length });

  return (
    <AppPage>
      <AppPageHeader
        breadcrumbs={withHub({ label: t("title") })}
        title={t("title")}
        description={
          tab === "assignments"
            ? t("assignmentsSubtitle")
            : tab === "request"
              ? t("requestSubtitle")
              : t("subtitle")
        }
        actions={
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {tab !== "request" ? <ClearAllModuleButton entity="assets" /> : null}
            {tab === "catalog" ? (
              <>
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
                  onClick={() => exportAssetsCsv(visible)}
                  disabled={visible.length === 0}
                >
                  <Download className="me-2 h-3.5 w-3.5" />
                  {t("export")}
                </Button>
              </>
            ) : null}
            {canCreate && tab === "catalog" ? (
              <Button
                type="button"
                size="sm"
                className="h-9 cursor-pointer rounded-lg"
                onClick={handleAdd}
              >
                <Plus className="me-2 h-3.5 w-3.5" />
                {t("addAsset")}
              </Button>
            ) : null}
          </div>
        }
      />
      {allowedTabs.length > 0 ? (
        <TabBar
          items={allowedTabs.map((id) => ({
            id,
            label:
              id === "assignments"
                ? t("tabAssignments")
                : id === "catalog"
                  ? t("tabCatalog")
                  : t("tabRequest"),
            icon: id === "assignments" ? ClipboardList : id === "catalog" ? Package : FileText,
          }))}
          activeId={tab}
          onSelect={(id) => router.replace(`/assets?tab=${id}`)}
        />
      ) : null}
      {tab === "assignments" ? <AssetsAssignmentsPanel /> : null}
      {tab === "request" ? <FleetRequestPageShell type="asset" embedded /> : null}
      {tab === "catalog" ? (
      <>
      <div className="space-y-3">
        <AssetsKpiStrip
          kpis={kpis}
          labels={{
            skus: t("kpiSkus"),
            units: t("kpiUnits"),
            assigned: t("kpiAssigned"),
            available: t("kpiAvailable"),
            lowStock: t("kpiLowStock"),
          }}
        />

        {kpis.low_stock_count > 0 ? (
          <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {t("lowStockBanner", { count: kpis.low_stock_count })}
          </div>
        ) : null}
      </div>

      <AppListCard
        toolbar={
          <AppListControls
            searchValue={search}
            onSearchChange={setSearch}
            searchPlaceholder={t("searchPlaceholder")}
            searchAriaLabel={t("searchPlaceholder")}
            clearSearchLabel={labels.clearSearch}
            groupByOptions={[labels.group.none, labels.group.status]}
            groupBy={prefs.groupBy}
            onGroupByChange={(value) => updateListPrefs({ groupBy: value })}
            groupByLabel={labels.groupBy}
            viewMode={prefs.viewMode}
            onViewModeChange={(value) => updateListPrefs({ viewMode: value })}
            tableViewLabel={labels.viewTable}
            cardsViewLabel={labels.viewCards}
            filterSlot={
              <DropdownMenu>
                <DropdownMenuTrigger
                  className={cn(
                    buttonVariants({ variant: "outline", size: "sm" }),
                    "h-9 shrink-0 cursor-pointer rounded-lg",
                  )}
                >
                  <Filter className="me-2 h-3.5 w-3.5" />
                  {t("filter")}
                  {hasActiveFilters ? (
                    <Badge
                      variant="secondary"
                      className="ms-2 h-5 min-w-5 rounded-full px-1.5 text-xs"
                    >
                      {(statusFilter !== "all" ? 1 : 0) + (categoryFilter !== "all" ? 1 : 0)}
                    </Badge>
                  ) : null}
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>{t("filterStatus")}</DropdownMenuLabel>
                    <DropdownMenuRadioGroup
                      value={statusFilter}
                      onValueChange={(v) => setStatusFilter((v as StatusFilter) ?? "all")}
                    >
                      {(["lowStock", "inactive", "assigned"] as const).map((value) => (
                        <DropdownMenuRadioItem key={value} value={value}>
                          {filterLabel(value)}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuGroup>
                  {categories.length > 0 ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuGroup>
                        <DropdownMenuLabel>{t("filterCategory")}</DropdownMenuLabel>
                        <DropdownMenuRadioGroup
                          value={categoryFilter}
                          onValueChange={(v) => setCategoryFilter(v ?? "all")}
                        >
                          <DropdownMenuRadioItem value="all">
                            {t("filterAllCategories")}
                          </DropdownMenuRadioItem>
                          {categories.map((category) => (
                            <DropdownMenuRadioItem key={category} value={category}>
                              {category}
                            </DropdownMenuRadioItem>
                          ))}
                        </DropdownMenuRadioGroup>
                      </DropdownMenuGroup>
                    </>
                  ) : null}
                  {hasActiveFilters ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="cursor-pointer text-muted-foreground"
                        onClick={() => {
                          setStatusFilter("all");
                          setCategoryFilter("all");
                        }}
                      >
                        {t("clearFilters")}
                      </DropdownMenuItem>
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            }
          />
        }
      >
        <CardContent className="p-0">
          {isLoading ? (
            <AssetsPageSkeleton />
          ) : showEmptyAll ? (
            <div className="py-12 text-center">
              <AppEmptyState
                title={t("emptyTitle")}
                description={t("emptyDescription")}
              />
              {canCreate ? (
                <Button type="button" className="mt-4" onClick={handleAdd}>
                  <Plus className="me-2 h-4 w-4" />
                  {t("addAsset")}
                </Button>
              ) : null}
            </div>
          ) : showEmptySearch ? (
            <div className="py-12 text-center">
              <AppEmptyState
                title={t("emptySearchTitle")}
                description={t("emptySearchDescription")}
              />
              <Button
                type="button"
                variant="outline"
                className="mt-4"
                onClick={() => {
                  setStatusFilter("all");
                  setCategoryFilter("all");
                }}
              >
                {t("clearFilters")}
              </Button>
            </div>
          ) : prefs.viewMode === "cards" ? (
            <div className="p-4">
              <p className="mb-3 text-xs text-muted-foreground">{countLabel}</p>
              <GroupedSections groups={grouped}>
                {(rows) => (
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {rows.map((row) => (
                      <button
                        type="button"
                        key={row.id}
                        className="w-full rounded-xl border border-border bg-card p-4 text-start shadow-sm hover:bg-muted/40"
                        onClick={() => handleViewDetail(row)}
                      >
                        <p className="truncate text-sm font-semibold">{row.name}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{row.code}</p>
                        <div className="mt-2">
                          <Badge variant={row.is_active ? "default" : "secondary"}>
                            {row.is_active ? t("statusActive") : t("statusInactive")}
                          </Badge>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </GroupedSections>
            </div>
          ) : (
            <>
              <p className="border-b border-border px-4 py-2 text-xs text-muted-foreground">
                {countLabel}
              </p>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className={TABLE_HEAD_CLASS}>{t("colAsset")}</TableHead>
                      <TableHead className={TABLE_HEAD_CLASS}>{t("colCategory")}</TableHead>
                      <TableHead className={TABLE_HEAD_CLASS}>{t("colInStock")}</TableHead>
                      <TableHead className={TABLE_HEAD_CLASS}>{t("colAssigned")}</TableHead>
                      <TableHead className={TABLE_HEAD_CLASS}>{t("colAvailable")}</TableHead>
                      <TableHead className={TABLE_HEAD_CLASS}>{t("colHolders")}</TableHead>
                      <TableHead className={TABLE_HEAD_CLASS}>{t("colStatus")}</TableHead>
                      <TableHead className={TABLE_HEAD_CLASS}>{t("colPenalty")}</TableHead>
                      <TableHead className={TABLE_HEAD_CLASS}>{t("colActions")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {grouped.flatMap((group) => [
                      ...(prefs.groupBy !== "none"
                        ? [
                            <TableRow key={`g-${group.key}`} className="bg-muted/40 hover:bg-muted/40">
                              <TableCell colSpan={9} className="text-xs font-semibold">
                                {group.label} · {group.rows.length}
                              </TableCell>
                            </TableRow>,
                          ]
                        : []),
                      ...group.rows.map((row) => (
                        <TableRow
                          key={row.id}
                          className="cursor-pointer"
                          onClick={() => handleViewDetail(row)}
                        >
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted/40 p-1">
                                <AssetCatalogIcon
                                  iconKey={row.icon_key}
                                  imageUrl={row.image_url}
                                  imgClassName="h-full w-full"
                                  iconClassName="h-4 w-4"
                                />
                              </span>
                              <div>
                                <p className="font-medium">{row.name}</p>
                                <p className="text-xs text-muted-foreground">{row.code}</p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            {row.category ? (
                              <Badge variant="secondary" className="font-normal">
                                {row.category}
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="tabular-nums">{row.total_quantity}</TableCell>
                          <TableCell className="tabular-nums">{row.assigned_qty}</TableCell>
                          <TableCell>
                            <Badge
                              variant="secondary"
                              className={cn(
                                row.is_low_stock &&
                                  "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200",
                              )}
                            >
                              {row.available_qty}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {row.holder_count > 0 ? (
                              <Button
                                type="button"
                                variant="link"
                                className="h-auto p-0"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleViewDetail(row);
                                }}
                              >
                                {row.holder_count}
                              </Button>
                            ) : (
                              <span className="text-muted-foreground">0</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge variant={row.is_active ? "default" : "secondary"}>
                              {row.is_active ? t("statusActive") : t("statusInactive")}
                            </Badge>
                          </TableCell>
                          <TableCell className="tabular-nums whitespace-nowrap">
                            {row.penalty_kwd != null ? (
                              `${row.penalty_kwd.toFixed(3)} KWD`
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center gap-1">
                              {canEdit ? (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => handleEdit(row)}
                                  aria-label={t("editAsset")}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                              ) : null}
                            </div>
                          </TableCell>
                        </TableRow>
                      )),
                    ])}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </AppListCard>
      </>
      ) : null}

      <AssetFormSheet
        asset={editingAsset}
        open={formOpen}
        onOpenChange={setFormOpen}
        onSaved={invalidateAssets}
      />

      <AssetDetailSheet
        asset={detailAsset}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onEdit={(asset) => {
          setDetailOpen(false);
          handleEdit(asset);
        }}
      />
    </AppPage>
  );
}

export function AssetsPageShell() {
  return (
    <Suspense fallback={<AssetsPageSkeleton />}>
      <AssetsPageContent />
    </Suspense>
  );
}
