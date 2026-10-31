"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import {
  Activity,
  Ban,
  Camera,
  Check,
  CheckCircle2,
  Clock,
  Eye,
  FileSpreadsheet,
  Loader2,
  MoreVertical,
  TriangleAlert,
  Package,
  RefreshCw,
  X,
  XCircle,
} from "lucide-react";
import { AppListCard } from "@/components/app/app-list-card";
import {
  GroupedSections,
  fieldSearchMatch,
  groupRows,
  useListControlLabels,
} from "@/components/app/app-list-controls";
import {
  AppDataTable,
  AppDataTableEmpty,
  AppDataTableRow,
  VisibleTableCell,
} from "@/components/app";
import { TableCell } from "@/components/app/app-data-table";
import { AppPage } from "@/components/app/app-page";
import { AppEmptyState } from "@/components/app/app-empty-state";
import { ClearAllModuleButton } from "@/features/settings/clear-all-module-button";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { useAuth } from "@/contexts/auth-context";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  DATE_RANGE_ALL,
  DateRangeFilter,
  type DateRangeValue,
} from "@/components/app/date-range-filter";
import {
  EmptyCell,
  TableNameCell,
  TableToolbar,
  useTablePrefs,
  type TableToolbarColumn,
} from "@/components/app/table-toolbar";
import { KpiGrid } from "@/components/dashboard/kpi-grid";
import { StatusPill } from "@/components/dashboard/status-pill";
import { Button } from "@/components/ui/button";
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
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { queryKeys } from "@/lib/query/query-keys";
import { useRealtimeInvalidator } from "@/lib/realtime/use-realtime-invalidator";
import {
  useBulkUpdateDeliveries,
  useDeliveriesInfinite,
  useDeliveriesKpis,
  useDeliveryFilterOptions,
} from "./use-deliveries";
import { isBulkVerifiableDeliveryStatus } from "./bulk-verifiable-status";
import {
  deliveryStatusFilterMessageKey,
  deliveryStatusFilterValues,
  deliveryStatusMessageKey,
  type DeliveryStatusFilterValue,
} from "./delivery-status-filter";
import {
  fetchDeliveriesForExport,
  type DeliveryFlagFilter,
  type DeliveriesQueryFilter,
  type DeliveryExportRow,
} from "./deliveries-actions";
import { DELIVERIES_EXPORT_MAX_ROWS } from "./export-pagination";
import { DeliveryDetailSheet } from "./delivery-detail-sheet";
import { deliveryDetailNav, nextSelectedDeliveryAfterRefresh } from "./delivery-detail-nav";
import { OrdersReportDialog } from "./orders-report-dialog";
import {
  CANCEL_REASON_CODES,
  parseCancelReason,
  type CancelReasonCode,
} from "./parse-cancel-reason";
import { formatRelativeMinutesAgo } from "./delivery-sort-utils";
import { resolveDeliveryStatusVariant } from "./delivery-status-variant";
import { displayExternalOrderId } from "./order-id";
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
  const labels = useListControlLabels();
  const toolbarColumns = useMemo<TableToolbarColumn[]>(
    () => [
      { id: "select", label: t("bulk.selectAll"), locked: true },
      { id: "deliveryId", label: t("colDeliveryId"), locked: true },
      { id: "driver", label: t("colDriver"), locked: true },
      { id: "employeeId", label: t("colEmployeeId") },
      { id: "restaurant", label: t("colRestaurant") },
      { id: "zone", label: t("colZone"), categorical: true },
      { id: "status", label: t("colStatus"), categorical: true },
      { id: "partner", label: labels.group.partner.label, categorical: true, defaultHidden: true },
      { id: "orderId", label: t("colOrderId") },
      { id: "when", label: t("colWhen") },
      { id: "actions", label: t("colActions"), locked: true },
    ],
    [labels.group.partner, t],
  );
  const prefs = useTablePrefs("deliveries", toolbarColumns);
  const debouncedSearch = prefs.appliedQuery.trim();
  const isColumnVisible = prefs.isVisible;
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const canManage = can("deliveries.manage");
  const bulkUpdate = useBulkUpdateDeliveries();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const [tabFilter, setTabFilter] = useState<DeliveryStatusFilterValue>("all");
  const [zoneFilter, setZoneFilter] = useState("all");
  const [partnerFilter, setPartnerFilter] = useState("all");
  const [cancelReasonFilter, setCancelReasonFilter] = useState<"all" | CancelReasonCode>("all");
  const [flagsFilter, setFlagsFilter] = useState<DeliveryFlagFilter>("all");
  const [dateRange, setDateRange] = useState<DateRangeValue>(DATE_RANGE_ALL);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [ordersReportOpen, setOrdersReportOpen] = useState(false);
  const [selectedDelivery, setSelectedDelivery] = useState<DeliveryListRow | null>(null);
  const [isNavigatingNext, setIsNavigatingNext] = useState(false);
  const selectedDeliveryIdRef = useRef<string | null>(null);
  // Do not mirror selectedDelivery onto this ref during render. Close sets the
  // ref to null first; a render-time copy would restore the id before refetch
  // and reopen the sheet.

  const openDeliveryDetail = useCallback((delivery: DeliveryListRow) => {
    selectedDeliveryIdRef.current = delivery.id;
    setSelectedDelivery(delivery);
  }, []);

  const closeDeliveryDetail = useCallback(() => {
    selectedDeliveryIdRef.current = null;
    setSelectedDelivery(null);
  }, []);

  const filter = useMemo<DeliveriesQueryFilter>(
    () => ({
      status: tabFilter,
      zoneId: zoneFilter,
      partnerId: partnerFilter,
      cancelReason: tabFilter === "cancelled" ? cancelReasonFilter : "all",
      flags: flagsFilter,
      search: debouncedSearch,
      searchShape: "prefix",
      dateFrom: dateRange.from ?? undefined,
      dateTo: dateRange.to ?? undefined,
      dateToExclusive: dateRange.toExclusive,
    }),
    [tabFilter, zoneFilter, partnerFilter, cancelReasonFilter, flagsFilter, debouncedSearch, dateRange],
  );

  const {
    data,
    isLoading,
    isError,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useDeliveriesInfinite(filter);

  const {
    data: kpiCounts,
    isError: kpiError,
    refetch: refetchKpis,
  } = useDeliveriesKpis();
  const { data: filterOptions } = useDeliveryFilterOptions();

  const deliveries = useMemo(
    () => data?.pages.flatMap((page) => page.rows) ?? [],
    [data],
  );
  const visible = useMemo(
    () =>
      deliveries.filter((row) =>
        fieldSearchMatch(row, debouncedSearch, {
          name: (item) => item.driver_name,
          employee_id: (item) => item.driver_employee_id || item.driver_code,
          zone: (item) => item.zone_name,
          order_id: (item) => item.external_order_id,
          status: (item) => item.status,
        }),
      ),
    [deliveries, debouncedSearch],
  );
  const groupedDeliveries = useMemo(
    () =>
      groupRows(
        visible,
        prefs.groupBy,
        {
          status: (row) => row.status,
          zone: (row) => row.zone_name,
          partner: (row) => row.partner_name,
        },
        {},
        "—",
      ),
    [prefs.groupBy, visible],
  );
  const totalForFilter = data?.pages[0]?.total ?? 0;
  const searchIncomplete = data?.pages.some((page) => page.searchTruncated === true) ?? false;
  const verifiableVisible = useMemo(
    () => visible.filter((row) => isBulkVerifiableDeliveryStatus(row.status)),
    [visible],
  );
  const selectedRows = useMemo(
    () => visible.filter((row) => selected.has(row.id)),
    [visible, selected],
  );
  const verifiableSelected = useMemo(
    () => selectedRows.filter((row) => isBulkVerifiableDeliveryStatus(row.status)),
    [selectedRows],
  );
  const skippedSelectedCount = selected.size - verifiableSelected.length;

  const toggleRow = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllVisible = (checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) {
        for (const row of verifiableVisible) next.add(row.id);
      } else {
        for (const row of verifiableVisible) next.delete(row.id);
      }
      return next;
    });
  };

  const runBulk = async (
    status: "verified" | "rejected",
    reason?: string,
  ) => {
    const ids = verifiableSelected.map((row) => row.id);
    if (ids.length === 0) {
      toast.error(t("bulk.noneEligible"));
      return;
    }
    if (ids.length > 100) {
      toast.error(t("bulk.tooMany"));
      return;
    }
    const result = await bulkUpdate.mutateAsync({
      deliveryIds: ids,
      status,
      rejectionReason: reason,
    });
    if (!("ok" in result)) {
      const key =
        result.error === "not_authorized"
          ? "noPermission"
          : result.error === "reason_required"
            ? "rejectReasonRequired"
            : result.error === "too_many"
              ? "bulk.tooMany"
              : "statusChangeFailed";
      toast.error(t(key as "statusChangeFailed"));
      return;
    }
    setSelected(new Set());
    setRejectOpen(false);
    setRejectReason("");
    if (result.updated === 0) {
      toast.error(t("bulk.noneEligible"));
      return;
    }
    if (status === "verified") {
      toast.success(
        result.failed > 0
          ? t("bulk.verifyPartial", {
              done: `${result.updated}`,
              skipped: `${result.failed}`,
            })
          : t("bulk.verifyDone", { count: `${result.updated}` }),
      );
    } else {
      toast.success(
        result.failed > 0
          ? t("bulk.rejectPartial", {
              done: `${result.updated}`,
              skipped: `${result.failed}`,
            })
          : t("bulk.rejectDone", { count: `${result.updated}` }),
      );
    }
  };

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

  const { hasPrevious: hasPreviousDelivery, hasNext: hasNextDelivery } =
    deliveryDetailNav(selectedDeliveryIndex, visible.length, hasNextPage);

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
    if (searchIncomplete || selectedDeliveryIndex < 0 || totalForFilter <= 0) return undefined;
    return t("detailNavPosition", {
      current: selectedDeliveryIndex + 1,
      total: totalForFilter,
    });
  }, [searchIncomplete, selectedDeliveryIndex, totalForFilter, t]);

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
    const dash = kpiError || !kpiCounts;
    const counts = kpiCounts;
    const valueOf = (n: number | undefined) => (dash ? "—" : (n ?? 0));
    return [
      {
        label: t("kpiTotal"),
        value: valueOf(counts?.total),
        icon: Package,
        accent: "primary" as const,
        caption: t("kpiAllTime"),
      },
      {
        label: t("kpiActive"),
        value: valueOf(counts?.active),
        icon: Activity,
        accent: "primary" as const,
      },
      {
        label: t("kpiVerified"),
        value: valueOf(counts?.verified),
        icon: CheckCircle2,
        accent: "success" as const,
      },
      {
        label: t("kpiPending"),
        value: valueOf(counts?.pending),
        icon: Clock,
        accent: !dash && (counts?.pending ?? 0) > 0 ? ("warning" as const) : ("default" as const),
      },
      {
        label: t("kpiRejected"),
        value: valueOf(counts?.rejected),
        icon: XCircle,
        accent: !dash && (counts?.rejected ?? 0) > 0 ? ("danger" as const) : ("default" as const),
      },
      {
        label: t("kpiCancelled"),
        value: valueOf(counts?.cancelled),
        icon: Ban,
        accent: "default" as const,
      },
    ];
  }, [kpiCounts, kpiError, t]);

  const flagSelectItems = useMemo<Array<{ value: DeliveryFlagFilter; label: string }>>(
    () => [
      { value: "all", label: t("filterFlagsAll") },
      { value: "early_drop", label: t("filterFlagsEarlyDrop") },
      { value: "outside_zone", label: t("filterFlagsOutsideZone") },
      { value: "photo_mismatch", label: t("filterFlagsPhotoMismatch") },
    ],
    [t],
  );

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
      // A full page means the export stopped at the ceiling rather than at the
      // end of the window; say so instead of calling a partial file a success.
      if (rows.length >= DELIVERIES_EXPORT_MAX_ROWS) {
        toast.warning(t("exportTruncated", { count: DELIVERIES_EXPORT_MAX_ROWS }));
      } else {
        toast.success(t("exportReady", { count: rows.length }));
      }
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
    !isLoading && !isError && visible.length === 0 && hasFiltersOrSearch;
  const showEmptyAll = !isLoading && !isError && visible.length === 0 && !hasFiltersOrSearch;

  const tableColumns = useMemo(
    () =>
      [
        {
          id: "select",
          className: "w-12",
          label: (
            <DeliverySelectBox
              label={t("bulk.selectAll")}
              checked={
                verifiableVisible.length > 0 &&
                verifiableVisible.every((row) => selected.has(row.id))
              }
              onCheckedChange={(checked) => toggleAllVisible(checked)}
            />
          ),
        },
        { id: "deliveryId", label: t("colDeliveryId") },
        { id: "driver", label: t("colDriver") },
        { id: "employeeId", label: t("colEmployeeId") },
        { id: "restaurant", label: t("colRestaurant") },
        { id: "zone", label: t("colZone") },
        { id: "status", label: t("colStatus"), className: "text-end" },
        { id: "partner", label: labels.group.partner.label },
        { id: "orderId", label: t("colOrderId") },
        { id: "when", label: t("colWhen") },
        { id: "actions", label: t("colActions"), className: "w-12 text-end" },
      ]
        .filter((col) => isColumnVisible(col.id))
        .sort((left, right) => {
          const rank = new Map(prefs.orderedColumns.map((column, index) => [column.id, index]));
          return (rank.get(left.id) ?? 999) - (rank.get(right.id) ?? 999);
        }),
    [isColumnVisible, labels.group.partner, prefs.orderedColumns, selected, t, verifiableVisible],
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
    flagsFilter !== "all" ||
    dateRange.preset !== "all" ||
    (tabFilter === "cancelled" && cancelReasonFilter !== "all");

  return (
    <AppPage>
      <div className="flex flex-col gap-2">
        <KpiGrid items={kpis} />
        {kpiError ? (
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs text-muted-foreground">{t("kpiErrorHint")}</p>
            <Button
              type="button"
              variant="outline"
              className="h-9 cursor-pointer"
              onClick={() => void refetchKpis()}
            >
              {t("listRetry")}
            </Button>
          </div>
        ) : null}
      </div>

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
                  <Select
                    value={flagsFilter}
                    onValueChange={(value) =>
                      setFlagsFilter((value as DeliveryFlagFilter | null) ?? "all")
                    }
                  >
                    <SelectTrigger
                      className="h-9 w-[min(180px,42vw)] shrink-0 cursor-pointer rounded-lg bg-background"
                      aria-label={t("filterFlags")}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent align="start">
                      {flagSelectItems.map((option) => (
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
                  <ClearAllModuleButton entity="deliveries" compact />
            </div>
            {(hasActiveFilters || debouncedSearch) && !searchIncomplete && (
              <p className="text-sm tabular-nums text-muted-foreground">
                {t("totalDeliveries", { count: totalForFilter })}
                {kpiCounts && totalForFilter !== kpiCounts.total
                  ? ` ${t("ofTotal", { total: kpiCounts.total })}`
                  : null}
              </p>
            )}
            {verifiableVisible.length > 0 || selected.size > 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
                <p className="text-xs font-medium text-foreground">
                  {selected.size > 0
                    ? t("bulk.selected", { count: `${selected.size}` })
                    : t("bulk.hint")}
                  {skippedSelectedCount > 0 ? (
                    <span className="ms-2 font-normal text-muted-foreground">
                      {t("bulk.skipped", { count: `${skippedSelectedCount}` })}
                    </span>
                  ) : null}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    className="h-8"
                    disabled={!canManage || verifiableSelected.length === 0 || bulkUpdate.isPending}
                    title={!canManage ? t("noPermission") : undefined}
                    onClick={() => void runBulk("verified")}
                  >
                    {bulkUpdate.isPending ? (
                      <Loader2 className="me-1 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Check className="me-1 h-3.5 w-3.5" />
                    )}
                    {t("bulk.verify", { count: `${verifiableSelected.length}` })}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 text-destructive hover:bg-destructive/10"
                    disabled={!canManage || verifiableSelected.length === 0 || bulkUpdate.isPending}
                    title={!canManage ? t("noPermission") : undefined}
                    onClick={() => setRejectOpen(true)}
                  >
                    <X className="me-1 h-3.5 w-3.5" />
                    {t("bulk.reject", { count: `${verifiableSelected.length}` })}
                  </Button>
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
          </div>
        }
      >
        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : isError ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm font-medium text-foreground">{t("listErrorTitle")}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t("listErrorHint")}</p>
            <Button
              type="button"
              variant="outline"
              className="mt-3 h-9 cursor-pointer"
              onClick={() => void refetch()}
            >
              {t("listRetry")}
            </Button>
          </div>
        ) : showEmptyAll ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm font-medium text-foreground">{t("emptyTitle")}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("emptyDescription")}
            </p>
          </div>
        ) : prefs.view === "grid" ? (
          <CardContent className="p-4">
            <TableToolbar
              prefs={prefs}
              entity={t("title")}
              columns={toolbarColumns}
              rowKind="dynamic"
              entityList
              filteredCount={visible.length}
              totalCount={totalForFilter || deliveries.length}
              onExport={!isExporting && totalForFilter > 0 ? () => void handleExport() : undefined}
            />
            <GroupedSections groups={groupedDeliveries}>
              {(rows) => (
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {rows.map((delivery) => (
                    <button
                      key={delivery.id}
                      type="button"
                      onClick={() => openDeliveryDetail(delivery)}
                      className="cursor-pointer rounded-xl border border-border bg-card p-4 text-start shadow-sm hover:bg-muted/30"
                    >
                      <p className="truncate text-sm font-semibold text-foreground">
                        {delivery.external_order_id ?? delivery.short_id}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{delivery.driver_name}</p>
                      <div className="mt-2">
                        <StatusPill variant="neutral">{delivery.status}</StatusPill>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </GroupedSections>
          </CardContent>
        ) : (
          <CardContent className="p-0">
            {searchIncomplete ? (
              <div
                role="alert"
                className="mx-4 mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950"
              >
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <p>{t("searchIncomplete")}</p>
              </div>
            ) : null}
            <AppDataTable
              toolbar={
                <TableToolbar
                  prefs={prefs}
                  entity={t("title")}
                  columns={toolbarColumns}
                  rowKind="dynamic"
                  entityList
                  filteredCount={visible.length}
                  totalCount={totalForFilter || deliveries.length}
                  onExport={!isExporting && totalForFilter > 0 ? () => void handleExport() : undefined}
                />
              }
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
                ? groupedDeliveries.flatMap((group) => [
                    prefs.groupBy !== "none" ? (
                      <AppDataTableRow key={`group-${group.key}`} className="hover:bg-transparent">
                        <TableCell
                          colSpan={tableColumns.length}
                          className="bg-muted/40 py-2 text-xs font-semibold text-foreground"
                        >
                          {group.label}
                          <span className="ms-2 rounded-full bg-muted px-1.5 text-xs tabular-nums text-muted-foreground">
                            {group.rows.length}
                          </span>
                        </TableCell>
                      </AppDataTableRow>
                    ) : null,
                    ...group.rows.map((delivery) => (
                    <AppDataTableRow
                      key={delivery.id}
                      onClick={() => openDeliveryDetail(delivery)}
                    >
                      <VisibleTableCell
                        columnId="select"
                        isVisible={isColumnVisible}
                        className="w-12"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <DeliverySelectBox
                          label={t("bulk.selectRow", {
                            id: delivery.short_id,
                          })}
                          checked={selected.has(delivery.id)}
                          disabled={!isBulkVerifiableDeliveryStatus(delivery.status)}
                          onCheckedChange={() => toggleRow(delivery.id)}
                        />
                      </VisibleTableCell>
                      <VisibleTableCell
                        columnId="deliveryId"
                        isVisible={isColumnVisible}
                        className="font-mono text-sm tabular-nums text-muted-foreground"
                      >
                        <span className="inline-flex items-center gap-1.5">
                          #{delivery.short_id}
                          {delivery.order_proof_url ||
                          delivery.pickup_proof_url ||
                          delivery.cancel_proof_url ||
                          (delivery.order_proofs?.length ?? 0) > 0 ||
                          (delivery.pickup_proofs?.length ?? 0) > 0 ||
                          (delivery.cancel_proofs?.length ?? 0) > 0 ? (
                            <Camera
                              className="h-3.5 w-3.5 shrink-0 text-primary/70"
                              aria-label={t("hasProof")}
                            />
                          ) : null}
                        </span>
                      </VisibleTableCell>
                      <VisibleTableCell columnId="driver" isVisible={isColumnVisible}>
                        <span className="inline-flex flex-wrap items-center gap-1.5 text-sm font-medium text-foreground">
                          {delivery.driver_name ? <TableNameCell name={delivery.driver_name} /> : <EmptyCell />}
                          {delivery.gps_is_mocked ? (
                            <span
                              className="rounded bg-destructive/10 px-1.5 py-0.5 text-xs font-semibold text-destructive"
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
                        {delivery.zone_name ? delivery.zone_name : <EmptyCell />}
                      </VisibleTableCell>
                      <VisibleTableCell columnId="partner" isVisible={isColumnVisible}>
                        {delivery.partner_name ? delivery.partner_name : <EmptyCell />}
                      </VisibleTableCell>
                      <VisibleTableCell
                        columnId="status"
                        isVisible={isColumnVisible}
                        className="text-end"
                      >
                        <div className="flex flex-col items-end gap-1">
                          <StatusPill variant={resolveDeliveryStatusVariant(delivery.status)} dot>
                            {t(deliveryStatusMessageKey(delivery.status))}
                          </StatusPill>
                          {delivery.is_early_drop === true ? (
                            <span
                              className="rounded border border-amber-200 bg-amber-50 px-1 py-0.5 text-xs font-medium text-amber-800"
                              title={
                                delivery.pickup_delivery_distance_m !== null
                                  ? `${Math.round(delivery.pickup_delivery_distance_m)} m`
                                  : undefined
                              }
                            >
                              {t("flagEarlyDrop")}
                            </span>
                          ) : null}
                          {delivery.is_out_of_zone === true ? (
                            <span
                              className="rounded border border-rose-200 bg-rose-50 px-1 py-0.5 text-xs font-medium text-rose-700"
                              title={
                                delivery.zone_distance_m !== null
                                  ? `${Math.round(delivery.zone_distance_m)} m`
                                  : undefined
                              }
                            >
                              {t("flagOutsideZone")}
                            </span>
                          ) : null}
                          {delivery.order_proof_ocr_matched === false ? (
                            <span
                              className="rounded border border-purple-200 bg-purple-50 px-1 py-0.5 text-xs font-medium text-purple-700"
                              title={delivery.order_proof_ocr_order_id ?? undefined}
                            >
                              {t("flagPhotoMismatch")}
                            </span>
                          ) : null}
                        </div>
                      </VisibleTableCell>
                      <VisibleTableCell
                        columnId="orderId"
                        isVisible={isColumnVisible}
                        className="max-w-[9rem] truncate font-mono text-sm tabular-nums text-muted-foreground"
                        title={displayExternalOrderId(delivery.external_order_id)}
                      >
                        {displayExternalOrderId(delivery.external_order_id)}
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
                    )),
                  ])
                : null}
            </AppDataTable>

            {!showEmptySearch &&
            visible.length > 0 &&
            (isFetchingNextPage || hasNextPage || !searchIncomplete) ? (
              <div
                ref={loadMoreRef}
                className="flex items-center justify-center py-4 text-sm text-muted-foreground"
              >
                {isFetchingNextPage ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t("loadingMore")}
                  </span>
                ) : searchIncomplete ? null : hasNextPage ? (
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
        onClose={closeDeliveryDetail}
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
          const rows = refreshed?.pages.flatMap((page) => page.rows) ?? [];
          const next = nextSelectedDeliveryAfterRefresh(
            selectedDeliveryIdRef.current,
            rows,
          );
          if (next) setSelectedDelivery(next);
        }}
      />

      <OrdersReportDialog
        open={ordersReportOpen}
        onOpenChange={setOrdersReportOpen}
        initialFrom={dateRange.from}
        initialTo={dateRange.to}
      />

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent
          className="w-[min(520px,96vw)] overflow-visible pt-4"
          showCloseButton
          closeOutside
        >
          <div className="space-y-1 px-5">
            <Label htmlFor="delivery-bulk-reject-reason">{t("bulk.reasonLabel")}</Label>
            <Textarea
              id="delivery-bulk-reject-reason"
              rows={4}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder={t("bulk.reasonPlaceholder")}
            />
            <p className="text-xs text-muted-foreground">
              {t("bulk.reasonHint", { count: `${verifiableSelected.length}` })}
            </p>
          </div>
          <div className="px-2 pb-2 pt-3">
            <AppModalFooter
              title={t("bulk.rejectTitle")}
              subtitle={t("bulk.rejectSubtitle", {
                count: `${verifiableSelected.length}`,
              })}
            >
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9"
                onClick={() => setRejectOpen(false)}
              >
                {t("bulk.cancel")}
              </Button>
              <Button
                type="button"
                size="sm"
                className="h-9 bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={!rejectReason.trim() || bulkUpdate.isPending}
                onClick={() => void runBulk("rejected", rejectReason.trim())}
              >
                {bulkUpdate.isPending ? (
                  <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <X className="me-1.5 h-3.5 w-3.5" />
                )}
                {t("bulk.confirmReject")}
              </Button>
            </AppModalFooter>
          </div>
        </DialogContent>
      </Dialog>
    </AppPage>
  );
}

function DeliverySelectBox({
  label,
  checked,
  disabled,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <span className="flex h-8 w-8 items-center justify-center">
      <span
        className={cn(
          "relative inline-flex size-5 shrink-0 items-center justify-center rounded-[4px] border-2 border-foreground bg-background",
          checked && "border-primary bg-primary text-primary-foreground",
          disabled && "opacity-50",
        )}
      >
        {checked ? <Check className="size-3 stroke-[3]" /> : null}
        <Checkbox
          aria-label={label}
          checked={checked}
          disabled={disabled}
          onCheckedChange={(value) => onCheckedChange(value === true)}
          className="absolute inset-0 size-full cursor-pointer border-0 bg-transparent opacity-0 shadow-none"
        />
      </span>
    </span>
  );
}

export function DeliveriesPageShell() {
  return <DeliveriesPageContent />;
}
