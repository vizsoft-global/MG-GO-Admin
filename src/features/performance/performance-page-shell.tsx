"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Columns3, Loader2, Percent, Settings2, Star } from "lucide-react";
import {
  AppEmptyState,
  AppListCard,
  AppPage,
  AppPageHeader,
} from "@/components/app";
import {
  AppDataTable,
  AppDataTableRow,
  TableCell,
} from "@/components/app/app-data-table";
import { KpiGrid } from "@/components/dashboard/kpi-grid";
import { TabBar } from "@/components/dashboard/tab-bar";
import { TrackingTableToolbar } from "@/features/driver-tracking/table-toolbar";
import { Link } from "@/i18n/navigation";
import { Input } from "@/components/ui/input";
import {
  addDays,
  componentPct,
  kuwaitToday,
  pct,
  rawPct,
} from "./performance-formulas";
import { componentLabel } from "./performance-component-breakdown";
import { PerformanceDrilldownSheet } from "./performance-drilldown-sheet";
import {
  DEFAULT_PERFORMANCE_FILTERS,
  PerformanceFiltersButton,
  PerformanceFiltersSheet,
  type PerformanceFiltersState,
} from "./performance-filters-sheet";
import { PerformanceLivePanel } from "./performance-live-panel";
import { PerformanceReportDialog } from "./performance-report-dialog";
import {
  scoreToStars,
  type PerformanceDriverRow,
  type PerformanceHubTab,
  type PerformanceScoreBand,
  type PerformanceSortKey,
} from "./performance-types";
import { useDriverPerformanceList } from "./use-performance";

const PAGE_SIZE = 50;

const BAND_CHIP_CLASS: Record<PerformanceScoreBand, string> = {
  top: "border-emerald-200 bg-emerald-50 text-emerald-800",
  good: "border-border bg-muted/40 text-foreground",
  watch: "border-amber-200 bg-amber-50 text-amber-800",
  critical: "border-destructive/30 bg-destructive/10 text-destructive",
};

const SORT_OPTIONS: { value: PerformanceSortKey; labelKey: string }[] = [
  { value: "overall_desc", labelKey: "sortOverallDesc" },
  { value: "overall_asc", labelKey: "sortOverallAsc" },
  { value: "delivery_desc", labelKey: "sortDeliveryDesc" },
  { value: "utilization_desc", labelKey: "sortUtilizationDesc" },
  { value: "compliance_desc", labelKey: "sortComplianceDesc" },
  { value: "manual_desc", labelKey: "sortManualDesc" },
  { value: "name_asc", labelKey: "sortNameAsc" },
];

function countActiveFilters(filters: PerformanceFiltersState): number {
  return [
    filters.partnerId,
    filters.zoneId,
    filters.restaurantId,
    filters.driverStatus !== "all" ? filters.driverStatus : "",
  ].filter(Boolean).length;
}

