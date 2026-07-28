"use client";

import { useCallback, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Download,
  Filter,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
import { AppListCard, AppPage, AppPageHeader } from "@/components/app";
import { AppEmptyState } from "@/components/app/app-empty-state";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { useHasMounted } from "@/hooks/use-has-mounted";
import { queryKeys } from "@/lib/query/query-keys";
import { cn } from "@/lib/utils";
import { AssetDetailSheet } from "./asset-detail-sheet";
import { AssetFormSheet } from "./asset-form-sheet";
import { AssetsKpiStrip } from "./assets-kpi-strip";
import { AssetCatalogIcon } from "./asset-catalog-icon";
import { useAssetsCatalog } from "./use-assets";
import type { AssetCatalogRow } from "./types";

type StatusFilter = "all" | "lowStock" | "inactive" | "assigned";

function exportAssetsCsv(rows: AssetCatalogRow[]) {
  const header = [
    "id",
    "name",
    "code",
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
  const locale = useLocale();
  const t = useTranslations("pages.assets");
  const { can } = useAuth();
  const canManage = can("assets.manage");
  const queryClient = useQueryClient();

  const { data, isLoading, refetch } = useAssetsCatalog();
  const items = data?.items ?? [];
  const kpis = data?.kpis ?? {
    total_skus: 0,
    total_units: 0,
    assigned_units: 0,
    available_units: 0,
    low_stock_count: 0,
  };

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [formOpen, setFormOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [editingAsset, setEditingAsset] = useState<AssetCatalogRow | null>(null);
  const [detailAsset, setDetailAsset] = useState<AssetCatalogRow | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const hasActiveFilters = statusFilter !== "all";

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((row) => {
      if (
        q &&
        !(
          row.name.toLowerCase().includes(q) ||
          row.code.toLowerCase().includes(q) ||
          (row.description?.toLowerCase().includes(q) ?? false)
        )
      ) {
        return false;
      }
      if (statusFilter === "lowStock" && !row.is_low_stock) return false;
      if (statusFilter === "inactive" && row.is_active) return false;
      if (statusFilter === "assigned" && row.holder_count === 0) return false;
      return true;
    });
  }, [items, search, statusFilter]);

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
              onClick={() => exportAssetsCsv(visible)}
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
                {t("addAsset")}
              </Button>
            ) : null}
          </div>
        }
      />

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
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("searchPlaceholder")}
                className="h-9 rounded-lg ps-9 pe-9"
              />
              {search ? (
                <button
                  type="button"
                  className="absolute end-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                  onClick={() => setSearch("")}
                  aria-label={t("clearSearch")}
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </div>
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
                    className="ms-2 h-5 min-w-5 rounded-full px-1.5 text-[10px]"
                  >
                    1
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
                    {(["all", "lowStock", "inactive", "assigned"] as const).map((value) => (
                      <DropdownMenuRadioItem key={value} value={value}>
                        {filterLabel(value)}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuGroup>
                {hasActiveFilters ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="cursor-pointer text-muted-foreground"
                      onClick={() => setStatusFilter("all")}
                    >
                      {t("clearFilters")}
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
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
              {canManage ? (
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
                onClick={() => setStatusFilter("all")}
              >
                {t("clearFilters")}
              </Button>
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
                      <TableHead className={TABLE_HEAD_CLASS}>{t("colInStock")}</TableHead>
                      <TableHead className={TABLE_HEAD_CLASS}>{t("colAssigned")}</TableHead>
                      <TableHead className={TABLE_HEAD_CLASS}>{t("colAvailable")}</TableHead>
                      <TableHead className={TABLE_HEAD_CLASS}>{t("colHolders")}</TableHead>
                      <TableHead className={TABLE_HEAD_CLASS}>{t("colStatus")}</TableHead>
                      <TableHead className={TABLE_HEAD_CLASS}>{t("colActions")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visible.map((row) => (
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
                                <p className="text-[11px] text-muted-foreground">{row.code}</p>
                              </div>
                            </div>
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
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center gap-1">
                              {canManage ? (
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
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </AppListCard>

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
  const mounted = useHasMounted();
  if (!mounted) return <AssetsPageSkeleton />;
  return <AssetsPageContent />;
}
