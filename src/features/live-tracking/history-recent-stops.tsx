"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import type { DriverLocationEvent } from "@/features/locations/types";
import { Pill } from "@/components/ui/metric-tile";
import { cn } from "@/lib/utils";

type HistoryStop = {
  id: string;
  type: "idle" | "delivery" | "moving";
  startIndex: number;
  startAt: string;
  endAt: string;
  title: string;
};

export function HistoryRecentStops({
  events,
  selectedIndex,
  onSelectIndex,
  formatTime,
  maxItems = 4,
  variant = "default",
}: {
  events: DriverLocationEvent[];
  selectedIndex: number;
  onSelectIndex: (index: number) => void;
  formatTime: (iso: string) => string;
  maxItems?: number;
  variant?: "default" | "overlay";
}) {
  const t = useTranslations("pages.liveTracking");
  const stops = useMemo(() => buildStops(events, maxItems), [events, maxItems]);
  const compact = variant === "overlay";

  if (stops.length === 0) {
    return (
      <div
        className={cn(
          "text-center text-muted-foreground",
          compact ? "px-1 py-2 text-[11px]" : "rounded-xl border border-border bg-card p-3 text-xs",
        )}
      >
        {t("historyNoStops")}
      </div>
    );
  }

  return (
    <div className={cn(compact ? "space-y-1.5" : "space-y-2")}>
      <h4
        className={cn(
          "font-semibold uppercase tracking-wide text-muted-foreground",
          compact ? "text-[10px]" : "text-xs",
        )}
      >
        {t("historyRecentStops")}
      </h4>
      <div
        className={cn(
          "space-y-1",
          !compact && "max-h-[min(280px,35vh)] overflow-y-auto pe-1",
        )}
      >
        {stops.map((stop) => (
          <button
            key={stop.id}
            type="button"
            className={cn(
              "w-full cursor-pointer rounded-lg border text-left transition-colors",
              compact ? "px-2 py-1.5" : "px-2.5 py-2",
              selectedIndex === stop.startIndex
                ? "border-emerald-300 bg-emerald-50/60 dark:border-emerald-800 dark:bg-emerald-950/40"
                : "border-border bg-background/80 hover:bg-muted/40",
            )}
            onClick={() => onSelectIndex(stop.startIndex)}
          >
            <div className="flex items-center justify-between gap-1.5">
              <p
                className={cn(
                  "truncate font-semibold text-foreground",
                  compact ? "text-[11px]" : "text-xs",
                )}
              >
                {stop.title}
              </p>
              <Pill
                tone={stop.type === "delivery" ? "primary" : stop.type === "idle" ? "neutral" : "success"}
                className={compact ? "text-[9px]" : undefined}
              >
                {stop.type === "delivery" ? "Delivery" : stop.type === "idle" ? "Idle" : "Moving"}
              </Pill>
            </div>
            <p className={cn("text-muted-foreground", compact ? "text-[10px]" : "mt-1 text-[11px]")}>
              {formatTime(stop.startAt)}
              {stop.endAt !== stop.startAt ? ` – ${formatTime(stop.endAt)}` : ""}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}

function buildStops(events: DriverLocationEvent[], maxItems: number): HistoryStop[] {
  const sorted = [...events].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
  const result: HistoryStop[] = [];

  let idleStartIndex = -1;
  let idleStart: DriverLocationEvent | null = null;
  for (let i = 0; i < sorted.length; i += 1) {
    const event = sorted[i]!;
    if (event.trackingStatus === "delivery_submit") {
      result.push({
        id: `delivery-${event.id}`,
        type: "delivery",
        startIndex: i,
        startAt: event.recordedAt,
        endAt: event.recordedAt,
        title: "Delivery submitted",
      });
    }

    if (event.trackingStatus === "idle") {
      if (!idleStart) {
        idleStart = event;
        idleStartIndex = i;
      }
      continue;
    }

    if (idleStart) {
      const minutes = (new Date(event.recordedAt).getTime() - new Date(idleStart.recordedAt).getTime()) / 60000;
      if (minutes >= 5) {
        result.push({
          id: `idle-${idleStart.id}`,
          type: "idle",
          startIndex: idleStartIndex,
          startAt: idleStart.recordedAt,
          endAt: event.recordedAt,
          title: "Idle stop",
        });
      }
      idleStart = null;
      idleStartIndex = -1;
    }
  }

  if (idleStart) {
    const last = sorted[sorted.length - 1]!;
    const minutes = (new Date(last.recordedAt).getTime() - new Date(idleStart.recordedAt).getTime()) / 60000;
    if (minutes >= 5) {
      result.push({
        id: `idle-${idleStart.id}`,
        type: "idle",
        startIndex: idleStartIndex,
        startAt: idleStart.recordedAt,
        endAt: last.recordedAt,
        title: "Idle stop",
      });
    }
  }

  const movingCandidates = sorted.filter((event) => event.trackingStatus === "moving");
  if (movingCandidates.length > 0) {
    const firstMoving = movingCandidates[0]!;
    result.unshift({
      id: `moving-${firstMoving.id}`,
      type: "moving",
      startIndex: sorted.findIndex((event) => event.id === firstMoving.id),
      startAt: firstMoving.recordedAt,
      endAt: firstMoving.recordedAt,
      title: "Route start",
    });
  }

  return result
    .sort((a, b) => new Date(b.startAt).getTime() - new Date(a.startAt).getTime())
    .slice(0, maxItems);
}
