"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import {
  Activity,
  Ban,
  Camera,
  CheckCircle2,
  Clock,
  Download,
  Eye,
  FileSpreadsheet,
  Loader2,
  MoreVertical,
  Package,
  RefreshCw,
  Search,
  X,
  XCircle,
} from "lucide-react";
import { AppListCard } from "@/components/app/app-list-card";
import {
  AppDataTable,
  AppDataTableEmpty,
  AppDataTableRow,
  AppTableColumnPicker,
  TableCell,
  VisibleTableCell,
} from "@/components/app";
import { AppPage } from "@/components/app/app-page";
import { AppEmptyState } from "@/components/app/app-empty-state";
import {
  DATE_RANGE_ALL,
  DateRangeFilter,
  type DateRangeValue,
} from "@/components/app/date-range-filter";
import { useTableColumnVisibility } from "@/hooks/use-table-column-visibility";
import { KpiGrid } from "@/components/dashboard/kpi-grid";
import { StatusPill } from "@/components/dashboard/status-pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CardContent } from "@/components/ui/card";
import { SearchSelect } from "@/components/ui/search-select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useHasMounted } from "@/hooks/use-has-mounted";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { queryKeys } from "@/lib/query/query-keys";
import { useRealtimeInvalidator } from "@/lib/realtime/use-realtime-invalidator";
import {
  useDeliveriesInfinite,
  useDeliveriesKpis,
  useDeliveryFilterOptions,
} from "./use-deliveries";
import {
  deliveryStatusFilterMessageKey,
  deliveryStatusFilterValues,
  deliveryStatusMessageKey,
  type DeliveryStatusFilterValue,
} from "./delivery-status-filter";
import {
  fetchDeliveriesForExport,
  type DeliveriesQueryFilter,
  type DeliveryExportRow,
} from "./deliveries-actions";
import { DeliveryDetailSheet } from "./delivery-detail-sheet";
import { OrdersReportDialog } from "./orders-report-dialog";
import {
  CANCEL_REASON_CODES,
  parseCancelReason,
  type CancelReasonCode,
} from "./parse-cancel-reason";
import { formatRelativeMinutesAgo } from "./delivery-sort-utils";
import { resolveDeliveryStatusVariant } from "./delivery-status-variant";
import type { DeliveryListRow } from "./types";

function formatDateTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Kuwait",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function exportDeliveriesCsv(rows: DeliveryExportRow[]) {
  const header = [
    "id",
    "driver_name",
    "driver_code",
    "employee_id",
    "restaurant",
    "zone",
    "status",
    "external_order_id",
    "pickup_at",
    "delivered_at",
    "cancelled_at",
    "cancel_reason_code",
    "cancel_reason_note",
  ];
  const escape = (v: string | number | boolean | null) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [
    header.join(","),
    ...rows.map((r) => {
      const parsed = parseCancelReason(r.cancel_reason);
      return [
        r.short_id,
        r.driver_name,
        r.driver_code,
        r.driver_employee_id,
        r.restaurant_name ?? "",
        r.zone_name,
        r.status,
        r.external_order_id ?? "",
        r.pickup_at ?? "",
        r.delivered_at ?? "",
        r.cancelled_at ?? "",
        parsed?.code ?? "",
        parsed?.note ?? "",
      ]
        .map(escape)
        .join(",");
    }),
  ];
  const blob = new Blob(["\uFEFF" + lines.join("\n")], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `deliveries-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function DeliveriesPageSkeleton() {
  return (
    <div className="flex h-48 items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}

const GPS_STALE_MS = 5 * 60 * 1000;

async function fetchDeliveryGpsFromApi(deliveryId: string) {
  const res = await fetch(`/api/deliveries/${deliveryId}/gps`, {
    credentials: "same-origin",
  });
  if (!res.ok) throw new Error("gps_failed");
  return res.json();
}

function DeliveriesPageContent() {
  const t = useTranslations("pages.deliveries");
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [tabFilter, setTabFilter] = useState<DeliveryStatusFilterValue>("all");
  const [zoneFilter, setZoneFilter] = useState("all");
  const [partnerFilter, setPartnerFilter] = useState("all");
  const [cancelReasonFilter, setCancelReasonFilter] = useState<"all" | CancelReasonCode>("all");
  const [dateRange, setDateRange] = useState<DateRangeValue>(DATE_RANGE_ALL);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [ordersReportOpen, setOrdersReportOpen] = useState(false);
  const [selectedDelivery, setSelectedDelivery] = useState<DeliveryListRow | null>(null);
  const [isNavigatingNext, setIsNavigatingNext] = useState(false);

  const openDeliveryDetail = useCallback((delivery: DeliveryListRow) => {
    setSelectedDelivery(delivery);
  }, []);

  // Debounce free-text search so we don't refetch on every keystroke.
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(handle);
  }, [search]);

  const filter = useMemo<DeliveriesQueryFilter>(
    () => ({
      status: tabFilter,
      zoneId: zoneFilter,
      partnerId: partnerFilter,
      cancelReason: tabFilter === "cancelled" ? cancelReasonFilter : "all",
      search: debouncedSearch,
      dateFrom: dateRange.from ?? undefined,
      dateTo: dateRange.to ?? undefined,
    }),
    [tabFilter, zoneFilter, partnerFilter, cancelReasonFilter, debouncedSearch, dateRange],
  );

  const {
    data,
    isLoading,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useDeliveriesInfinite(filter);

  const { data: kpiCounts } = useDeliveriesKpis();
  const { data: filterOptions } = useDeliveryFilterOptions();

  const deliveries = useMemo(
    () => data?.pages.flatMap((page) => page.rows) ?? [],
    [data],
  );
  const visible = deliveries;
  const totalForFilter = data?.pages[0]?.total ?? 0;

  const selectedDeliveryIndex = useMemo(() => {
    if (!selectedDelivery) return -1;
    return visible.findIndex((row) => row.id === selectedDelivery.id);
  }, [selectedDelivery, visible]);

  useEffect(() => {
    if (!selectedDelivery || selectedDeliveryIndex < 0) return;
    const ids = [
      selectedDelivery.id,
      visible[selectedDeliveryIndex - 1]?.id,
      visible[selectedDeliveryIndex + 1]?.id,
    ].filter(Boolean) as string[];
    for (const id of ids) {
      void queryClient.prefetchQuery({
        queryKey: queryKeys.deliveries.gpsAudit(id),
        queryFn: () => fetchDeliveryGpsFromApi(id),
        staleTime: GPS_STALE_MS,
      });
    }
  }, [selectedDelivery, selectedDeliveryIndex, visible, queryClient]);

  const hasPreviousDelivery = selectedDeliveryIndex > 0;
  const hasNextDelivery =
    selectedDeliveryIndex >= 0 &&
    (selectedDeliveryIndex < visible.length - 1 || hasNextPage);

  const goToPreviousDelivery = useCallback(() => {
    if (!hasPreviousDelivery || selectedDeliveryIndex <= 0) return;
    openDeliveryDetail(visible[selectedDeliveryIndex - 1]);
  }, [hasPreviousDelivery, selectedDeliveryIndex, visible, openDeliveryDetail]);

  const goToNextDelivery = useCallback(async () => {
    if (!selectedDelivery || selectedDeliveryIndex < 0) return;
    if (selectedDeliveryIndex < visible.length - 1) {
      openDeliveryDetail(visible[selectedDeliveryIndex + 1]);
      return;
    }
    if (!hasNextPage || isNavigatingNext) return;
    setIsNavigatingNext(true);
    try {
      const result = await fetchNextPage();
      const rows = result.data?.pages.flatMap((page) => page.rows) ?? [];
      const nextRow = rows[selectedDeliveryIndex + 1];
      if (nextRow) openDeliveryDetail(nextRow);
    } finally {
      setIsNavigatingNext(false);
    }
  }, [
    selectedDelivery,
    selectedDeliveryIndex,
    visible,
    hasNextPage,
    isNavigatingNext,
    fetchNextPage,
    openDeliveryDetail,
  ]);

  const deliveryNavPositionLabel = useMemo(() => {
    if (selectedDeliveryIndex < 0 || totalForFilter <= 0) return undefined;
    return t("detailNavPosition", {
      current: selectedDeliveryIndex + 1,
      total: totalForFilter,
    });
  }, [selectedDeliveryIndex, totalForFilter, t]);

  // Live refresh: re-fetch the list whenever a delivery row changes in Postgres
  // (insert/update/delete). Keeps the table in sync without a manual refresh
  // when riders or other admins act on deliveries.
  useRealtimeInvalidator({
    channel: "admin-deliveries-list",
    tables: [{ table: "deliveries" }],
    invalidateKeys: [queryKeys.deliveries.all(), queryKeys.verifications.all()],
  });

  // Infinite scroll: load the next page when the sentinel scrolls into view.
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = loadMoreRef.current;
    if (!node || !hasNextPage) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
          void fetchNextPage();
        }
      },
      { rootMargin: "400px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const zoneSelectItems = useMemo(() => {
    return [
      { value: "all", label: t("filterZoneAll"), keywords: [t("filterZoneAll")] },
      ...(filterOptions?.zones ?? []).map((zone) => ({
        value: zone.id,
        label: zone.name,
        keywords: [zone.name, zone.id],
      })),
    ];
  }, [filterOptions, t]);

  const partnerSelectItems = useMemo(() => {
    return [
      { value: "all", label: t("filterPartnerAll"), keywords: [t("filterPartnerAll")] },
      ...(filterOptions?.partners ?? []).map((partner) => ({
        value: partner.id,
        label: partner.name,
        keywords: [partner.name, partner.id],
      })),
    ];
  }, [filterOptions, t]);

  const kpis = useMemo(() => {
    const counts = kpiCounts ?? {
      total: 0,
      active: 0,
      verified: 0,
      pending: 0,
      rejected: 0,
      cancelled: 0,
    };
    return [
      { label: t("kpiTotal"), value: counts.total, icon: Package, accent: "primary" as const },
      { label: t("kpiActive"), value: counts.active, icon: Activity, accent: "primary" as const },
      {
        label: t("kpiVerified"),
        value: counts.verified,
        icon: CheckCircle2,
        accent: "success" as const,
      },
      {
        label: t("kpiPending"),
        value: counts.pending,
        icon: Clock,
        accent: counts.pending > 0 ? ("warning" as const) : ("default" as const),
      },
      {
        label: t("kpiRejected"),
        value: counts.rejected,
        icon: XCircle,
        accent: counts.rejected > 0 ? ("danger" as const) : ("default" as const),
      },
      { label: t("kpiCancelled"), value: counts.cancelled, icon: Ban, accent: "default" as const },
    ];
  }, [kpiCounts, t]);

  const cancelReasonSelectItems = useMemo(
    () => [
      { value: "all", label: t("filterCancelReasonAll"), keywords: [t("filterCancelReasonAll")] },
      ...CANCEL_REASON_CODES.map((code) => ({
        value: code,
        label: t(`cancelReason.${code}`),
        keywords: [code, t(`cancelReason.${code}`)],
      })),
    ],
    [t],
  );

  function formatWhenColumn(delivery: DeliveryListRow): string {
    if (delivery.status === "in_transit" && delivery.pickup_at) {
      const mins = formatRelativeMinutesAgo(delivery.pickup_at);
      return t("pickedUpAgo", { minutes: mins });
    }
    if (delivery.status === "cancelled" && delivery.cancelled_at) {
      return formatDateTime(delivery.cancelled_at);
    }
    if (delivery.delivered_at) {
      return formatDateTime(delivery.delivered_at);
    }
    if (delivery.pickup_at) {
      return formatDateTime(delivery.pickup_at);
    }
    return "—";
  }

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refetch();
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const rows = await fetchDeliveriesForExport(filter);
      if (rows.length === 0) {
        toast.error(t("emptySearchTitle"));
        return;
      }
      exportDeliveriesCsv(rows);
    } catch {
      toast.error(t("statusChangeFailed"));
    } finally {
      setIsExporting(false);
    }
  };

  const hasFiltersOrSearch =
    tabFilter !== "all" ||
    zoneFilter !== "all" ||
    partnerFilter !== "all" ||
    dateRange.preset !== "all" ||
    debouncedSearch.length > 0;

  const showEmptySearch =
    !isLoading && visible.length === 0 && hasFiltersOrSearch;
  const showEmptyAll = !isLoading && visible.length === 0 && !hasFiltersOrSearch;

  const columnVisibilityOptions = useMemo(
    () => [
      { id: "deliveryId", label: t("colDeliveryId") },
      { id: "driver", label: t("colDriver") },
      { id: "employeeId", label: t("colEmployeeId") },
      { id: "restaurant", label: t("colRestaurant") },
      { id: "zone", label: t("colZone") },
      { id: "status", label: t("colStatus") },
      { id: "orderId", label: t("colOrderId") },
      { id: "when", label: t("colWhen") },
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
  } = useTableColumnVisibility("dpd:deliveries:list-columns", columnVisibilityOptions);

  const tableColumns = useMemo(
    () =>
      [
        { id: "deliveryId", label: t("colDeliveryId") },
        { id: "driver", label: t("colDriver") },
        { id: "employeeId", label: t("colEmployeeId") },
        { id: "restaurant", label: t("colRestaurant") },
        { id: "zone", label: t("colZone") },
        { id: "status", label: t("colStatus"), className: "text-end" },
        { id: "orderId", label: t("colOrderId") },
        { id: "when", label: t("colWhen") },
        { id: "actions", label: t("colActions"), className: "w-12 text-end" },
      ].filter((col) => isColumnVisible(col.id)),
    [isColumnVisible, t],
  );

  const selectTab = (id: DeliveryStatusFilterValue) => {
    setTabFilter(id);
    if (id !== "cancelled") setCancelReasonFilter("all");
  };

  const statusFilterOptions = useMemo(
    () =>
      deliveryStatusFilterValues().map((value) => ({
        value,
        label: t(deliveryStatusFilterMessageKey(value)),
      })),
    [t],
  );

  const hasActiveFilters =
    zoneFilter !== "all" ||
    partnerFilter !== "all" ||
    dateRange.preset !== "all" ||
    (tabFilter === "cancelled" && cancelReasonFilter !== "all");

  return (
    <AppPage>
      <KpiGrid items={kpis} />

      <AppListCard
        toolbar={
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={tabFilter}
                onValueChange={(value) =>
                  selectTab((value as DeliveryStatusFilterValue | null) ?? "all")
                }
              >
                <SelectTrigger
                  className="h-9 w-[min(180px,42vw)] shrink-0 cursor-pointer rounded-lg bg-background"
                  aria-label={t("filterStatus")}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="start">
                  {statusFilterOptions.map((option) => (
                    <SelectItem
                      key={option.value}
                      value={option.value}
                      className="cursor-pointer"
                    >
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <DateRangeFilter value={dateRange} onChange={setDateRange} />
              <div className="relative min-w-[180px] flex-1">
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
              {tabFilter === "cancelled" ? (
                <SearchSelect
                  items={cancelReasonSelectItems}
                  value={cancelReasonFilter}
                  onChange={(v) =>
                    setCancelReasonFilter((v as CancelReasonCode | "all") ?? "all")
                  }
                  placeholder={t("filterCancelReason")}
                  searchPlaceholder={t("filterCancelReason")}
                  defaultLimit={8}
                  recentsKey="deliveries-cancel-reason-filter"
                  className="w-[160px]"
                  clearable={false}
                />
              ) : null}
              <SearchSelect
                items={zoneSelectItems}
                value={zoneFilter}
                onChange={(v) => setZoneFilter(v ?? "all")}
                placeholder={t("filterZone")}
                searchPlaceholder={t("filterZone")}
                defaultLimit={8}
                recentsKey="deliveries-zone-filter"
                className="w-[140px]"
                clearable={false}
              />
              <SearchSelect
                items={partnerSelectItems}
                value={partnerFilter}
                onChange={(v) => setPartnerFilter(v ?? "all")}
                placeholder={t("filterPartner")}
                searchPlaceholder={t("filterPartner")}
                defaultLimit={8}
                recentsKey="deliveries-partner-filter"
                className="w-[150px]"
                clearable={false}
              />
              <AppTableColumnPicker
                options={columnPickerOptions}
                isVisible={isColumnVisible}
                onToggle={toggleColumn}
                onReset={resetColumns}
                hiddenCount={hiddenToggleableCount}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 w-9 cursor-pointer rounded-lg p-0"
                onClick={handleRefresh}
                disabled={isRefreshing}
                title={t("refresh")}
                aria-label={t("refresh")}
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`}
                />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 cursor-pointer rounded-lg px-2.5"
                onClick={() => setOrdersReportOpen(true)}
                title={t("ordersReport.button")}
                aria-label={t("ordersReport.button")}
              >
                <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5" />
                <span className="hidden sm:inline">{t("ordersReport.button")}</span>
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 w-9 cursor-pointer rounded-lg p-0"
                onClick={handleExport}
                disabled={isExporting || totalForFilter === 0}
                title={t("export")}
                aria-label={t("export")}
              >
                {isExporting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )}
              </Button>
            </div>
            {(hasActiveFilters || search) && (
              <p className="text-sm tabular-nums text-muted-foreground">
                {t("totalDeliveries", { count: totalForFilter })}
                {kpiCounts && totalForFilter !== kpiCounts.total
                  ? ` ${t("ofTotal", { total: kpiCounts.total })}`
                  : null}
              </p>
            )}
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
              {!showEmptySearch
                ? visible.map((delivery) => (
                    <AppDataTableRow
                      key={delivery.id}
                      onClick={() => openDeliveryDetail(delivery)}
                    >
                      <VisibleTableCell
                        columnId="deliveryId"
                        isVisible={isColumnVisible}
                        className="font-mono text-sm tabular-nums text-muted-foreground"
                      >
                        <span className="inline-flex items-center gap-1.5">
                          #{delivery.short_id}
                          {delivery.order_proof_url ||
                          delivery.pickup_proof_url ||
                          delivery.cancel_proof_url ? (
                            <Camera
                              className="h-3.5 w-3.5 shrink-0 text-primary/70"
                              aria-label={t("hasProof")}
                            />
                          ) : null}
                        </span>
                      </VisibleTableCell>
                      <VisibleTableCell columnId="driver" isVisible={isColumnVisible}>
                        <span className="inline-flex flex-wrap items-center gap-1.5 text-sm font-medium text-foreground">
                          {delivery.driver_name}
                          {delivery.gps_is_mocked ? (
                            <span
                              className="rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-semibold text-destructive"
                              title={t("mockGpsTooltip")}
                            >
                              {t("mockGpsBadge")}
                            </span>
                          ) : null}
                        </span>
                      </VisibleTableCell>
                      <VisibleTableCell
                        columnId="employeeId"
                        isVisible={isColumnVisible}
                        className="font-mono text-sm tabular-nums text-muted-foreground"
                      >
                        {delivery.driver_employee_id}
                      </VisibleTableCell>
                      <VisibleTableCell columnId="restaurant" isVisible={isColumnVisible}>
                        {delivery.restaurant_name ? (
                          <span className="truncate text-sm text-foreground">
                            {delivery.restaurant_name}
                          </span>
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
                      </VisibleTableCell>
                      <VisibleTableCell
                        columnId="zone"
                        isVisible={isColumnVisible}
                        className="text-sm text-muted-foreground"
                      >
                        {delivery.zone_name}
                      </VisibleTableCell>
                      <VisibleTableCell
                        columnId="status"
                        isVisible={isColumnVisible}
                        className="text-end"
                      >
                        <StatusPill variant={resolveDeliveryStatusVariant(delivery.status)} dot>
                          {t(deliveryStatusMessageKey(delivery.status))}
                        </StatusPill>
                      </VisibleTableCell>
                      <VisibleTableCell
                        columnId="orderId"
                        isVisible={isColumnVisible}
                        className="font-mono text-sm tabular-nums text-muted-foreground"
                      >
                        {delivery.external_order_id ?? "—"}
                      </VisibleTableCell>
                      <VisibleTableCell
                        columnId="when"
                        isVisible={isColumnVisible}
                        className="text-sm text-muted-foreground"
                      >
                        {formatWhenColumn(delivery)}
                      </VisibleTableCell>
                      <VisibleTableCell
                        columnId="actions"
                        isVisible={isColumnVisible}
                        className="text-end"
                      >
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                            aria-label={t("rowActions")}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <MoreVertical className="h-4 w-4" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              className="cursor-pointer"
                              onClick={() => openDeliveryDetail(delivery)}
                            >
                              <Eye className="me-2 h-3.5 w-3.5" />
                              {t("viewDetail")}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </VisibleTableCell>
                    </AppDataTableRow>
                  ))
                : null}
            </AppDataTable>

            {!showEmptySearch && visible.length > 0 ? (
              <div
                ref={loadMoreRef}
                className="flex items-center justify-center py-4 text-sm text-muted-foreground"
              >
                {isFetchingNextPage ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t("loadingMore")}
                  </span>
                ) : hasNextPage ? (
                  <span className="tabular-nums">
                    {t("showingCount", { count: visible.length, total: totalForFilter })}
                  </span>
                ) : (
                  <span className="tabular-nums">
                    {t("allLoaded", { total: totalForFilter })}
                  </span>
                )}
              </div>
            ) : null}
          </CardContent>
        )}
      </AppListCard>

      <DeliveryDetailSheet
        delivery={selectedDelivery}
        open={selectedDelivery !== null}
        onClose={() => setSelectedDelivery(null)}
        navigation={
          selectedDelivery
            ? {
                hasPrevious: hasPreviousDelivery,
                hasNext: hasNextDelivery,
                onPrevious: goToPreviousDelivery,
                onNext: () => void goToNextDelivery(),
                isLoadingNext: isNavigatingNext,
                positionLabel: deliveryNavPositionLabel,
              }
            : undefined
        }
        onUpdated={async () => {
          const { data: refreshed } = await refetch();
          if (selectedDelivery && refreshed) {
            const fresh = refreshed.pages
              .flatMap((page) => page.rows)
              .find((row) => row.id === selectedDelivery.id);
            if (fresh) setSelectedDelivery(fresh);
          }
        }}
      />

      <OrdersReportDialog open={ordersReportOpen} onOpenChange={setOrdersReportOpen} />
    </AppPage>
  );
}

export function DeliveriesPageShell() {
  const mounted = useHasMounted();
  if (!mounted) return <DeliveriesPageSkeleton />;
  return <DeliveriesPageContent />;
}
