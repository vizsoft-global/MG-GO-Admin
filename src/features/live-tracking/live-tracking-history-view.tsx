"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { Label } from "@/components/ui/label";
import { SearchSelect } from "@/components/ui/search-select";
import { ToggleChip } from "@/components/app/toggle-chip";
import { DriverLocationsMap } from "@/features/locations/driver-locations-map";
import { fetchDriverAssignedRestaurantPins } from "@/features/locations/locations-actions";
import { fetchDriversForAdmin } from "@/features/drivers/drivers-actions";
import { queryKeys } from "@/lib/query/query-keys";
import { driverSearchOptions } from "@/lib/search-options";
import type { DriverLocationEvent } from "@/features/locations/types";
import { HistoryPlaybackControls } from "./history-playback-controls";
import { useLiveHistory } from "./use-live-history";
import { TrackingTabSwitcher, type TrackingViewTab } from "./tracking-tab-switcher";
import { TrackingCommandLayout, TrackingGlassCard, TrackingMapStage } from "./tracking-shell";
import { HistorySummaryKpis, computeHistorySummary, formatHistoryDurationMins } from "./history-summary-kpis";
import { HistoryDatePicker } from "./history-date-picker";
import { useDriverHistoryActiveDates } from "./use-driver-history-dates";
import {
  HistoryLoadingSkeleton,
  NoDataForDateEmpty,
  SelectDriverEmpty,
} from "./history-empty-states";
import { HistoryDriverHeader } from "./history-driver-header";
import { HistoryRecentStops } from "./history-recent-stops";
import { HistoryEventsTable } from "./history-events-table";

const KUWAIT_TZ = "Asia/Kuwait";

function kuwaitToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: KUWAIT_TZ }).format(new Date());
}

function subsamplePath<T>(points: T[], max = 500): T[] {
  if (points.length <= max) return points;
  const step = Math.ceil(points.length / max);
  return points.filter((_, i) => i % step === 0 || i === points.length - 1);
}

function formatTime(iso: string, locale?: string): string {
  try {
    return new Intl.DateTimeFormat(locale ?? "en", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZone: KUWAIT_TZ,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function kuwaitDateShift(daysBack: number): string {
  const now = new Date();
  const shifted = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: KUWAIT_TZ }).format(shifted);
}

function formatDateLabel(date: string, locale?: string): string {
  const parsed = new Date(`${date}T00:00:00+03:00`);
  return new Intl.DateTimeFormat(locale ?? "en", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: KUWAIT_TZ,
  }).format(parsed);
}

