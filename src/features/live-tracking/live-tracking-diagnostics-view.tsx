"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  ChevronDown,
  Download,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Stethoscope,
  Timer,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { MetricTile } from "@/components/ui/metric-tile";
import { SearchSelect } from "@/components/ui/search-select";
import { ToggleChip } from "@/components/app/toggle-chip";
import { fetchDriversForAdmin } from "@/features/drivers/drivers-actions";
import { buildCsv, downloadCsv } from "@/features/driver-tracking/csv-export";
import { queryKeys } from "@/lib/query/query-keys";
import { driverSearchOptions } from "@/lib/search-options";
import { cn } from "@/lib/utils";
import {
  exportTelemetryEvents,
  fetchTelemetryFeed,
  fetchTelemetrySummary,
  type DriverTelemetryEvent,
  type TelemetryFeedCursor,
} from "./telemetry-read-actions";
import {
  fetchDriverOperationFeed,
  type DriverOperationEvent,
} from "./operations-read-actions";
import {
  TELEMETRY_CATEGORIES,
  formatClockSkew,
  humanizeTelemetryCategory,
  humanizeTelemetryEvent,
  telemetryCategoryTone,
  telemetryMessageKey,
} from "./telemetry-labels";
import {
  humanizeCategory,
  humanizeOperationKey,
  operationMessageKey,
} from "./operation-labels";
import { mergeTelemetryWithOperations } from "./telemetry-ops-merge";
import { TrackingTabSwitcher, type TrackingViewTab } from "./tracking-tab-switcher";
import { TrackingCommandLayout, TrackingGlassCard } from "./tracking-shell";

const KUWAIT_TZ = "Asia/Kuwait";
const PAGE_SIZE = 50;
const POLL_MS = 20_000;
const OPS_OVERLAY_LIMIT = 100;

type DiagnosticsRange = "today" | "24h" | "7d";

const TONE_CHIP: Record<string, string> = {
  primary: "border-primary/20 bg-primary/10 text-primary",
  success: "border-emerald-200 bg-emerald-50 text-emerald-700",
  warning: "border-amber-200 bg-amber-100 text-amber-800",
  danger: "border-rose-200 bg-rose-50 text-rose-700",
  neutral: "border-border bg-muted/40 text-muted-foreground",
};

/** Lower bound only, for the same reason as the Activity feed. */
function rangeFrom(range: DiagnosticsRange): string {
  const now = new Date();
  if (range === "today") {
    const kuwaitDate = new Intl.DateTimeFormat("en-CA", { timeZone: KUWAIT_TZ }).format(now);
    return `${kuwaitDate}T00:00:00+03:00`;
  }
  const hours = range === "24h" ? 24 : 24 * 7;
  return new Date(now.getTime() - hours * 3600 * 1000).toISOString();
}

function formatEventTime(iso: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZone: KUWAIT_TZ,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function contextSummary(context: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(context)) {
    if (value == null || typeof value === "object") continue;
    parts.push(`${key.replace(/_/g, " ")}: ${String(value)}`);
    if (parts.length === 3) break;
  }
  return parts.join(" · ");
}

