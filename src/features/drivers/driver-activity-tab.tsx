"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useInfiniteQuery } from "@tanstack/react-query";
import { ChevronDown, Download, Loader2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ToggleChip } from "@/components/app/toggle-chip";
import { TrackingGlassCard } from "@/features/live-tracking/tracking-shell";
import {
  exportDriverOperations,
  fetchDriverOperationFeed,
  type DriverOperationEvent,
  type OperationFeedCursor,
} from "@/features/live-tracking/operations-read-actions";
import {
  humanizeCategory,
  humanizeErrorCode,
  humanizeOperationKey,
  operationCategoryTone,
  operationMessageKey,
} from "@/features/live-tracking/operation-labels";
import { buildCsv, downloadCsv } from "@/features/driver-tracking/csv-export";
import { queryKeys } from "@/lib/query/query-keys";
import { cn } from "@/lib/utils";

const KUWAIT_TZ = "Asia/Kuwait";
const PAGE_SIZE = 50;

type ActivityRange = "7d" | "30d" | "all";

const TONE_CHIP: Record<string, string> = {
  primary: "border-primary/20 bg-primary/10 text-primary",
  success: "border-emerald-200 bg-emerald-50 text-emerald-700",
  warning: "border-amber-200 bg-amber-100 text-amber-800",
  danger: "border-rose-200 bg-rose-50 text-rose-700",
  neutral: "border-border bg-muted/40 text-muted-foreground",
};

function rangeFrom(range: ActivityRange): string | null {
  if (range === "all") return null;
  const days = range === "7d" ? 7 : 30;
  return new Date(Date.now() - days * 86400 * 1000).toISOString();
}

function formatEventTime(iso: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: KUWAIT_TZ,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function DriverActivityTab({
  driverId,
  driverCode,
  canExport,
}: {
  driverId: string;
  driverCode: string;
  canExport: boolean;
}) {
  const t = useTranslations("pages.liveTracking");
  const tDetail = useTranslations("pages.driverDetail");
  const locale = useLocale();

  const [range, setRange] = useState<ActivityRange>("7d");
  const [failuresOnly, setFailuresOnly] = useState(false);
  const [exporting, setExporting] = useState(false);

  const from = useMemo(() => rangeFrom(range), [range]);

  const feedQuery = useInfiniteQuery({
    queryKey: queryKeys.liveTracking.operations({ driverId, range, failuresOnly }),
    initialPageParam: null as OperationFeedCursor | null,
    queryFn: ({ pageParam }) =>
      fetchDriverOperationFeed({
        driverId,
        failuresOnly,
        from,
        cursor: pageParam,
        limit: PAGE_SIZE,
      }),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });

  const events: DriverOperationEvent[] = useMemo(
    () => feedQuery.data?.pages.flatMap((page) => page.events) ?? [],
    [feedQuery.data],
  );

  // Export re-reads the server with the current filters instead of dumping the
  // pages already in memory: an operator normally exports after scrolling one
  // page, and a 50-row file would silently look complete.
  const handleExport = async () => {
    setExporting(true);
    try {
      const rows = await exportDriverOperations({ driverId, failuresOnly, from });
      const csv = buildCsv(
        [
          "occurred_at",
          "category",
          "operation",
          "success",
          "error_code",
          "source_name",
          "entity_type",
          "entity_id",
          "latitude",
          "longitude",
          "device_id",
          "app_version_code",
          "context",
        ],
        rows.map((row) => [
          row.occurredAt,
          row.category,
          row.operationKey,
          row.success ? "true" : "false",
          row.errorCode,
          row.sourceName,
          row.entityType,
          row.entityId,
          row.latitude,
          row.longitude,
          row.deviceId,
          row.appVersionCode,
          JSON.stringify(row.context),
        ]),
      );
      downloadCsv(`driver-${driverCode}-activity.csv`, csv);
    } catch {
      toast.error(tDetail("activityExportFailed"));
    } finally {
      setExporting(false);
    }
  };

  return (
    <TrackingGlassCard className="flex min-h-0 flex-col border-slate-200 bg-white dark:border-slate-700/80 dark:bg-slate-900">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 p-4 dark:border-slate-700/80">
        <div className="flex flex-wrap items-center gap-1.5">
          <ToggleChip selected={range === "7d"} onClick={() => setRange("7d")}>
            {t("historyLast7Days")}
          </ToggleChip>
          <ToggleChip selected={range === "30d"} onClick={() => setRange("30d")}>
            {tDetail("activityLast30Days")}
          </ToggleChip>
          <ToggleChip selected={range === "all"} onClick={() => setRange("all")}>
            {tDetail("activityAll")}
          </ToggleChip>
          <ToggleChip
            selected={failuresOnly}
            onClick={() => setFailuresOnly((prev) => !prev)}
            icon={ShieldAlert}
          >
            {t("activityFailuresOnly")}
          </ToggleChip>
        </div>
        {canExport ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 cursor-pointer gap-1.5"
            disabled={exporting}
            onClick={() => void handleExport()}
          >
            {exporting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            {tDetail("activityExport")}
          </Button>
        ) : null}
      </div>

      <div className="max-h-[520px] min-h-0 flex-1 divide-y divide-border overflow-y-auto">
        {feedQuery.isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
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
  const messageKey = `activityOperations.${operationMessageKey(event.operationKey)}`;
  const label = t.has(messageKey) ? t(messageKey) : humanizeOperationKey(event.operationKey);

  return (
    <div className="flex items-start gap-3 px-4 py-2">
      <span className="w-[92px] shrink-0 pt-0.5 text-[11px] tabular-nums text-muted-foreground">
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
      <p className="min-w-0 flex-1 truncate text-xs font-medium">
        {label}
        {event.success ? null : (
          <span className="ms-1.5 text-[11px] font-semibold text-rose-600 dark:text-rose-400">
            {event.errorCode ? humanizeErrorCode(event.errorCode) : t("activityFailed")}
          </span>
        )}
      </p>
      {event.sourceName ? (
        <span className="hidden w-[168px] shrink-0 truncate text-end text-[10px] text-muted-foreground sm:block">
          {event.sourceName}
        </span>
      ) : null}
    </div>
  );
}