export function LiveTrackingHistoryView({
  activeTab,
  onTabChange,
}: {
  activeTab: TrackingViewTab;
  onTabChange: (tab: TrackingViewTab) => void;
}) {
  const t = useTranslations("pages.liveTracking");
  const locale = useLocale();
  const [driverId, setDriverId] = useState<string>("");
  const [date, setDate] = useState(kuwaitToday());
  const [dateEnd, setDateEnd] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const lastTickRef = useRef<number>(0);
  const rafRef = useRef<number | null>(null);

  const { data: driversMeta = [] } = useQuery({
    queryKey: queryKeys.drivers.list({ archived: false }),
    queryFn: () => fetchDriversForAdmin({ archived: false }),
  });

  const linkedDrivers = useMemo(
    () =>
      driversMeta
        .filter((d) => d.linked_profile_id)
        .map((d) => ({
          id: d.linked_profile_id as string,
          name: d.full_name,
          employee_code: d.driver_code,
          mobile: d.phone,
          user_id: d.linked_profile_id,
        })),
    [driversMeta],
  );

  const driverSelectItems = useMemo(() => driverSearchOptions(linkedDrivers), [linkedDrivers]);

  const { data: events = [], isLoading } = useLiveHistory(driverId || null, date, dateEnd);

  const yearMonth = date.slice(0, 7);
  const [calendarMonth, setCalendarMonth] = useState(yearMonth);
  useEffect(() => {
    setCalendarMonth(date.slice(0, 7));
  }, [date]);
  const { data: activeDateList = [] } = useDriverHistoryActiveDates(driverId || null, calendarMonth);
  const activeDates = useMemo(() => new Set(activeDateList), [activeDateList]);

  const sortedEvents = useMemo(
    () => [...events].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt)),
    [events],
  );

  useEffect(() => {
    setIndex(0);
    setPlaying(false);
  }, [driverId, date, dateEnd, sortedEvents.length]);

  const path = useMemo(
    () =>
      subsamplePath(
        sortedEvents.map((e) => ({ lat: e.latitude, lng: e.longitude })),
      ),
    [sortedEvents],
  );

  const currentEvent: DriverLocationEvent | null = sortedEvents[index] ?? null;
  const summary = useMemo(() => computeHistorySummary(sortedEvents), [sortedEvents]);

  const markers = useMemo(() => {
    const list: Array<{
      id: string;
      lat: number;
      lng: number;
      title?: string;
      highlight?: boolean;
      pinStatus?: "active" | "idle" | "alert";
      trackingStatus?: DriverLocationEvent["trackingStatus"];
    }> = [];

    for (const e of sortedEvents) {
      if (e.trackingStatus === "delivery_submit") {
        list.push({
          id: `delivery-${e.id}`,
          lat: e.latitude,
          lng: e.longitude,
          title: t("deliverySubmitMarker"),
          highlight: true,
        });
      }
    }

    if (currentEvent) {
      list.push({
        id: "playback-head",
        lat: currentEvent.latitude,
        lng: currentEvent.longitude,
        title: formatTime(currentEvent.recordedAt, locale),
        pinStatus: "active",
        trackingStatus: currentEvent.trackingStatus,
        highlight: true,
      });
    }

    return list;
  }, [sortedEvents, currentEvent, t, locale]);

  const deliverySubmitIndices = useMemo(
    () =>
      sortedEvents.reduce<number[]>((acc, event, idx) => {
        if (event.trackingStatus === "delivery_submit") acc.push(idx);
        return acc;
      }, []),
    [sortedEvents],
  );

  const durationLabel = useMemo(() => {
    if (summary.durationMins == null || summary.durationMins <= 0) return "—";
    return formatHistoryDurationMins(summary.durationMins);
  }, [summary.durationMins]);

  useEffect(() => {
    if (!playing || sortedEvents.length < 2) {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }

    const stepMs = 500 / speed;

    const tick = (now: number) => {
      if (lastTickRef.current === 0) lastTickRef.current = now;
      const elapsed = now - lastTickRef.current;
      if (elapsed >= stepMs) {
        lastTickRef.current = now;
        setIndex((prev) => {
          if (prev >= sortedEvents.length - 1) {
            setPlaying(false);
            return prev;
          }
          return prev + 1;
        });
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      lastTickRef.current = 0;
    };
  }, [playing, speed, sortedEvents.length]);

  const selectedDriverMeta = useMemo(
    () => driversMeta.find((row) => row.linked_profile_id === driverId) ?? null,
    [driverId, driversMeta],
  );

  const { data: historyRestaurantPins = [] } = useQuery({
    queryKey: queryKeys.liveTracking.restaurantPins(driverId),
    enabled: Boolean(driverId),
    queryFn: () => fetchDriverAssignedRestaurantPins(driverId),
  });

  const historyRestaurantMarkers = useMemo(
    () =>
      historyRestaurantPins.map((pin) => ({
        id: pin.id,
        lat: pin.latitude,
        lng: pin.longitude,
        title: pin.name,
      })),
    [historyRestaurantPins],
  );

  const quickRange = useMemo(() => {
    if (dateEnd === kuwaitToday() && date === kuwaitDateShift(6)) return "last7";
    if (!dateEnd && date === kuwaitToday()) return "today";
    if (!dateEnd && date === kuwaitDateShift(1)) return "yesterday";
    return "custom";
  }, [date, dateEnd]);

  const historyDateLabel = useMemo(() => {
    if (dateEnd && dateEnd !== date) {
      return `${formatDateLabel(date, locale)} – ${formatDateLabel(dateEnd, locale)}`;
    }
    return formatDateLabel(date, locale);
  }, [date, dateEnd, locale]);

  return (
    <div className="space-y-2">
      <TrackingCommandLayout
        left={
          <TrackingGlassCard className="flex min-h-0 flex-1 flex-col overflow-hidden border-slate-200 bg-white dark:border-slate-700/80 dark:bg-slate-900">
            <div className="shrink-0 border-b border-slate-200 px-3 py-2.5 dark:border-slate-700/80">
              <TrackingTabSwitcher value={activeTab} onChange={onTabChange} className="mb-2" />
              <HistorySummaryKpis summary={summary} loading={isLoading} />
            </div>

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">{t("historyDriver")}</Label>
                  <SearchSelect
                    items={driverSelectItems}
                    value={driverId || null}
                    onChange={(id) => setDriverId(id ?? "")}
                    placeholder={t("selectDriver")}
                    searchPlaceholder={t("searchByDriverHint")}
                    recentsKey="history-driver-select"
                    defaultLimit={10}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">{t("historyDate")}</Label>
                  <HistoryDatePicker
                    value={date}
                    onChange={(nextDate) => {
                      setDate(nextDate);
                      setDateEnd(null);
                    }}
                    activeDates={activeDates}
                    disabled={!driverId}
                    locale={locale}
                    onViewMonthChange={setCalendarMonth}
                  />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <ToggleChip
                    selected={quickRange === "today"}
                    onClick={() => {
                      setDate(kuwaitToday());
                      setDateEnd(null);
                    }}
                  >
                    {t("historyToday")}
                  </ToggleChip>
                  <ToggleChip
                    selected={quickRange === "yesterday"}
                    onClick={() => {
                      setDate(kuwaitDateShift(1));
                      setDateEnd(null);
                    }}
                  >
                    {t("historyYesterday")}
                  </ToggleChip>
                  <ToggleChip
                    selected={quickRange === "last7"}
                    onClick={() => {
                      setDate(kuwaitDateShift(6));
                      setDateEnd(kuwaitToday());
                    }}
                  >
                    {t("historyLast7Days")}
                  </ToggleChip>
                </div>

                {driverId && sortedEvents.length > 0 ? (
                  <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3 text-xs text-slate-600 dark:border-slate-700/70 dark:bg-slate-900/50 dark:text-slate-300">
                    <p className="font-semibold text-slate-800 dark:text-slate-100">{t("historyTripOverview")}</p>
                    <dl className="mt-2 space-y-1.5">
                      <div className="flex justify-between gap-2">
                        <dt>{t("historyGpsEvents")}</dt>
                        <dd className="font-medium tabular-nums text-slate-900 dark:text-slate-50">
                          {sortedEvents.length}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt>{t("historyFirstPing")}</dt>
                        <dd className="font-medium tabular-nums text-slate-900 dark:text-slate-50">
                          {formatTime(sortedEvents[0]!.recordedAt, locale)}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt>{t("historyLastPing")}</dt>
                        <dd className="font-medium tabular-nums text-slate-900 dark:text-slate-50">
                          {formatTime(sortedEvents[sortedEvents.length - 1]!.recordedAt, locale)}
                        </dd>
                      </div>
                    </dl>
                  </div>
                ) : null}
              </div>
            </div>
          </TrackingGlassCard>
        }
        center={
          <TrackingMapStage>
            {!driverId ? (
              <SelectDriverEmpty />
            ) : isLoading ? (
              <div className="h-full w-full bg-muted/40 p-4">
                <HistoryLoadingSkeleton />
              </div>
            ) : sortedEvents.length === 0 ? (
              <NoDataForDateEmpty
                dateLabel={historyDateLabel}
                onPickYesterday={() => {
                  setDate(kuwaitDateShift(1));
                  setDateEnd(null);
                }}
                onPickLast7Days={() => {
                  setDate(kuwaitDateShift(6));
                  setDateEnd(kuwaitToday());
                }}
              />
            ) : (
              <>
                <DriverLocationsMap
                  markers={markers}
                  path={path}
                  restaurantMarkers={historyRestaurantMarkers}
                  mapHeightClass="h-full min-h-0"
                  fitToMarkers={path.length > 0 || historyRestaurantMarkers.length > 0}
                  className="h-full rounded-none border-0"
                  frameless
                />
                {selectedDriverMeta ? (
                  <div className="pointer-events-none absolute left-3 top-3 z-20 max-w-[280px]">
                    <div className="pointer-events-auto">
                      <HistoryDriverHeader
                        name={selectedDriverMeta.full_name}
                        code={selectedDriverMeta.driver_code}
                        zoneName={selectedDriverMeta.zone_name}
                        isOnDuty={selectedDriverMeta.is_on_duty}
                        dateLabel={historyDateLabel}
                        avatarUrl={selectedDriverMeta.avatar_display_url}
                      />
                    </div>
                  </div>
                ) : null}
                <div className="pointer-events-none absolute right-3 top-3 z-20 flex w-[min(288px,calc(100%-1.5rem))] flex-col items-end gap-2">
                  <div className="pointer-events-auto w-full">
                    <HistoryPlaybackControls
                      playing={playing}
                      onTogglePlay={() => {
                        lastTickRef.current = 0;
                        setPlaying((prev) => !prev);
                      }}
                      onRestart={() => {
                        setPlaying(false);
                        setIndex(0);
                      }}
                      speed={speed}
                      onSpeedChange={(value) => {
                        setSpeed(value);
                        lastTickRef.current = 0;
                      }}
                      index={index}
                      maxIndex={sortedEvents.length - 1}
                      onIndexChange={(nextIndex) => {
                        setPlaying(false);
                        setIndex(nextIndex);
                      }}
                      currentLabel={currentEvent ? formatTime(currentEvent.recordedAt, locale) : "—"}
                      durationLabel={durationLabel}
                      deliverySubmitIndices={deliverySubmitIndices}
                    />
                  </div>
                  <div className="pointer-events-auto w-full">
                    <TrackingGlassCard className="border-border/80 bg-card/95 p-2 shadow-md backdrop-blur-sm">
                      <HistoryRecentStops
                        variant="overlay"
                        maxItems={4}
                        events={sortedEvents}
                        selectedIndex={index}
                        onSelectIndex={(nextIndex) => {
                          setPlaying(false);
                          setIndex(nextIndex);
                        }}
                        formatTime={(iso) => formatTime(iso, locale)}
                      />
                    </TrackingGlassCard>
                  </div>
                </div>
              </>
            )}
          </TrackingMapStage>
        }
      />

      {driverId && !isLoading && sortedEvents.length > 0 ? (
        <HistoryEventsTable
          events={sortedEvents}
          currentIndex={index}
          onSelectIndex={(nextIndex) => {
            setPlaying(false);
            setIndex(nextIndex);
          }}
          formatTime={(iso) => formatTime(iso, locale)}
        />
      ) : null}
    </div>
  );
}
