"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import {
  ClipboardList,
  Download,
  Eye,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Upload,
  X,
} from "lucide-react";
import { AppListCard } from "@/components/app/app-list-card";
import {
  AppDataTable,
  AppDataTableRow,
  TableCell,
} from "@/components/app/app-data-table";
import { AppPage } from "@/components/app/app-page";
import { AppPageHeader } from "@/components/app/app-page-header";
import { AppEmptyState } from "@/components/app/app-empty-state";
import { KpiGrid } from "@/components/dashboard/kpi-grid";
import { TabBar } from "@/components/dashboard/tab-bar";
import { StatusPill } from "@/components/dashboard/status-pill";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SearchSelect } from "@/components/ui/search-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { driverSearchOptions, restaurantSearchOptions } from "@/lib/search-options";
import { cn } from "@/lib/utils";
import { usePartnersList } from "@/features/partners/use-partners";
import { useRestaurantsList } from "@/features/restaurants/use-restaurants";
import { toast } from "sonner";
import { AddVerificationDialog } from "./add-verification-dialog";
import { BulkImportDialog } from "./import/bulk-import-dialog";
import { VerificationDetailSheet } from "./verification-detail-sheet";
import {
  useInfiniteVerifications,
  useVerificationDriverOptions,
  useVerificationExportData,
  useVerificationListStats,
} from "./use-verifications";
import {
  VERIFICATION_SOURCES,
  VERIFICATION_STATUSES,
  type VerificationListRow,
  type VerificationSortKey,
  type VerificationSource,
  type VerificationStatus,
  type VerificationTabFilter,
} from "./types";
import { resolveStatusVariant } from "@/lib/ui/resolve-status-variant";

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en", {
      dateStyle: "medium",
      timeZone: "Asia/Kuwait",
    }).format(new Date(`${iso}T12:00:00Z`));
  } catch {
    return iso;
  }
}

type ExportTarget = "all" | "restaurantMaster" | "zoneMaster" | "partnerMaster" | "sampleImport";

