"use client";

import { useLocale, useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, ListChecks } from "lucide-react";
import { queryKeys } from "@/lib/query/query-keys";
import { cn } from "@/lib/utils";
import { fetchDriverOperationTimeline } from "./operations-read-actions";
import {
  humanizeErrorCode,
  humanizeOperationKey,
  operationCategoryTone,
  operationMessageKey,
} from "./operation-labels";

const KUWAIT_TZ = "Asia/Kuwait";

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

/** Recent operations for one driver — used in the map popup and the driver detail tab. */
export function DriverOperationTimeline({
  driverId,
  limit = 8,
  onViewAll,
  className,
}: {
  driverId: string;
  limit?: number;
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
            className="inline-flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-primary transition-colors hover:bg-primary/10"
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
      ) : events.length === 0 ? (
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-300">{t("activityEmpty")}</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {events.map((event) => {
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
                <span className="w-10 shrink-0 text-[10px] tabular-nums text-slate-500 dark:text-slate-400">
                  {formatClock(event.occurredAt, locale)}
                </span>
                <span className="min-w-0 flex-1 truncate text-[11px] text-slate-700 dark:text-slate-200">
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
