"use client";

import { Gauge, MapPinned, PauseCircle, Route, Timer, Truck } from "lucide-react";
import { useTranslations } from "next-intl";
import { MetricTile } from "@/components/ui/metric-tile";
import { haversineMeters } from "@/features/locations/location-status";
import type { DriverLocationEvent } from "@/features/locations/types";

/** Gaps longer than this are treated as offline / end-of-session (excluded from duration). */
const MAX_ACTIVE_GAP_MS = 20 * 60 * 1000;
/** Cap implausible GPS jumps between nearby timestamps. */
const MAX_SEGMENT_METERS = 500;
const MAX_SEGMENT_CAP_WINDOW_MS = 2 * 60 * 1000;

export type HistorySummary = {
  totalDistanceKm: number | null;
  durationMins: number | null;
  idleMinutes: number | null;
  movingMinutes: number | null;
  avgSpeedKmh: number | null;
  maxSpeedKmh: number | null;
  stops: number | null;
  deliveries: number | null;
};

export function formatHistoryDurationMins(mins: number): string {
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  const remainder = mins % 60;
  return remainder > 0 ? `${hours}h ${remainder}m` : `${hours}h`;
}

export function computeHistorySummary(events: DriverLocationEvent[]): HistorySummary {
  if (events.length === 0) {
    return {
      totalDistanceKm: null,
      durationMins: null,
      idleMinutes: null,
      movingMinutes: null,
      avgSpeedKmh: null,
      maxSpeedKmh: null,
      stops: null,
      deliveries: null,
    };
  }

  const sorted = [...events].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
  let totalMeters = 0;
  let activeMs = 0;
  let idleMs = 0;
  let movingMs = 0;
  let maxSpeedMps = 0;
  let deliveries = 0;
  let stops = 0;

  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1]!;
    const curr = sorted[i]!;
    const prevMs = new Date(prev.recordedAt).getTime();
    const currMs = new Date(curr.recordedAt).getTime();
    const gapMs = Math.max(0, currMs - prevMs);

    let segmentMeters = haversineMeters(prev.latitude, prev.longitude, curr.latitude, curr.longitude);
    if (gapMs > 0 && gapMs <= MAX_SEGMENT_CAP_WINDOW_MS && segmentMeters > MAX_SEGMENT_METERS) {
      segmentMeters = MAX_SEGMENT_METERS;
    }
    totalMeters += segmentMeters;

    if (gapMs > 0 && gapMs <= MAX_ACTIVE_GAP_MS) {
      activeMs += gapMs;
      if (prev.trackingStatus === "idle") {
        idleMs += gapMs;
      } else if (
        prev.trackingStatus === "moving" ||
        prev.trackingStatus === "delivery_submit"
      ) {
        movingMs += gapMs;
      }
    }
  }

  for (const event of sorted) {
    if (event.trackingStatus === "delivery_submit") deliveries += 1;
    if (event.speedMps != null) maxSpeedMps = Math.max(maxSpeedMps, event.speedMps);
  }

  let idleStart: DriverLocationEvent | null = null;
  for (const event of sorted) {
    if (event.trackingStatus === "idle") {
      if (!idleStart) idleStart = event;
      continue;
    }
    if (idleStart) {
      const idleMins =
        (new Date(event.recordedAt).getTime() - new Date(idleStart.recordedAt).getTime()) / 60000;
      if (idleMins >= 5) stops += 1;
      idleStart = null;
    }
  }
  if (idleStart) {
    const last = sorted[sorted.length - 1]!;
    const idleMins =
      (new Date(last.recordedAt).getTime() - new Date(idleStart.recordedAt).getTime()) / 60000;
    if (idleMins >= 5) stops += 1;
  }

  const durationMins = activeMs > 0 ? Math.max(1, Math.round(activeMs / 60000)) : sorted.length > 1 ? 0 : 0;
  const totalDistanceKm = totalMeters / 1000;
  const avgSpeedKmh =
    activeMs > 0 && totalDistanceKm > 0 ? totalDistanceKm / (activeMs / 3_600_000) : 0;

  return {
    totalDistanceKm,
    durationMins: sorted.length > 1 ? durationMins : 0,
    idleMinutes: sorted.length > 1 ? Math.round(idleMs / 60000) : 0,
    movingMinutes: sorted.length > 1 ? Math.round(movingMs / 60000) : 0,
    avgSpeedKmh: activeMs > 0 ? avgSpeedKmh : 0,
    maxSpeedKmh: maxSpeedMps * 3.6,
    stops,
    deliveries,
  };
}

export function HistorySummaryKpis({
  summary,
  loading = false,
}: {
  summary: HistorySummary;
  loading?: boolean;
}) {
  const t = useTranslations("pages.liveTracking");

  const valueOrDash = (value: number | null, formatter: (n: number) => string) =>
    value == null ? "—" : formatter(value);

  return (
    <div className="grid grid-cols-2 gap-2">
      <MetricTile
        label={t("historyTotalDistance")}
        value={loading ? "..." : valueOrDash(summary.totalDistanceKm, (n) => `${n.toFixed(1)} km`)}
        icon={Route}
        tone="primary"
      />
      <MetricTile
        label={t("historyDuration")}
        value={
          loading
            ? "..."
            : valueOrDash(summary.durationMins, (n) => (n > 0 ? formatHistoryDurationMins(n) : "—"))
        }
        icon={Timer}
        tone="primary"
      />
      <MetricTile
        label={t("historyAvgSpeed")}
        value={
          loading
            ? "..."
            : valueOrDash(summary.avgSpeedKmh, (n) => (n > 0 ? `${n.toFixed(1)} km/h` : "—"))
        }
        icon={Gauge}
        tone="success"
      />
      <MetricTile
        label={t("historyMaxSpeed")}
        value={loading ? "..." : valueOrDash(summary.maxSpeedKmh, (n) => `${n.toFixed(1)} km/h`)}
        icon={MapPinned}
        tone="warning"
      />
      <MetricTile
        label={t("historyIdleMinutes")}
        value={
          loading
            ? "..."
            : valueOrDash(summary.idleMinutes, (n) => formatHistoryDurationMins(n))
        }
        icon={PauseCircle}
        tone="neutral"
      />
      <MetricTile
        label={t("historyMovingMinutes")}
        value={
          loading
            ? "..."
            : valueOrDash(summary.movingMinutes, (n) => formatHistoryDurationMins(n))
        }
        icon={Gauge}
        tone="success"
      />
      <MetricTile
        label={t("historyStops")}
        value={loading ? "..." : valueOrDash(summary.stops, (n) => `${n}`)}
        icon={PauseCircle}
        tone="neutral"
      />
      <MetricTile
        label={t("historyDeliveries")}
        value={loading ? "..." : valueOrDash(summary.deliveries, (n) => `${n}`)}
        icon={Truck}
        tone="danger"
      />
    </div>
  );
}
