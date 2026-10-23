"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, ListChecks } from "lucide-react";
import { queryKeys } from "@/lib/query/query-keys";
import { cn } from "@/lib/utils";
import {
  fetchDriverOperationTimeline,
  type DriverOperationEvent,
} from "./operations-read-actions";
import {
  humanizeErrorCode,
  humanizeOperationKey,
  operationCategoryTone,
  operationMessageKey,
} from "./operation-labels";

const KUWAIT_TZ = "Asia/Kuwait";
const NO_EXTRA_EVENTS: readonly TimelineExtraEvent[] = [];

const TONE_DOT: Record<string, string> = {
  primary: "bg-primary",
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  danger: "bg-rose-500",
  neutral: "bg-slate-400",
};

function formatClock(iso: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: KUWAIT_TZ,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export type TimelineExtraEvent = {
  id: string;
  occurredAt: string;
  operationKey: string;
  success?: boolean;
  category?: string;
};

function extraToOperationEvent(
  extra: TimelineExtraEvent,
  driverId: string,
): DriverOperationEvent {
  return {
    id: extra.id,
    driverId,
    driverName: "",
    driverCode: "",
    category: extra.category ?? extra.operationKey.split(".")[0] ?? "location",
    operationKey: extra.operationKey,
    source: "fleet",
    sourceName: null,
    success: extra.success ?? true,
    errorCode: null,
    entityType: null,
    entityId: null,
    context: {},
    latitude: null,
    longitude: null,
    deviceId: null,
    appVersionCode: null,
    occurredAt: extra.occurredAt,
  };
}

/** Recent operations for one driver — used in the map popup and the driver detail tab. */
export function DriverOperationTimeline({
  driverId,
  limit = 8,
  extraEvents = NO_EXTRA_EVENTS,
  onViewAll,
  className,
}: {
  driverId: string;
  limit?: number;
  extraEvents?: readonly TimelineExtraEvent[];
  onViewAll?: () => void;
  className?: string;
}) {
  const t = useTranslations("pages.liveTracking");
  const locale = useLocale();

  const { data: events = [], isLoading } = useQuery({
    queryKey: queryKeys.liveTracking.driverOperations(driverId, limit),
    queryFn: () => fetchDriverOperationTimeline(driverId, limit),
    enabled: Boolean(driverId),
  });

  const rows = useMemo(() => {
    if (extraEvents.length === 0) return events;
    const seen = new Set(events.map((event) => event.id));
    const merged = [...events];
    for (const extra of extraEvents) {
      if (seen.has(extra.id)) continue;
      seen.add(extra.id);
      merged.push(extraToOperationEvent(extra, driverId));
    }
    merged.sort((a, b) => {
      const delta = Date.parse(b.occurredAt) - Date.parse(a.occurredAt);
      if (delta !== 0) return delta;
      return b.id.localeCompare(a.id);
    });
    return merged.slice(0, limit);
  }, [events, extraEvents, driverId, limit]);

  return (
    <section
      className={cn(
        "rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <h4 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900 dark:text-slate-100">
          <ListChecks className="h-3.5 w-3.5" />
          {t("activityTimeline")}
        </h4>
        {onViewAll ? (
          <button
            type="button"
            onClick={onViewAll}
            className="inline-flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/10"
          >
            <ExternalLink className="h-3 w-3" />
            {t("viewAll")}
          </button>
        ) : null}
      </div>

      {isLoading ? (
        <div className="mt-2 space-y-1.5">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-5 animate-pulse rounded bg-muted/50" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-300">{t("activityEmpty")}</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {rows.map((event) => {
            const messageKey = `activityOperations.${operationMessageKey(event.operationKey)}`;
            const label = t.has(messageKey)
              ? t(messageKey)
              : humanizeOperationKey(event.operationKey);

            return (
              <li key={event.id} className="flex items-start gap-2">
                <span
                  className={cn(
                    "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                    event.success
                      ? TONE_DOT[operationCategoryTone(event.category)]
                      : "bg-rose-500",
                  )}
                />
                <span className="w-10 shrink-0 text-xs tabular-nums text-slate-500 dark:text-slate-400">
                  {formatClock(event.occurredAt, locale)}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs text-slate-700 dark:text-slate-200">
                  {label}
                  {event.success ? null : (
                    <span className="ms-1 font-semibold text-rose-600 dark:text-rose-400">
                      {event.errorCode
                        ? humanizeErrorCode(event.errorCode)
                        : t("activityFailed")}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
