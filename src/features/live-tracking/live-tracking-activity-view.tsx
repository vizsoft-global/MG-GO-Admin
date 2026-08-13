"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUp, ChevronDown, ListChecks, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { MetricTile } from "@/components/ui/metric-tile";
import { SearchSelect } from "@/components/ui/search-select";
import { ToggleChip } from "@/components/app/toggle-chip";
import { fetchDriversForAdmin } from "@/features/drivers/drivers-actions";
import { queryKeys } from "@/lib/query/query-keys";
import { driverSearchOptions } from "@/lib/search-options";
import { useRealtimeInvalidator } from "@/lib/realtime/use-realtime-invalidator";
import { cn } from "@/lib/utils";
import {
  fetchDriverOperationFeed,
  fetchOperationCategoryCounts,
  type DriverOperationEvent,
  type OperationFeedCursor,
} from "./operations-read-actions";
import {
  humanizeCategory,
  humanizeErrorCode,
  humanizeOperationKey,
  operationCategoryTone,
  operationMessageKey,
} from "./operation-labels";
import { TrackingTabSwitcher, type TrackingViewTab } from "./tracking-tab-switcher";
import { TrackingCommandLayout, TrackingGlassCard } from "./tracking-shell";

const KUWAIT_TZ = "Asia/Kuwait";
const PAGE_SIZE = 50;

const CATEGORIES = [
  "auth",
  "duty",
  "location",
  "delivery",
  "request",
  "esign",
  "visit",
  "notification",
  "profile",
  "device",
  "security",
] as const;

type ActivityRange = "today" | "24h" | "7d";

/**
 * Only the lower bound is bounded. An upper bound of `now` is captured at mount,
 * so every event that arrives afterwards — the whole point of a live feed —
 * would be filtered out of the refetch that realtime just triggered.
 */
function rangeBounds(range: ActivityRange): { from: string; to: null } {
  const now = new Date();
  if (range === "today") {
    const kuwaitDate = new Intl.DateTimeFormat("en-CA", { timeZone: KUWAIT_TZ }).format(now);
    return { from: `${kuwaitDate}T00:00:00+03:00`, to: null };
  }
  const hours = range === "24h" ? 24 : 24 * 7;
  return {
    from: new Date(now.getTime() - hours * 3600 * 1000).toISOString(),
    to: null,
  };
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
    parts.push(`${humanizeCategory(key).toLowerCase()}: ${String(value)}`);
    if (parts.length === 3) break;
  }
  return parts.join(" · ");
}

const TONE_CHIP: Record<string, string> = {
  primary: "border-primary/20 bg-primary/10 text-primary",
  success: "border-emerald-200 bg-emerald-50 text-emerald-700",
  warning: "border-amber-200 bg-amber-100 text-amber-800",
  danger: "border-rose-200 bg-rose-50 text-rose-700",
  neutral: "border-border bg-muted/40 text-muted-foreground",
};