function toCsv(values: Array<Record<string, string | number | null | undefined>>): string {
  if (values.length === 0) return "";
  const header = Object.keys(values[0] ?? {});
  const escape = (value: string | number | null | undefined) => {
    const s = String(value ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [
    header.join(","),
    ...values.map((row) => header.map((key) => escape(row[key])).join(",")),
  ].join("\n");
}

function downloadCsv(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportVisibleVerificationsCsv(
  rows: VerificationListRow[],
  t: ReturnType<typeof useTranslations<"pages.verifications">>,
) {
  const header = [
    "service_date",
    "driver_name",
    "driver_code",
    "employee_id",
    "restaurant_name",
    "partner_name",
    "reported_count",
    "matched_count",
    "shortfall_count",
    "status",
    "source",
  ];
  const escape = (v: string | number | null | undefined) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [
    header.join(","),
    ...rows.map((r) =>
      [
        r.service_date,
        r.driver_name,
        r.driver_code,
        r.employee_id ?? "",
        r.restaurant_name,
        r.partner_name,
        r.reported_count,
        r.matched_count,
        r.shortfall_count,
        r.status,
        r.source,
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
  a.download = `dpd-verifications-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast.success(t("exportListSuccess"));
}

const SORT_KEYS: VerificationSortKey[] = [
  "service_date",
  "shortfall_count",
  "reported_count",
  "matched_count",
  "status",
];

export function VerificationsPageShell() {
  const t = useTranslations("pages.verifications");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [tabFilter, setTabFilter] = useState<VerificationTabFilter>("all");
  const [statusFilter, setStatusFilter] = useState<VerificationStatus | "all">("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [driverId, setDriverId] = useState("");
  const [restaurantId, setRestaurantId] = useState("");
  const [partnerId, setPartnerId] = useState("");
  const [sourceFilter, setSourceFilter] = useState<VerificationSource | "all">("all");
  const [sortBy, setSortBy] = useState<VerificationSortKey>("service_date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [selected, setSelected] = useState<VerificationListRow | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const filters = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      status: statusFilter,
      tab: statusFilter === "all" ? tabFilter : undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      driverId: driverId || undefined,
      restaurantId: restaurantId || undefined,
      partnerId: partnerId || undefined,
      source: sourceFilter,
      sortBy,
      sortDir,
    }),
    [
      debouncedSearch,
      statusFilter,
      tabFilter,
      dateFrom,
      dateTo,
      driverId,
      restaurantId,
      partnerId,
      sourceFilter,
      sortBy,
      sortDir,
    ],
  );

  const statsFilters = useMemo(
    () => ({
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      partnerId: partnerId || undefined,
    }),
    [dateFrom, dateTo, partnerId],
  );

  const {
    data,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch,
    isRefetching,
  } = useInfiniteVerifications(filters);

  const { data: stats } = useVerificationListStats(statsFilters);

  const rows = useMemo(
    () => data?.pages.flatMap((p) => p.rows) ?? [],
    [data],
  );

  const totalCount = data?.pages[0]?.totalCount ?? 0;

  const { data: drivers = [] } = useVerificationDriverOptions("");
  const { data: restaurants = [] } = useRestaurantsList();
  const { data: partners = [] } = usePartnersList();
  const { refetch: loadExportData } = useVerificationExportData(false);

  const dateStamp = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const driverFilterItems = useMemo(
    () => [
      { value: "all", label: t("filterDriverAll"), keywords: [t("filterDriverAll")] },
      ...driverSearchOptions(
        drivers.map((d) => ({
          id: d.id,
          full_name: d.full_name,
          employee_code: d.driver_code,
          employee_id: d.employee_id,
        })),
      ),
    ],
    [drivers, t],
  );

  const restaurantFilterItems = useMemo(
    () => [
      { value: "all", label: t("filterRestaurantAll"), keywords: [t("filterRestaurantAll")] },
      ...restaurantSearchOptions(
        restaurants.filter((r) => r.status === "published"),
      ),
    ],
    [restaurants, t],
  );

  const partnerFilterItems = useMemo(
    () => [
      { value: "all", label: t("filterPartnerAll"), keywords: [t("filterPartnerAll")] },
      ...partners.map((p) => ({
        value: p.id,
        label: p.name,
        keywords: [p.name, p.id],
      })),
    ],
    [partners, t],
  );

  const statusItems = useMemo(
    () => [
      { value: "all", label: t("filterStatusAll") },
      ...VERIFICATION_STATUSES.map((s) => ({
        value: s,
        label: t(`status.${s}`),
      })),
    ],
    [t],
  );

  const sourceItems = useMemo(
    () => [
      { value: "all", label: t("filterSourceAll") },
      ...VERIFICATION_SOURCES.map((s) => ({
        value: s,
        label: t(`source.${s}`),
      })),
    ],
    [t],
  );

  const sortItems = useMemo(
    () =>
      SORT_KEYS.flatMap((key) => [
        { value: `${key}:desc`, label: t(`sort.${key}Desc`) },
        { value: `${key}:asc`, label: t(`sort.${key}Asc`) },
      ]),
    [t],
  );

  const tabItems = useMemo(
    () => [
      { id: "all", label: t("tabAll") },
      { id: "needs_action", label: t("tabNeedsAction") },
      { id: "deficit", label: t("tabDeficit") },
      { id: "pending", label: t("tabPending") },
      { id: "matched", label: t("tabMatched") },
    ],
    [t],
  );

  const kpiItems = useMemo(
    () => [
      { label: t("kpiTotal"), value: stats?.total ?? "—" },
      { label: t("kpiNeedsAction"), value: stats?.needs_action ?? "—" },
      { label: t("kpiMatched"), value: stats?.matched ?? "—" },
      { label: t("kpiDeficit"), value: stats?.deficit ?? "—" },
      { label: t("kpiPending"), value: stats?.pending ?? "—" },
    ],
    [stats, t],
  );

  const tableColumns = useMemo(
    () => [
      { id: "date", label: t("colDate"), className: "w-[7.5rem]" },
      { id: "driver", label: t("colDriver") },
      { id: "employee", label: t("colEmployeeId"), className: "hidden lg:table-cell w-[6.5rem]" },
      { id: "restaurant", label: t("colRestaurant"), className: "hidden md:table-cell" },
      { id: "partner", label: t("colPartner"), className: "hidden xl:table-cell" },
      { id: "counts", label: t("colCounts"), className: "w-[7rem] text-end" },
      { id: "shortfall", label: t("colShortfall"), className: "hidden sm:table-cell w-[5rem] text-end" },
      { id: "status", label: t("colStatus"), className: "w-[7.5rem]" },
      { id: "source", label: t("colSource"), className: "hidden lg:table-cell w-[5.5rem]" },
      { id: "actions", label: t("colActions"), className: "w-[4rem] text-end" },
    ],
    [t],
  );

  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el || !hasNextPage) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void fetchNextPage();
      },
      { rootMargin: "240px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasNextPage, fetchNextPage]);

  const handleExport = async (target: ExportTarget) => {
    setIsExporting(true);
    try {
      const result = await loadExportData();
      const payload = result.data;
      if (!payload) {
        toast.error(t("exportFailed"));
        return;
      }

      const files =
        target === "all"
          ? (["restaurantMaster", "zoneMaster", "partnerMaster", "sampleImport"] as const)
          : ([target] as const);

      for (const fileTarget of files) {
        if (fileTarget === "restaurantMaster") {
          const csv = toCsv(payload.restaurants);
          downloadCsv(csv, `dpd-verification-restaurant-master-${dateStamp}.csv`);
        } else if (fileTarget === "zoneMaster") {
          const csv = toCsv(payload.zones);
          downloadCsv(csv, `dpd-verification-zone-master-${dateStamp}.csv`);
        } else if (fileTarget === "partnerMaster") {
          const csv = toCsv(payload.partners);
          downloadCsv(csv, `dpd-verification-partner-master-${dateStamp}.csv`);
        } else {
          const csv = toCsv(payload.sampleImport);
          downloadCsv(csv, `dpd-verification-sample-import-${dateStamp}.csv`);
        }
      }
    } catch {
      toast.error(t("exportFailed"));
    } finally {
      setIsExporting(false);
    }
  };

  const openDetail = (row: VerificationListRow) => {
    setSelected(row);
    setDetailOpen(true);
  };

  const hasActiveFilters =
    Boolean(debouncedSearch) ||
    statusFilter !== "all" ||
    tabFilter !== "all" ||
    Boolean(dateFrom) ||
    Boolean(dateTo) ||
    Boolean(driverId) ||
    Boolean(restaurantId) ||
    Boolean(partnerId) ||
    sourceFilter !== "all";

  const clearFilters = () => {
    setSearch("");
    setDebouncedSearch("");
    setTabFilter("all");
    setStatusFilter("all");
    setDateFrom("");
    setDateTo("");
    setDriverId("");
    setRestaurantId("");
    setPartnerId("");
    setSourceFilter("all");
    setSortBy("service_date");
    setSortDir("desc");
  };

  return (
    <AppPage>
      <AppPageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="cursor-pointer rounded-lg"
              disabled={isRefetching}
              onClick={() => void refetch()}
            >
              <RefreshCw
                className={cn("me-2 h-3.5 w-3.5", isRefetching && "animate-spin")}
              />
              {t("refresh")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="cursor-pointer rounded-lg"
              nativeButton={false}
              render={<Link href="/dpd-verification/imports" />}
            >
              <ClipboardList className="me-2 h-3.5 w-3.5" />
              {t("importHistory")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="cursor-pointer rounded-lg"
              onClick={() => setImportOpen(true)}
            >
              <Upload className="me-2 h-3.5 w-3.5" />
              {t("bulkImport")}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                className={cn(
                  buttonVariants({ variant: "outline", size: "sm" }),
                  "h-8 cursor-pointer rounded-lg",
                )}
                disabled={isExporting}
              >
                {isExporting ? (
                  <Loader2 className="me-2 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="me-2 h-3.5 w-3.5" />
                )}
                {t("export")}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem
                  className="cursor-pointer"
                  onClick={() => exportVisibleVerificationsCsv(rows, t)}
                  disabled={rows.length === 0}
                >
                  {t("exportOptionList")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="cursor-pointer"
                  onClick={() => void handleExport("all")}
                >
                  {t("exportOptionAll")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="cursor-pointer"
                  onClick={() => void handleExport("restaurantMaster")}
                >
                  {t("exportOptionRestaurantMaster")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="cursor-pointer"
                  onClick={() => void handleExport("zoneMaster")}
                >
                  {t("exportOptionZoneMaster")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="cursor-pointer"
                  onClick={() => void handleExport("partnerMaster")}
                >
                  {t("exportOptionPartnerMaster")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="cursor-pointer"
                  onClick={() => void handleExport("sampleImport")}
                >
                  {t("exportOptionSampleImport")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              type="button"
              size="sm"
              className="cursor-pointer rounded-lg"
              onClick={() => setAddOpen(true)}
            >
              <Plus className="me-2 h-3.5 w-3.5" />
              {t("addVerification")}
            </Button>
          </div>
        }
      />

      <KpiGrid items={kpiItems} />

      <AppListCard
        toolbar={
          <div className="flex flex-col gap-3 p-4">
            <TabBar
              items={tabItems}
              activeId={tabFilter}
              onSelect={(id) => {
                setTabFilter(id as VerificationTabFilter);
                setStatusFilter("all");
              }}
              className="border-b-0 pb-0"
            />
            <div className="relative w-full max-w-xl">
              <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("searchPlaceholder")}
                className="rounded-lg ps-9"
              />
              {search ? (
                <button
                  type="button"
                  className="absolute end-2 top-1/2 -translate-y-1/2 cursor-pointer text-muted-foreground"
                  onClick={() => setSearch("")}
                  aria-label={t("clearSearch")}
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <Select
                items={statusItems}
                value={statusFilter}
                onValueChange={(v) => {
                  if (!v) return;
                  setStatusFilter(v as VerificationStatus | "all");
                  if (v !== "all") setTabFilter("all");
                }}
              >
                <SelectTrigger className="h-8 w-40 cursor-pointer rounded-lg text-sm">
                  <SelectValue placeholder={t("filterStatus")} />
                </SelectTrigger>
                <SelectContent>
                  {statusItems.map((item) => (
                    <SelectItem key={item.value} value={item.value} label={item.label}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="h-8 w-36 rounded-lg text-sm"
                aria-label={t("dateFrom")}
              />
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="h-8 w-36 rounded-lg text-sm"
                aria-label={t("dateTo")}
              />
              <SearchSelect
                items={driverFilterItems}
                value={driverId || "all"}
                onChange={(v) => setDriverId(v === "all" ? "" : (v ?? ""))}
                placeholder={t("filterDriver")}
                searchPlaceholder={t("filterDriver")}
                defaultLimit={10}
                recentsKey="verifications-driver-filter"
                className="h-8 w-44 text-sm"
                clearable={false}
              />
              <SearchSelect
                items={restaurantFilterItems}
                value={restaurantId || "all"}
                onChange={(v) => setRestaurantId(v === "all" ? "" : (v ?? ""))}
                placeholder={t("filterRestaurant")}
                searchPlaceholder={t("filterRestaurant")}
                defaultLimit={10}
                recentsKey="verifications-restaurant-filter"
                className="h-8 w-44 text-sm"
                clearable={false}
              />
              <SearchSelect
                items={partnerFilterItems}
                value={partnerId || "all"}
                onChange={(v) => setPartnerId(v === "all" ? "" : (v ?? ""))}
                placeholder={t("filterPartner")}
                searchPlaceholder={t("filterPartner")}
                defaultLimit={10}
                recentsKey="verifications-partner-filter"
                className="h-8 w-44 text-sm"
                clearable={false}
              />
              <Select
                items={sourceItems}
                value={sourceFilter}
                onValueChange={(v) => {
                  if (v) setSourceFilter(v as VerificationSource | "all");
                }}
              >
                <SelectTrigger className="h-8 w-36 cursor-pointer rounded-lg text-sm">
                  <SelectValue placeholder={t("filterSource")} />
                </SelectTrigger>
                <SelectContent>
                  {sourceItems.map((item) => (
                    <SelectItem key={item.value} value={item.value} label={item.label}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                items={sortItems}
                value={`${sortBy}:${sortDir}`}
                onValueChange={(v) => {
                  if (!v) return;
                  const [key, dir] = v.split(":") as [VerificationSortKey, "asc" | "desc"];
                  setSortBy(key);
                  setSortDir(dir);
                }}
              >
                <SelectTrigger className="h-8 min-w-[10rem] cursor-pointer rounded-lg text-sm">
                  <SelectValue placeholder={t("sortLabel")} />
                </SelectTrigger>
                <SelectContent>
                  {sortItems.map((item) => (
                    <SelectItem key={item.value} value={item.value} label={item.label}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {hasActiveFilters ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 cursor-pointer rounded-lg text-muted-foreground"
                  onClick={clearFilters}
                >
                  {t("clearFilters")}
                </Button>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">
              {t("resultCount", { shown: rows.length, total: totalCount })}
            </p>
          </div>
        }
      >
        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <div className="px-6 py-12">
            <AppEmptyState
              title={hasActiveFilters ? t("emptySearchTitle") : t("emptyTitle")}
              description={
                hasActiveFilters ? t("emptySearchDescription") : t("emptyDescription")
              }
            />
          </div>
        ) : (
          <CardContent className="p-0">
            <AppDataTable columns={tableColumns}>
              {rows.map((row) => (
                <AppDataTableRow
                  key={row.id}
                  className="cursor-pointer"
                  onClick={() => openDetail(row)}
                >
                  <TableCell className="whitespace-nowrap text-sm tabular-nums">
                    {formatDate(row.service_date)}
                  </TableCell>
                  <TableCell>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{row.driver_name}</p>
                      <p className="text-xs text-muted-foreground">#{row.driver_code}</p>
                    </div>
                  </TableCell>
                  <TableCell className="hidden font-mono text-xs tabular-nums lg:table-cell">
                    {row.employee_id ?? "—"}
                  </TableCell>
                  <TableCell className="hidden max-w-[12rem] truncate text-sm md:table-cell">
                    {row.restaurant_name}
                  </TableCell>
                  <TableCell className="hidden max-w-[10rem] truncate text-sm text-muted-foreground xl:table-cell">
                    {row.partner_name}
                  </TableCell>
                  <TableCell className="text-end text-sm tabular-nums">
                    <span className="font-medium">{row.matched_count}</span>
                    <span className="text-muted-foreground"> / {row.reported_count}</span>
                  </TableCell>
                  <TableCell
                    className={cn(
                      "hidden text-end text-sm tabular-nums sm:table-cell",
                      row.shortfall_count > 0 && "font-medium text-destructive",
                    )}
                  >
                    {row.shortfall_count}
                  </TableCell>
                  <TableCell>
                    <StatusPill variant={resolveStatusVariant(row.status)} dot={false}>
                      {t(`status.${row.status}`)}
                    </StatusPill>
                  </TableCell>
                  <TableCell className="hidden text-xs capitalize text-muted-foreground lg:table-cell">
                    {t(`source.${row.source}`)}
                  </TableCell>
                  <TableCell className="text-end">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="h-8 w-8 cursor-pointer rounded-lg"
                      aria-label={t("viewDetail")}
                      onClick={(e) => {
                        e.stopPropagation();
                        openDetail(row);
                      }}
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </AppDataTableRow>
              ))}
            </AppDataTable>
            <div ref={loadMoreRef} className="flex flex-col items-center gap-2 border-t border-border py-4">
              {isFetchingNextPage ? (
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              ) : hasNextPage ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="cursor-pointer rounded-lg"
                  onClick={() => void fetchNextPage()}
                >
                  {t("loadMore")}
                </Button>
              ) : rows.length > 0 ? (
                <p className="text-xs text-muted-foreground">{t("endOfList")}</p>
              ) : null}
            </div>
          </CardContent>
        )}
      </AppListCard>

      <AddVerificationDialog open={addOpen} onOpenChange={setAddOpen} />
      <BulkImportDialog open={importOpen} onOpenChange={setImportOpen} />
      <VerificationDetailSheet
        row={selected}
        open={detailOpen}
        onOpenChange={setDetailOpen}
      />
    </AppPage>
  );
}