export function LiveTrackingDiagnosticsView({
  activeTab,
  onTabChange,
  showActivityTab,
  showDiagnosticsTab,
  canExport = false,
  canViewOperations = false,
}: {
  activeTab: TrackingViewTab;
  onTabChange: (tab: TrackingViewTab) => void;
  showActivityTab?: boolean;
  showDiagnosticsTab?: boolean;
  canExport?: boolean;
  /** The business-operation overlay reads the Phase 1 feed, so it needs driver_ops.view. */
  canViewOperations?: boolean;
}) {
  const t = useTranslations("pages.liveTracking");
  const locale = useLocale();

  const [driverId, setDriverId] = useState("");
  const [range, setRange] = useState<DiagnosticsRange>("today");
  const [categories, setCategories] = useState<string[]>([]);
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [includeOperations, setIncludeOperations] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [exporting, setExporting] = useState(false);

  const from = useMemo(() => rangeFrom(range), [range]);

  const filterKey = useMemo(
    () => ({
      driverId: driverId || null,
      categories: categories.length ? [...categories].sort() : null,
      errorsOnly,
      range,
    }),
    [driverId, categories, errorsOnly, range],
  );

  const feedQuery = useInfiniteQuery({
    queryKey: queryKeys.liveTracking.telemetry(filterKey),
    initialPageParam: null as TelemetryFeedCursor | null,
    queryFn: ({ pageParam }) =>
      fetchTelemetryFeed({
        driverId: driverId || null,
        categories: categories.length ? categories : null,
        errorsOnly,
        from,
        cursor: pageParam,
        limit: PAGE_SIZE,
      }),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    // Opt-in polling instead of realtime: telemetry is high volume, so it is
    // deliberately not on the WAL publication every admin client subscribes to.
    refetchInterval: autoRefresh ? POLL_MS : false,
    refetchOnWindowFocus: false,
  });

  const summaryQuery = useQuery({
    queryKey: queryKeys.liveTracking.telemetrySummary({
      range,
      driverId: driverId || null,
    }),
    queryFn: () => fetchTelemetrySummary({ from, driverId: driverId || null }),
    refetchInterval: autoRefresh ? POLL_MS : false,
  });

  const telemetry: DriverTelemetryEvent[] = useMemo(
    () => feedQuery.data?.pages.flatMap((page) => page.events) ?? [],
    [feedQuery.data],
  );

  // Single driver only: a merged fleet-wide feed would interleave unrelated
  // riders and stop reading as one device's story.
  const overlayEnabled = includeOperations && Boolean(driverId) && canViewOperations;

  const opsQuery = useQuery({
    queryKey: queryKeys.liveTracking.operations({
      driverId: driverId || null,
      range,
      overlay: true,
    }),
    queryFn: () =>
      fetchDriverOperationFeed({
        driverId: driverId || null,
        from,
        limit: OPS_OVERLAY_LIMIT,
      }),
    enabled: overlayEnabled,
  });

  const merged = useMemo(
    () =>
      mergeTelemetryWithOperations<DriverTelemetryEvent, DriverOperationEvent>(
        telemetry,
        opsQuery.data?.events ?? [],
        { includeOperations: overlayEnabled },
      ),
    [telemetry, opsQuery.data, overlayEnabled],
  );

  const { data: driversMeta = [] } = useQuery({
    queryKey: queryKeys.drivers.list({ archived: false }),
    queryFn: () => fetchDriversForAdmin({ archived: false }),
  });

  const driverSelectItems = useMemo(
    () =>
      driverSearchOptions(
        driversMeta
          .filter((d) => d.linked_profile_id)
          .map((d) => ({
            id: d.linked_profile_id as string,
            name: d.full_name,
            employee_code: d.driver_code,
            mobile: d.phone,
            user_id: d.linked_profile_id,
          })),
      ),
    [driversMeta],
  );

  const summary = summaryQuery.data;

  const handleExport = async () => {
    setExporting(true);
    try {
      const rows = await exportTelemetryEvents({
        driverId: driverId || null,
        categories: categories.length ? categories : null,
        errorsOnly,
        from,
      });
      const csv = buildCsv(
        [
          "client_ts",
          "server_received_at",
          "clock_skew_ms",
          "driver_code",
          "event_name",
          "category",
          "severity",
          "platform",
          "app_version_name",
          "app_version_code",
          "network_state",
          "session_id",
          "correlation_id",
          "context",
          "context_stripped_keys",
        ],
        rows.map((row) => [
          row.clientTs,
          row.serverReceivedAt,
          row.clockSkewMs,
          row.driverCode,
          row.eventName,
          row.category,
          row.severity,
          row.platform,
          row.appVersionName,
          row.appVersionCode,
          row.networkState,
          row.sessionId,
          row.correlationId,
          JSON.stringify(row.context),
          row.contextStrippedKeys,
        ]),
      );
      downloadCsv(`driver-diagnostics-${range}.csv`, csv);
    } catch {
      toast.error(t("diagnosticsExportFailed"));
    } finally {
      setExporting(false);
    }
  };

  return (
    <TrackingCommandLayout
      left={
        <TrackingGlassCard className="flex min-h-0 flex-1 flex-col overflow-hidden border-slate-200 bg-white dark:border-slate-700/80 dark:bg-slate-900">
          <div className="shrink-0 border-b border-slate-200 px-3 py-2.5 dark:border-slate-700/80">
            <TrackingTabSwitcher
              value={activeTab}
              onChange={onTabChange}
              showActivity={showActivityTab}
              showDiagnostics={showDiagnosticsTab}
              className="mb-2"
            />
            <div className="grid grid-cols-2 gap-2">
              <MetricTile
                label={t("diagnosticsEvents")}
                value={summary?.total ?? 0}
                tone="neutral"
                className="min-h-[72px]"
              />
              <MetricTile
                label={t("diagnosticsErrors")}
                value={summary?.errors ?? 0}
                tone={(summary?.errors ?? 0) > 0 ? "danger" : "neutral"}
                className="min-h-[72px]"
              />
              <MetricTile
                label={t("diagnosticsMaxSkew")}
                value={formatClockSkew(summary?.maxClockSkewMs ?? 0)}
                tone={(summary?.maxClockSkewMs ?? 0) > 60_000 ? "warning" : "neutral"}
                className="min-h-[72px]"
              />
              <MetricTile
                label={t("diagnosticsOffline")}
                value={summary?.offlineTransitions ?? 0}
                tone={(summary?.offlineTransitions ?? 0) > 0 ? "warning" : "neutral"}
                className="min-h-[72px]"
              />
            </div>
          </div>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">{t("historyDriver")}</Label>
              <SearchSelect
                items={driverSelectItems}
                value={driverId || null}
                onChange={(id) => setDriverId(id ?? "")}
                placeholder={t("activityAllDrivers")}
                searchPlaceholder={t("searchByDriverHint")}
                recentsKey="diagnostics-driver-select"
                defaultLimit={10}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">{t("activityRange")}</Label>
              <div className="flex flex-wrap gap-1.5">
                <ToggleChip selected={range === "today"} onClick={() => setRange("today")}>
                  {t("historyToday")}
                </ToggleChip>
                <ToggleChip selected={range === "24h"} onClick={() => setRange("24h")}>
                  {t("activityLast24h")}
                </ToggleChip>
                <ToggleChip selected={range === "7d"} onClick={() => setRange("7d")}>
                  {t("historyLast7Days")}
                </ToggleChip>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                {t("diagnosticsCategory")}
              </Label>
              <div className="flex flex-wrap gap-1.5">
                {TELEMETRY_CATEGORIES.map((category) => (
                  <ToggleChip
                    key={category}
                    selected={categories.includes(category)}
                    onClick={() =>
                      setCategories((prev) =>
                        prev.includes(category)
                          ? prev.filter((c) => c !== category)
                          : [...prev, category],
                      )
                    }
                  >
                    {t.has(`diagnosticsCategories.${category}`)
                      ? t(`diagnosticsCategories.${category}`)
                      : humanizeTelemetryCategory(category)}
                  </ToggleChip>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground">
                {categories.length === 0 ? t("diagnosticsAllCategories") : null}
              </p>
            </div>

            <ToggleChip
              selected={errorsOnly}
              onClick={() => setErrorsOnly((prev) => !prev)}
              icon={ShieldAlert}
              size="md"
              className="w-full justify-start"
            >
              {t("diagnosticsErrorsOnly")}
            </ToggleChip>

            {canViewOperations ? (
              <div className="space-y-1">
                <ToggleChip
                  selected={overlayEnabled}
                  onClick={() => setIncludeOperations((prev) => !prev)}
                  icon={Stethoscope}
                  size="md"
                  disabled={!driverId}
                  className="w-full justify-start"
                >
                  {t("diagnosticsIncludeOps")}
                </ToggleChip>
                {!driverId ? (
                  <p className="text-[10px] text-muted-foreground">
                    {t("diagnosticsIncludeOpsHint")}
                  </p>
                ) : null}
              </div>
            ) : null}

            <ToggleChip
              selected={autoRefresh}
              onClick={() => setAutoRefresh((prev) => !prev)}
              icon={Timer}
              size="md"
              className="w-full justify-start"
            >
              {t("diagnosticsAutoRefresh")}
            </ToggleChip>

            {summary?.categories.length ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3 text-xs text-slate-600 dark:border-slate-700/70 dark:bg-slate-900/50 dark:text-slate-300">
                <p className="font-semibold text-slate-800 dark:text-slate-100">
                  {t("diagnosticsBreakdown")}
                </p>
                <dl className="mt-2 space-y-1.5">
                  {summary.categories.slice(0, 7).map((row) => (
                    <div key={row.category} className="flex justify-between gap-2">
                      <dt>
                        {t.has(`diagnosticsCategories.${row.category}`)
                          ? t(`diagnosticsCategories.${row.category}`)
                          : humanizeTelemetryCategory(row.category)}
                      </dt>
                      <dd className="font-medium tabular-nums text-slate-900 dark:text-slate-50">
                        {row.total}
                        {row.errors > 0 ? (
                          <span className="ms-1 text-rose-600 dark:text-rose-400">
                            ({row.errors})
                          </span>
                        ) : null}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            ) : null}
          </div>
        </TrackingGlassCard>
      }
      center={
        <TrackingGlassCard className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-2.5">
            <div className="flex min-w-0 items-center gap-2">
              <Stethoscope className="h-4 w-4 shrink-0 text-primary" />
              <h2 className="truncate text-sm font-semibold">{t("diagnosticsFeed")}</h2>
              <Badge variant="secondary" className="text-[10px] tabular-nums">
                {merged.length}
              </Badge>
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 cursor-pointer gap-1.5 text-primary hover:bg-primary/10"
                disabled={feedQuery.isFetching}
                onClick={() => {
                  void feedQuery.refetch();
                  void summaryQuery.refetch();
                }}
              >
                <RefreshCw
                  className={cn("h-3.5 w-3.5", feedQuery.isFetching && "animate-spin")}
                />
                {t("diagnosticsRefresh")}
              </Button>
              {canExport ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 cursor-pointer gap-1.5 text-xs"
                  disabled={exporting}
                  onClick={() => void handleExport()}
                >
                  {exporting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Download className="h-3.5 w-3.5" />
                  )}
                  {t("diagnosticsExport")}
                </Button>
              ) : null}
            </div>
          </div>

          <div className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
            {feedQuery.isLoading ? (
              <div className="space-y-2 p-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="h-10 animate-pulse rounded-md bg-muted/50" />
                ))}
              </div>
            ) : merged.length === 0 ? (
              <div className="px-4 py-12 text-center text-sm text-muted-foreground">
                {t("diagnosticsEmpty")}
              </div>
            ) : (
              merged.map((entry) =>
                entry.kind === "telemetry" ? (
                  <TelemetryRow
                    key={entry.key}
                    event={entry.telemetry}
                    locale={locale}
                    showDriver={!driverId}
                  />
                ) : (
                  <OperationOverlayRow
                    key={entry.key}
                    event={entry.operation}
                    locale={locale}
                  />
                ),
              )
            )}

            {feedQuery.hasNextPage ? (
              <div className="p-3 text-center">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 cursor-pointer gap-1 text-xs"
                  disabled={feedQuery.isFetchingNextPage}
                  onClick={() => void feedQuery.fetchNextPage()}
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                  {feedQuery.isFetchingNextPage ? t("activityLoading") : t("activityLoadMore")}
                </Button>
              </div>
            ) : null}
          </div>
        </TrackingGlassCard>
      }
    />
  );
}