export function LiveTrackingActivityView({
  activeTab,
  onTabChange,
  showActivityTab,
  showDiagnosticsTab,
  initialDriverId,
}: {
  activeTab: TrackingViewTab;
  onTabChange: (tab: TrackingViewTab) => void;
  showActivityTab?: boolean;
  showDiagnosticsTab?: boolean;
  /** Set when arriving from a driver popup's View all. */
  initialDriverId?: string | null;
}) {
  const t = useTranslations("pages.liveTracking");
  const locale = useLocale();
  const queryClient = useQueryClient();

  const [driverId, setDriverId] = useState<string>(initialDriverId ?? "");
  const [range, setRange] = useState<ActivityRange>("today");
  const [categories, setCategories] = useState<string[]>([]);
  const [failuresOnly, setFailuresOnly] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Live updates pause while the operator has scrolled into older events, so a
  // burst of new rows never yanks the row they are reading out from under them.
  const pausedRef = useRef(false);
  const [paused, setPaused] = useState(false);

  const bounds = useMemo(() => rangeBounds(range), [range]);

  const filterKey = useMemo(
    () => ({
      driverId: driverId || null,
      categories: categories.length ? [...categories].sort() : null,
      failuresOnly,
      range,
    }),
    [driverId, categories, failuresOnly, range],
  );

  const feedQuery = useInfiniteQuery({
    queryKey: queryKeys.liveTracking.operations(filterKey),
    initialPageParam: null as OperationFeedCursor | null,
    queryFn: ({ pageParam }) =>
      fetchDriverOperationFeed({
        driverId: driverId || null,
        categories: categories.length ? categories : null,
        failuresOnly,
        from: bounds.from,
        to: bounds.to,
        cursor: pageParam,
        limit: PAGE_SIZE,
      }),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    refetchOnWindowFocus: false,
  });

  const { data: categoryCounts = [] } = useQuery({
    queryKey: queryKeys.liveTracking.operationCategories({
      range,
      driverId: driverId || null,
    }),
    queryFn: () =>
      fetchOperationCategoryCounts({
        from: bounds.from,
        to: bounds.to,
        driverId: driverId || null,
      }),
  });

  const events: DriverOperationEvent[] = useMemo(
    () => feedQuery.data?.pages.flatMap((page) => page.events) ?? [],
    [feedQuery.data],
  );

  useRealtimeInvalidator({
    channel: "admin-driver-operations",
    tables: [{ table: "driver_operation_events", event: "INSERT" }],
    invalidateKeys: paused
      ? []
      : [
          queryKeys.liveTracking.operations(filterKey),
          queryKeys.liveTracking.operationCategories({
            range,
            driverId: driverId || null,
          }),
        ],
    debounceMs: 500,
    onChange: () => {
      if (pausedRef.current) setPendingCount((count) => count + 1);
    },
  });

  const onScroll = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;
    const isPaused = node.scrollTop > 24;
    if (isPaused === pausedRef.current) return;
    pausedRef.current = isPaused;
    setPaused(isPaused);
    if (!isPaused) setPendingCount(0);
  }, []);

  const resumeLive = useCallback(() => {
    scrollRef.current?.scrollTo({ top: 0 });
    pausedRef.current = false;
    setPaused(false);
    setPendingCount(0);
    void queryClient.invalidateQueries({
      queryKey: queryKeys.liveTracking.operations(filterKey),
    });
  }, [queryClient, filterKey]);

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

  const totals = useMemo(() => {
    let total = 0;
    let failures = 0;
    for (const row of categoryCounts) {
      total += row.total;
      failures += row.failures;
    }
    return { total, failures };
  }, [categoryCounts]);

  const topCategory = categoryCounts[0];

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
                label={t("activityEvents")}
                value={totals.total}
                tone="neutral"
                className="min-h-[72px]"
              />
              <MetricTile
                label={t("activityFailures")}
                value={totals.failures}
                tone={totals.failures > 0 ? "danger" : "neutral"}
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
                recentsKey="activity-driver-select"
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
              <Label className="text-xs text-muted-foreground">{t("activityCategory")}</Label>
              <div className="flex flex-wrap gap-1.5">
                {CATEGORIES.map((category) => (
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
                    {t.has(`activityCategories.${category}`)
                      ? t(`activityCategories.${category}`)
                      : humanizeCategory(category)}
                  </ToggleChip>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground">
                {categories.length === 0 ? t("activityAllCategories") : null}
              </p>
            </div>

            <ToggleChip
              selected={failuresOnly}
              onClick={() => setFailuresOnly((prev) => !prev)}
              icon={ShieldAlert}
              size="md"
              className="w-full justify-start"
            >
              {t("activityFailuresOnly")}
            </ToggleChip>

            {topCategory ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3 text-xs text-slate-600 dark:border-slate-700/70 dark:bg-slate-900/50 dark:text-slate-300">
                <p className="font-semibold text-slate-800 dark:text-slate-100">
                  {t("activityBreakdown")}
                </p>
                <dl className="mt-2 space-y-1.5">
                  {categoryCounts.slice(0, 6).map((row) => (
                    <div key={row.category} className="flex justify-between gap-2">
                      <dt>
                        {t.has(`activityCategories.${row.category}`)
                          ? t(`activityCategories.${row.category}`)
                          : humanizeCategory(row.category)}
                      </dt>
                      <dd className="font-medium tabular-nums text-slate-900 dark:text-slate-50">
                        {row.total}
                        {row.failures > 0 ? (
                          <span className="ms-1 text-rose-600 dark:text-rose-400">
                            ({row.failures})
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
              <ListChecks className="h-4 w-4 shrink-0 text-primary" />
              <h2 className="truncate text-sm font-semibold">{t("activityFeed")}</h2>
              <Badge variant="secondary" className="text-[10px] tabular-nums">
                {events.length}
              </Badge>
            </div>
            {paused && pendingCount > 0 ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 cursor-pointer gap-1 border-emerald-500 bg-emerald-100 text-[11px] font-semibold text-emerald-900 hover:bg-emerald-200"
                onClick={resumeLive}
              >
                <ArrowUp className="h-3 w-3" />
                {t("activityNewEvents", { count: pendingCount })}
              </Button>
            ) : null}
          </div>

          <div
            ref={scrollRef}
            onScroll={onScroll}
            className="min-h-0 flex-1 divide-y divide-border overflow-y-auto"
          >
            {feedQuery.isLoading ? (
              <div className="space-y-2 p-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="h-10 animate-pulse rounded-md bg-muted/50" />
                ))}
              </div>
            ) : events.length === 0 ? (
              <div className="px-4 py-12 text-center text-sm text-muted-foreground">
                {t("activityEmpty")}
              </div>
            ) : (
              events.map((event) => (
                <ActivityRow key={event.id} event={event} locale={locale} />
              ))
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

function ActivityRow({
  event,
  locale,
}: {
  event: DriverOperationEvent;
  locale: string;
}) {
  const t = useTranslations("pages.liveTracking");
  const tone = operationCategoryTone(event.category);
  const summary = contextSummary(event.context);

  const messageKey = `activityOperations.${operationMessageKey(event.operationKey)}`;
  const label = t.has(messageKey)
    ? t(messageKey)
    : humanizeOperationKey(event.operationKey);

  return (
    <div className="flex items-start gap-3 px-4 py-2">
      <span className="w-[104px] shrink-0 pt-0.5 text-[11px] tabular-nums text-muted-foreground">
        {formatEventTime(event.occurredAt, locale)}
      </span>
      <span
        className={cn(
          "shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
          TONE_CHIP[tone],
        )}
      >
        {t.has(`activityCategories.${event.category}`)
          ? t(`activityCategories.${event.category}`)
          : humanizeCategory(event.category)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium">
          {label}
          {event.success ? null : (
            <span className="ms-1.5 text-[11px] font-semibold text-rose-600 dark:text-rose-400">
              {event.errorCode ? humanizeErrorCode(event.errorCode) : t("activityFailed")}
            </span>
          )}
        </p>
        {summary ? (
          <p className="truncate text-[10px] text-muted-foreground">{summary}</p>
        ) : null}
      </div>
      <div className="w-[132px] shrink-0 text-end">
        <p className="truncate text-xs font-medium">{event.driverName}</p>
        <p className="truncate text-[10px] text-muted-foreground">{event.driverCode}</p>
      </div>
    </div>
  );
}
