"use client";

/**
 * The selected driver's day: GPS trail, stops, delivery markers and a playback scrubber
 * with the day's events pinned onto the timeline.
 *
 * The route and its events are read together deliberately. "Where did he go" and "what
 * happened while he was there" are the same question during an investigation, and having
 * to correlate two separate screens by timestamp is where the current workflow fails.
 *
 * Geometry is handed *up* to the canvas rather than drawn here: there is one WebGL
 * overlay, and it belongs to the map.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { Pause, Play, Route as RouteIcon, Unlink, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { createClient } from "@/lib/supabase/client";
import { queryKeys } from "@/lib/query/query-keys";
import { cn } from "@/lib/utils";

import { fleetEventTone } from "./fleet-status";
import { FLEET_TONE_DOT } from "./fleet-tone";
import { splitRouteGeometry, type FleetRouteGeometry } from "./fleet-route";
import { useFleetSnapshot } from "./use-fleet";
import type { FleetRouteStop } from "./fleet-map";

/** Playback speeds offered by the scrubber. */
const SPEEDS = [1, 4, 16, 64] as const;
/** Wall-clock ms per playback frame step at 1x. */
const TICK_MS = 100;
/** Stable empty array, so an unresolved query does not invalidate every memo below. */
const EMPTY_POINTS: RoutePoint[] = [];

type RoutePoint = {
  idx: number;
  latitude: number;
  longitude: number;
  speed_mps: number | null;
  battery_pct: number | null;
  heading_deg: number | null;
  tracking_status: string | null;
  zone_status: string | null;
  active_delivery_id: string | null;
  recorded_at: string;
  /**
   * The path from the previous point to this one was never observed — see
   * `fleet-route.ts`. Optional so a cached response from before the RPC carried it
   * still renders, as one unbroken route rather than as nothing.
   */
  gap_before?: boolean | null;
};

type RouteStopRow = {
  latitude: number;
  longitude: number;
  arrived_at: string;
  departed_at: string;
  fixes: number;
  seconds: number;
};

type RouteDeliveryRow = {
  delivery_id: string;
  external_order_id: string | null;
  status: string;
  kind: "pickup" | "delivered" | "cancelled";
  latitude: number;
  longitude: number;
  at: string;
  restaurant_name: string | null;
};

type DayRoute = {
  points: RoutePoint[];
  stops: RouteStopRow[];
  deliveries: RouteDeliveryRow[];
  distance_m: number;
  duration_s: number;
  point_count: number;
  kept_count: number;
  /** Distance the day cannot account for, excluded from `distance_m`. */
  gap_distance_m?: number;
  gap_seconds?: number;
  gap_count?: number;
};