function TelemetryRow({
  event,
  locale,
  showDriver,
}: {
  event: DriverTelemetryEvent;
  locale: string;
  showDriver: boolean;
}) {
  const t = useTranslations("pages.liveTracking");
  const tone = telemetryCategoryTone(event.category);
  const summary = contextSummary(event.context);

  const messageKey = `telemetryEvents.${telemetryMessageKey(event.eventName)}`;
  const label = t.has(messageKey) ? t(messageKey) : humanizeTelemetryEvent(event.eventName);

  return (
    <div className="flex items-start gap-3 px-4 py-2">
      <span className="w-[104px] shrink-0 pt-0.5 text-[11px] tabular-nums text-muted-foreground">
        {formatEventTime(event.clientTs, locale)}
      </span>
      <span
        className={cn(
          "shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
          TONE_CHIP[tone],
        )}
      >
        {t.has(`diagnosticsCategories.${event.category}`)
          ? t(`diagnosticsCategories.${event.category}`)
          : humanizeTelemetryCategory(event.category)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium">
          {label}
          {event.severity === "error" ? (
            <span className="ms-1.5 text-[11px] font-semibold text-rose-600 dark:text-rose-400">
              {t("diagnosticsErrorTag")}
            </span>
          ) : null}
          {event.contextStrippedKeys > 0 ? (
            <span
              className="ms-1.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400"
              title={t("diagnosticsStrippedHint")}
            >
              {t("diagnosticsStripped", { count: event.contextStrippedKeys })}
            </span>
          ) : null}
        </p>
        {summary ? (
          <p className="truncate text-[10px] text-muted-foreground">{summary}</p>
        ) : null}
      </div>
      <div className="w-[132px] shrink-0 text-end">
        {showDriver ? (
          <>
            <p className="truncate text-xs font-medium">{event.driverName}</p>
            <p className="truncate text-[10px] text-muted-foreground">{event.driverCode}</p>
          </>
        ) : (
          <p className="truncate text-[10px] text-muted-foreground">
            {formatClockSkew(event.clockSkewMs)}
          </p>
        )}
      </div>
    </div>
  );
}

/** Read-only Phase 1 row, visually distinct so the two streams never blur. */
function OperationOverlayRow({
  event,
  locale,
}: {
  event: DriverOperationEvent;
  locale: string;
}) {
  const t = useTranslations("pages.liveTracking");
  const messageKey = `activityOperations.${operationMessageKey(event.operationKey)}`;
  const label = t.has(messageKey) ? t(messageKey) : humanizeOperationKey(event.operationKey);

  return (
    <div className="flex items-start gap-3 bg-primary/5 px-4 py-2">
      <span className="w-[104px] shrink-0 pt-0.5 text-[11px] tabular-nums text-muted-foreground">
        {formatEventTime(event.occurredAt, locale)}
      </span>
      <span className="shrink-0 rounded-md border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
        {t("diagnosticsOperationTag")}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium">
          {label}
          {event.success ? null : (
            <span className="ms-1.5 text-[11px] font-semibold text-rose-600 dark:text-rose-400">
              {event.errorCode ?? t("activityFailed")}
            </span>
          )}
        </p>
        <p className="truncate text-[10px] text-muted-foreground">
          {t.has(`activityCategories.${event.category}`)
            ? t(`activityCategories.${event.category}`)
            : humanizeCategory(event.category)}
        </p>
      </div>
      <div className="w-[132px] shrink-0" />
    </div>
  );
}