export function PerformancePageShell() {
  const t = useTranslations("pages.performance");
  const locale = useLocale();
  const today = kuwaitToday();

  const [tab, setTab] = useState<PerformanceHubTab>("period");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filters, setFilters] = useState<PerformanceFiltersState>(
    DEFAULT_PERFORMANCE_FILTERS,
  );
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sort, setSort] = useState<PerformanceSortKey>("overall_desc");
  const [page, setPage] = useState(0);
  const [fromDate, setFromDate] = useState(addDays(today, -6));
  const [toDate, setToDate] = useState(today);
  const [selected, setSelected] = useState<PerformanceDriverRow | null>(null);
  const [drillOpen, setDrillOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [showComponents, setShowComponents] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setPage(0);
  }, [debouncedSearch, filters, fromDate, toDate, sort]);

  const listFilters = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      partnerId: filters.partnerId || undefined,
      zoneId: filters.zoneId || undefined,
      restaurantId: filters.restaurantId || undefined,
      driverStatus: filters.driverStatus,
      fromDate,
      toDate,
      sort,
      page,
      pageSize: PAGE_SIZE,
    }),
    [debouncedSearch, filters, fromDate, toDate, sort, page],
  );

  const { data, isLoading, isFetching, refetch } = useDriverPerformanceList(
    listFilters,
    { enabled: tab === "period" },
  );

  const rows = data?.rows ?? [];
  const kpis = data?.kpis;
  const totalCount = data?.totalCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const components = useMemo(
    () => (data?.components ?? []).filter((c) => c.is_active && c.weight > 0),
    [data?.components],
  );

  const columns = [
    { id: "rank", label: t("colRank"), className: "w-12 text-center" },
    { id: "driver", label: t("colDriver"), className: "min-w-[160px]" },
    { id: "partner", label: t("colPartner") },
    { id: "zone", label: t("colZone") },
    { id: "deliveries", label: t("colDeliveries"), className: "text-end" },
    { id: "deliveryPct", label: t("colDeliveryPct"), className: "text-end" },
    { id: "utilization", label: t("colUtilization"), className: "text-end" },
    { id: "compliance", label: t("colCompliance"), className: "text-end" },
    ...(showComponents
      ? components.map((c) => ({
          id: `component-${c.key}`,
          label: componentLabel(c, locale),
          className: "text-end",
        }))
      : []),
    { id: "rating", label: t("colRating"), className: "text-end" },
    { id: "overall", label: t("colOverall"), className: "text-end" },
  ];

  return (
    <AppPage>
      <AppPageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
          <div className="flex items-center gap-2">
            {tab === "period" ? (
              <button
                type="button"
                className="text-xs text-primary hover:underline"
                onClick={() => void refetch()}
                disabled={isFetching}
              >
                {isFetching ? t("refreshing") : t("refresh")}
              </button>
            ) : null}
            <Link
              href="/performance/settings"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-2.5 text-sm text-primary transition-colors hover:bg-primary/10"
            >
              <Settings2 className="size-3.5" />
              {t("settingsLink")}
            </Link>
          </div>
        }
      />

      <TabBar
        items={[
          { id: "period", label: t("tabPeriod") },
          { id: "live", label: t("tabLive") },
        ]}
        activeId={tab}
        onSelect={(id) => setTab(id as PerformanceHubTab)}
        className="mb-3"
      />

      {tab === "live" ? (
        <PerformanceLivePanel />
      ) : (
        <>
          <KpiGrid
            items={[
              {
                label: t("kpiOverall"),
                value: kpis?.avg_overall ?? "—",
                accent: "primary",
              },
              {
                label: t("kpiDelivery"),
                value:
                  kpis?.avg_delivery_pct != null
                    ? `${kpis.avg_delivery_pct}%`
                    : "—",
              },
              {
                label: t("kpiUtilization"),
                value:
                  kpis?.avg_utilization_pct != null
                    ? `${kpis.avg_utilization_pct}%`
                    : "—",
              },
              {
                label: t("kpiCompliance"),
                value:
                  kpis?.avg_compliance != null
                    ? `${kpis.avg_compliance}%`
                    : "—",
                accent: "success",
              },
              {
                label: t("kpiTop"),
                value: kpis?.top_score ?? "—",
                caption: kpis?.top_driver_name ?? undefined,
                accent: "success",
              },
              {
                label: t("kpiBottom"),
                value: kpis?.bottom_score ?? "—",
                caption: kpis?.bottom_driver_name ?? undefined,
                accent: "danger",
              },
            ]}
            compact
          />

          <AppListCard className="p-4">
            <TrackingTableToolbar
              search={search}
              onSearchChange={setSearch}
              searchPlaceholder={t("searchPlaceholder")}
              sortValue={sort}
              onSortChange={(v) => {
                if (!v) return;
                setSort(v as PerformanceSortKey);
              }}
              sortItems={SORT_OPTIONS.map((o) => ({
                value: o.value,
                label: t(o.labelKey),
              }))}
              sortLabel={t("sortBy")}
              resultSummary={t("showingCount", {
                visible: rows.length,
                total: totalCount,
              })}
              onRefresh={() => void refetch()}
              isRefreshing={isFetching}
              refreshLabel={t("refresh")}
              onExport={() => setReportOpen(true)}
              exportLabel={t("export")}
              filterSlot={
                <div className="flex items-center gap-2">
                  <PerformanceFiltersButton
                    activeCount={countActiveFilters(filters)}
                    onClick={() => setFiltersOpen(true)}
                  />
                  {components.length > 0 ? (
                    <button
                      type="button"
                      aria-pressed={showComponents}
                      onClick={() => setShowComponents((v) => !v)}
                      title={t("components.toggleHint")}
                      className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-sm transition-colors ${
                        showComponents
                          ? "border-emerald-500 bg-emerald-100 font-semibold text-emerald-900 ring-1 ring-emerald-400/50"
                          : "border-border bg-muted/30 text-muted-foreground"
                      }`}
                    >
                      <Columns3 className="size-3.5" />
                      {t("components.toggle")}
                    </button>
                  ) : null}
                </div>
              }
              dateSlot={
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    type="date"
                    value={fromDate}
                    onChange={(e) => setFromDate(e.target.value)}
                    className="h-9 w-[140px]"
                  />
                  <Input
                    type="date"
                    value={toDate}
                    onChange={(e) => setToDate(e.target.value)}
                    className="h-9 w-[140px]"
                  />
                </div>
              }
            />

            {isLoading ? (
              <div className="flex justify-center py-16">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : rows.length === 0 ? (
              <AppEmptyState
                title={t("emptyTitle")}
                description={t("emptyHint")}
              />
            ) : (
              <>
                <AppDataTable columns={columns}>
                  {rows.map((row) => (
                    <AppDataTableRow
                      key={row.driver_id}
                      className="cursor-pointer"
                      onClick={() => {
                        setSelected(row);
                        setDrillOpen(true);
                      }}
                    >
                      <TableCell className="text-center tabular-nums text-xs font-semibold text-muted-foreground">
                        {row.dpd_rank}
                      </TableCell>
                      <TableCell>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {row.driver_name}
                          </p>
                          <p className="text-[10px] text-muted-foreground">
                            {row.driver_code}
                          </p>
                          <Link
                            href={`/drivers/${row.driver_id}`}
                            className="text-[10px] text-primary hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {t("viewDetails")}
                          </Link>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">
                        {row.partner_name ?? "—"}
                      </TableCell>
                      <TableCell className="text-sm">
                        {row.zone_name ?? "—"}
                      </TableCell>
                      <TableCell className="text-end tabular-nums text-sm">
                        {row.actual_deliveries}/{row.target_deliveries}
                      </TableCell>
                      <TableCell className="text-end tabular-nums text-sm">
                        {rawPct(row.delivery_efficiency_raw, 0)}
                      </TableCell>
                      <TableCell className="text-end tabular-nums text-sm">
                        {pct(row.utilization, 0)}
                      </TableCell>
                      <TableCell className="text-end tabular-nums text-sm">
                        {row.compliance_score == null
                          ? "—"
                          : `${Math.round(row.compliance_score)}%`}
                      </TableCell>
                      {showComponents
                        ? components.map((c) => {
                            const value = componentPct(
                              row.component_scores,
                              c.key,
                            );
                            return (
                              <TableCell
                                key={c.key}
                                className="text-end tabular-nums text-sm"
                              >
                                {value == null ? (
                                  <span
                                    className="text-muted-foreground"
                                    title={t("components.unmeasuredHint")}
                                  >
                                    —
                                  </span>
                                ) : (
                                  `${Math.round(value)}%`
                                )}
                              </TableCell>
                            );
                          })
                        : null}
                      <TableCell className="text-end">
                        {row.manual_score == null ? (
                          <span
                            className="text-xs text-muted-foreground"
                            title={t("ratingNone")}
                          >
                            —
                          </span>
                        ) : (
                          <span
                            className="inline-flex items-center gap-1 text-xs font-medium tabular-nums"
                            title={t("ratingTeamsHint", {
                              count: row.manual_rating_count,
                            })}
                          >
                            <Star className="size-3 fill-amber-400 text-amber-500" />
                            {scoreToStars(row.manual_score)}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-end">
                        <span
                          className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-semibold ${BAND_CHIP_CLASS[row.score_band]}`}
                          title={t(`bands.${row.score_band}`)}
                        >
                          <Percent className="size-3 opacity-60" />
                          {row.overall_score}
                        </span>
                      </TableCell>
                    </AppDataTableRow>
                  ))}
                </AppDataTable>

                <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                  <span className="min-w-0">
                    {t("pageInfo", {
                      page: page + 1,
                      pages: totalPages,
                      total: totalCount,
                    })}
                    {kpis ? (
                      <span className="ms-2 hidden sm:inline">
                        {t("bandSummary", {
                          top: kpis.band_top,
                          good: kpis.band_good,
                          watch: kpis.band_watch,
                          critical: kpis.band_critical,
                        })}
                      </span>
                    ) : null}
                    {kpis && kpis.rated_drivers > 0 ? (
                      <span className="ms-2 hidden lg:inline">
                        {t("ratingSummary", {
                          rated: kpis.rated_drivers,
                          avg: kpis.avg_manual ?? 0,
                        })}
                      </span>
                    ) : null}
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="h-9 rounded-md border border-border px-3 disabled:opacity-40"
                      disabled={page <= 0}
                      onClick={() => setPage((p) => Math.max(0, p - 1))}
                    >
                      {t("prev")}
                    </button>
                    <button
                      type="button"
                      className="h-9 rounded-md border border-border px-3 disabled:opacity-40"
                      disabled={page + 1 >= totalPages}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      {t("next")}
                    </button>
                  </div>
                </div>
              </>
            )}
          </AppListCard>

          <p className="text-[10px] text-muted-foreground">{t("weightsNote")}</p>
        </>
      )}

      <PerformanceFiltersSheet
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        filters={filters}
        onApply={setFilters}
      />

      <PerformanceDrilldownSheet
        row={selected}
        components={components}
        open={drillOpen}
        onOpenChange={setDrillOpen}
        fromDate={fromDate}
        toDate={toDate}
      />

      <PerformanceReportDialog
        open={reportOpen}
        onOpenChange={setReportOpen}
        fromDate={fromDate}
        toDate={toDate}
        filters={filters}
        search={debouncedSearch}
      />
    </AppPage>
  );
}