function kuwaitToday(): string {
  // The RPC buckets by Kuwait day; asking with the browser's date would slice the
  // wrong window for anyone reviewing from another timezone.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuwait" }).format(new Date());
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function formatClock(iso: string): string {
  const date = new Date(iso);
  return `${`${date.getHours()}`.padStart(2, "0")}:${`${date.getMinutes()}`.padStart(2, "0")}`;
}

export function DriverDayRoute({
  driverId,
  onGeometry,
  onPlayhead,
  onPlaybackStart,
  onClose,
}: {
  driverId: string;
  onGeometry: (
    geometry: FleetRouteGeometry | null,
    stops: FleetRouteStop[] | null,
  ) => void;
  onPlayhead: (position: [number, number] | null) => void;
  /** Fired when the operator starts playback, so the canvas can frame the day. */
  onPlaybackStart?: () => void;
  onClose: () => void;
}) {
  const t = useTranslations("pages.liveTrackingV2");
  const snapshot = useFleetSnapshot();
  const date = useMemo(() => kuwaitToday(), []);

  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(4);
  const [cursor, setCursor] = useState(0);
  const rafRef = useRef<number>(0);

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.liveTrackingV2.dayRoute(driverId, date),
    queryFn: async (): Promise<DayRoute> => {
      const supabase = createClient();
      const { data: result, error } = await supabase.rpc("admin_get_driver_day_route", {
        p_driver_id: driverId,
        p_date: date,
      });
      if (error) throw new Error(error.message);
      return result as unknown as DayRoute;
    },
    // The trail is history; only the tail grows, and the live pin already shows the
    // present. A minute of staleness here costs nothing and saves a PostGIS simplify.
    staleTime: 60_000,
  });

  const points = useMemo(() => data?.points ?? EMPTY_POINTS, [data]);

  const geometry = useMemo(
    () => (points.length < 2 ? null : splitRouteGeometry(points)),
    [points],
  );

  const stops = useMemo<FleetRouteStop[] | null>(() => {
    if (!data) return null;
    const items: FleetRouteStop[] = [];
    for (const stop of data.stops) {
      items.push({
        id: `stop-${stop.arrived_at}`,
        position: [stop.longitude, stop.latitude],
        kind: "stop",
        label: `${formatClock(stop.arrived_at)} · ${formatDuration(stop.seconds)}`,
      });
    }
    for (const delivery of data.deliveries) {
      items.push({
        id: `${delivery.kind}-${delivery.delivery_id}`,
        position: [delivery.longitude, delivery.latitude],
        kind: delivery.kind === "pickup" ? "pickup" : "delivery",
        label: delivery.external_order_id ?? delivery.delivery_id,
      });
    }
    return items.length > 0 ? items : null;
  }, [data]);

  // Hand geometry to the map, and take it back on unmount or deselect.
  useEffect(() => {
    onGeometry(geometry, stops);
    return () => onGeometry(null, null);
  }, [geometry, onGeometry, stops]);

  /*
   * Play / pause.
   *
   * Starting playback frames the day on the map, once — the camera then follows the
   * playhead we publish below. A restart from the end rewinds first, so the button never
   * looks inert at the end of a route.
   */
  const togglePlay = useCallback(() => {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (points.length > 1 && cursor >= points.length - 1) setCursor(0);
    setPlaying(true);
    onPlaybackStart?.();
  }, [cursor, onPlaybackStart, playing, points.length]);

  // Playback advances the cursor, not the map: the map reads one position from us.
  useEffect(() => {
    if (!playing || points.length < 2) return;

    let last = performance.now();
    const step = (now: number) => {
      const elapsed = now - last;
      if (elapsed >= TICK_MS) {
        last = now;
        setCursor((current) => {
          const next = current + speed;
          if (next >= points.length - 1) {
            setPlaying(false);
            return points.length - 1;
          }
          return next;
        });
      }
      rafRef.current = requestAnimationFrame(step);
    };

    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, points.length, speed]);

  useEffect(() => {
    const point = points[Math.min(cursor, points.length - 1)];
    onPlayhead(playing || cursor > 0 ? (point ? [point.longitude, point.latitude] : null) : null);
  }, [cursor, onPlayhead, playing, points]);

  useEffect(() => () => onPlayhead(null), [onPlayhead]);

  const handleClose = useCallback(() => {
    setPlaying(false);
    onPlayhead(null);
    onGeometry(null, null);
    onClose();
  }, [onClose, onGeometry, onPlayhead]);

  const gapCount = data?.gap_count ?? 0;

  // The day's events, positioned on the timeline by their share of the window.
  const timelineEvents = useMemo(() => {
    if (points.length < 2) return [];
    const first = Date.parse(points[0]!.recorded_at);
    const last = Date.parse(points[points.length - 1]!.recorded_at);
    const span = Math.max(1, last - first);
    return snapshot.feed
      .filter((item) => item.driverId === driverId && item.atMs >= first && item.atMs <= last)
      .map((item) => ({
        id: item.id,
        left: ((item.atMs - first) / span) * 100,
        severity: item.severity,
        eventKey: item.eventKey,
      }));
  }, [driverId, points, snapshot.feed]);

  const cursorPoint = points[Math.min(cursor, Math.max(0, points.length - 1))];

  return (
    <div className="pointer-events-auto absolute inset-x-0 bottom-3 z-30 mx-auto w-[min(560px,calc(100%-24rem))]">
      <div className="fleet-overlay rounded-xl border p-2 shadow-md">
        <div className="flex items-center gap-2">
          <RouteIcon className="size-3.5 text-muted-foreground" aria-hidden />
          <span className="text-[11px] font-semibold">{t("route.heading")}</span>

          {isLoading ? (
            <span className="text-[10px] text-muted-foreground">{t("route.loading")}</span>
          ) : data && points.length > 1 ? (
            <span className="flex items-center gap-2 text-[10px] tabular-nums text-muted-foreground">
              <span>
                {t("route.distance")} {(data.distance_m / 1000).toFixed(1)} km
              </span>
              <span>
                {t("route.duration")} {formatDuration(data.duration_s)}
              </span>
              <span>
                {t("route.stops")} {data.stops.length}
              </span>
              {/*
                A distance that silently excludes untracked stretches is as misleading as
                one that silently includes them, so the day says what it could not
                account for. Not shown at all when there is nothing to disclose — a "0
                gaps" chip on every clean route would train the operator to ignore it.
              */}
              {gapCount > 0 ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <span className="flex cursor-default items-center gap-1 rounded border border-border bg-muted/60 px-1.5 py-px font-medium text-muted-foreground">
                        <Unlink className="size-3" aria-hidden />
                        {t("route.gaps", { count: gapCount })}
                      </span>
                    }
                  />
                  <TooltipContent side="top" className="max-w-[280px]">
                    {t("route.gapsHint", {
                      km: ((data.gap_distance_m ?? 0) / 1000).toFixed(1),
                      duration: formatDuration(data.gap_seconds ?? 0),
                    })}
                  </TooltipContent>
                </Tooltip>
              ) : null}
            </span>
          ) : (
            <span className="text-[10px] text-muted-foreground">{t("route.empty")}</span>
          )}

          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="ms-auto size-6 text-destructive hover:bg-destructive/10"
            aria-label={t("route.close")}
            onClick={handleClose}
          >
            <X className="size-3.5" aria-hidden />
          </Button>
        </div>

        {points.length > 1 ? (
          <div className="mt-2 flex items-center gap-2">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-7"
              aria-label={playing ? t("route.pause") : t("route.play")}
              onClick={togglePlay}
            >
              {playing ? (
                <Pause className="size-3.5" aria-hidden />
              ) : (
                <Play className="size-3.5" aria-hidden />
              )}
            </Button>

            <div className="relative min-w-0 flex-1">
              <input
                type="range"
                min={0}
                max={points.length - 1}
                value={Math.min(cursor, points.length - 1)}
                onChange={(event) => {
                  setPlaying(false);
                  setCursor(Number(event.target.value));
                }}
                aria-label={t("route.heading")}
                className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-[var(--fleet-accent)]"
              />
              {/* Event pins sit above the track, so scrubbing to an incident is a
                  click rather than a hunt through a separate list. */}
              <div className="pointer-events-none absolute inset-x-0 -top-1.5 h-1.5">
                {timelineEvents.map((event) => (
                  <span
                    key={event.id}
                    title={event.eventKey}
                    style={{ insetInlineStart: `${event.left}%` }}
                    className={cn(
                      "absolute size-1.5 -translate-x-1/2 rounded-full",
                      FLEET_TONE_DOT[fleetEventTone(event.severity)],
                    )}
                  />
                ))}
              </div>
            </div>

            <span className="w-10 shrink-0 text-[10px] tabular-nums text-muted-foreground">
              {cursorPoint ? formatClock(cursorPoint.recorded_at) : "--:--"}
            </span>

            <div className="flex shrink-0 items-center gap-0.5">
              {SPEEDS.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setSpeed(option)}
                  aria-pressed={speed === option}
                  className={cn(
                    "h-6 cursor-pointer rounded px-1 text-[10px] font-semibold tabular-nums transition-colors duration-150",
                    speed === option
                      ? "bg-emerald-100 text-emerald-900"
                      : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  {t("route.speedX", { value: option })}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
