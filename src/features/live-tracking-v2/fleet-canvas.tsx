"use client";

/**
 * The full-bleed command canvas.
 *
 * This is the sanctioned divergence from the shared `TrackingGlassCard` side-by-side
 * shell (recorded in `ui-system.mdc` §3 and §12, scoped to V2): the map *is* the page,
 * and the driver rail and insights panel float over it. On a 14" laptop a side-by-side
 * grid leaves the map about 55% of the width, which is the wrong trade for a tracking
 * surface where the map is the primary instrument.
 *
 * Nothing scrolls the page. The canvas is exactly one viewport; the rail and the panel
 * scroll internally.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Crosshair,
  Layers,
  Maximize2,
  Minimize2,
  Minus,
  Plus,
  RotateCcw,
  Satellite,
  SlidersHorizontal,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchSelect } from "@/components/ui/search-select";
import { ToggleChip } from "@/components/app/toggle-chip";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { FleetMap, type FleetMapHandle, type FleetRouteStop } from "./fleet-map";
import { FleetRail } from "./fleet-rail";
import { FleetInsightsPanel } from "./fleet-insights-panel";
import { FleetLegend } from "./fleet-legend";
import { FleetConnectionPill } from "./fleet-connection-pill";
import { DriverDayRoute } from "./driver-day-route";
import { FLEET_FILTER_STATUSES, type FleetStatus } from "./fleet-status";
import { toggleFleetAlertsOnly, toggleFleetStatusChip } from "./fleet-types";
import { useFleetSnapshot, useFleetStore } from "./use-fleet";

import "./fleet-theme.css";

export function FleetCanvas() {
  const t = useTranslations("pages.liveTrackingV2");
  const store = useFleetStore();
  const snapshot = useFleetSnapshot();

  const shellRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<FleetMapHandle | null>(null);

  const [fullscreen, setFullscreen] = useState(false);
  const [showZones, setShowZones] = useState(true);
  const [satellite, setSatellite] = useState(false);
  const [showFilters, setShowFilters] = useState(true);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [insightsCollapsed, setInsightsCollapsed] = useState(false);
  const railUserOverride = useRef<boolean | null>(null);
  const insightsUserOverride = useRef<boolean | null>(null);
  const [routePath, setRoutePath] = useState<[number, number][] | null>(null);
  const [routeStops, setRouteStops] = useState<FleetRouteStop[] | null>(null);
  const [playhead, setPlayhead] = useState<[number, number] | null>(null);

  const { filters, selectedDriverId } = snapshot;

  /*
   * Clicking a driver (rail, pin, or same-card re-click) must bring the camera to them.
   * Selection only used to open the day-route strip, so operators reported "nothing
   * happens".
   *
   * The retry exists because a selection can land before the map does: the rail renders
   * from the store's first snapshot, while the map is still waiting on the Google Maps
   * script, the deck.gl chunk and the first interpolated fix. The window is generous
   * (~4s) because the alternative failure is silent — the camera simply never moves, and
   * that is the exact defect this loop was added to fix. Each attempt is cheap: a ref read
   * and a Map lookup that returns false until the pin has a position.
   */
  useEffect(() => {
    if (!selectedDriverId) return;
    const id = selectedDriverId;
    let attempts = 0;
    let timer: number | undefined;
    const tryFocus = () => {
      if (mapRef.current?.focusDriver(id)) return;
      if (attempts >= 40) return;
      attempts += 1;
      timer = window.setTimeout(tryFocus, 100);
    };
    tryFocus();
    return () => {
      if (timer != null) window.clearTimeout(timer);
    };
  }, [selectedDriverId]);

  // Below ~1100px of canvas the 300px rail and 340px insights sit on top of each
  // other. Collapse to the 48px strips (the sanctioned V2 pattern) instead of
  // letting them paint over the driver cards. A manual expand is remembered until
  // the canvas grows past the threshold again.
  useEffect(() => {
    const node = shellRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      if (width <= 0) return;
      if (insightsUserOverride.current == null) {
        setInsightsCollapsed(width < 1100);
      } else if (width >= 1100) {
        insightsUserOverride.current = null;
      }
      if (railUserOverride.current == null) {
        setRailCollapsed(width < 760);
      } else if (width >= 760) {
        railUserOverride.current = null;
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Fullscreen is the browser's, not a CSS class: a WebGL canvas re-parented by a
  // class change loses its context, and the Fullscreen API keeps the same element.
  useEffect(() => {
    const onChange = () => {
      const active = document.fullscreenElement === shellRef.current;
      setFullscreen(active);
      // Google Maps needs a nudge after the element resizes.
      requestAnimationFrame(() => mapRef.current?.resize());
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void shellRef.current?.requestFullscreen?.();
    }
  }, []);

  const zoneOptions = useMemo(
    () => [
      { value: "all", label: t("filters.allZones"), keywords: ["all", "zones"] },
      ...snapshot.zones.map((zone) => ({
        value: zone.id,
        label: zone.name,
        keywords: [zone.name],
      })),
    ],
    [snapshot.zones, t],
  );

  const partnerOptions = useMemo(
    () => [
      { value: "all", label: t("filters.allPartners"), keywords: ["all", "partners"] },
      ...snapshot.partners.map((partner) => ({
        value: partner.id,
        label: partner.name,
        keywords: [partner.name],
      })),
    ],
    [snapshot.partners, t],
  );

  const toggleStatus = useCallback(
    (status: FleetStatus) => {
      store.setFilters(toggleFleetStatusChip(filters, status));
    },
    [filters, store],
  );

  const toggleAlertsOnly = useCallback(() => {
    store.setFilters(toggleFleetAlertsOnly(filters));
  }, [filters, store]);

  const activeStatuses = filters.alertsOnly
    ? []
    : (filters.statuses ?? [...FLEET_FILTER_STATUSES]);
  const filtersDirty =
    filters.search !== "" ||
    filters.statuses !== null ||
    filters.zoneId !== null ||
    filters.partnerId !== null ||
    filters.alertsOnly;

  /*
   * The strip's X is a deselect, not just a "hide the route".
   *
   * Clearing the geometry alone left `selectedDriverId` set, so the strip remounted on the
   * next render and the close button appeared to do nothing. It is also the third deselect
   * path the rulebook requires alongside the map background and a same-marker click.
   */
  const handleRouteClose = useCallback(() => {
    setRoutePath(null);
    setRouteStops(null);
    setPlayhead(null);
    store.clearSelection();
  }, [store]);

  /*
   * Playback frames the day once, then the map follows the playhead.
   *
   * Deliberately on play rather than on route load: selecting a rider street-zooms to
   * them, and framing the whole day the moment the route resolved would move the camera
   * twice for one click, the second move undoing the first. Pressing play is the point at
   * which the operator has asked to watch the route rather than the rider.
   */
  const handlePlaybackStart = useCallback(() => {
    if (routePath && routePath.length > 1) mapRef.current?.fitPath(routePath);
  }, [routePath]);

  return (
    <div
      ref={shellRef}
      className={cn(
        "fleet-canvas relative flex h-[calc(100dvh-1.5rem)] min-h-[520px] w-full overflow-hidden rounded-xl border border-border bg-card shadow-sm",
        fullscreen && "h-screen min-h-0 rounded-none border-0",
      )}
    >
      <div className="fleet-map-surface absolute inset-0">
        <FleetMap
          ref={mapRef}
          routePath={routePath}
          routeStops={routeStops}
          playheadPosition={playhead}
          showZones={showZones}
          mapTypeId={satellite ? "hybrid" : "roadmap"}
        />
      </div>

      {/*
        One overlay layer, laid out in normal flow inside it: top chrome, then the two
        side panels each above their own bottom chrome. The panels used to be positioned
        independently with hand-tuned top insets, which is how the driver rail came to
        paint over the filter row — the rail's inset assumed a one-line title bar, while
        the filter card sits directly beneath that bar and wraps to two rows on a narrow
        viewport. In flow a taller filter card pushes the rail down instead of being
        covered by it, and there are no magic numbers left to keep in sync.

        Logical properties throughout, so the whole canvas mirrors under RTL without a
        second layout.
      */}
      <div className="pointer-events-none absolute inset-3 z-20 flex flex-col gap-2">
        <div className="relative z-30 flex shrink-0 items-start justify-between gap-2">
          <div className="pointer-events-auto flex min-w-0 max-w-[min(680px,72%)] flex-col gap-2">
            <div className="fleet-overlay flex h-9 items-center gap-2 rounded-lg border px-2.5 shadow-sm">
              <Satellite className="size-4 text-muted-foreground" aria-hidden />
              <span className="text-sm font-semibold">{t("title")}</span>
              <span className="hidden text-[11px] text-muted-foreground sm:inline">
                {t("subtitle")}
              </span>
              <FleetConnectionPill />
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-7"
                aria-pressed={showFilters}
                aria-label={t("filters.statuses")}
                onClick={() => setShowFilters((open) => !open)}
              >
                <SlidersHorizontal className="size-3.5" aria-hidden />
              </Button>
            </div>

            {showFilters ? (
              <div className="fleet-overlay flex flex-wrap items-center gap-2 rounded-lg border p-2 shadow-sm">
                <Input
                  value={filters.search}
                  onChange={(event) => store.setFilters({ search: event.target.value })}
                  placeholder={t("filters.search")}
                  className="h-9 w-[200px]"
                  aria-label={t("filters.search")}
                />

                <SearchSelect
                  items={zoneOptions}
                  value={filters.zoneId ?? "all"}
                  onChange={(value) =>
                    store.setFilters({ zoneId: !value || value === "all" ? null : value })
                  }
                  className="h-9 w-[160px]"
                  placeholder={t("filters.allZones")}
                  searchPlaceholder={t("filters.searchZone")}
                  recentsKey="fleet-v2-zone"
                  clearable={false}
                />

                <SearchSelect
                  items={partnerOptions}
                  value={filters.partnerId ?? "all"}
                  onChange={(value) =>
                    store.setFilters({
                      partnerId: !value || value === "all" ? null : value,
                    })
                  }
                  className="h-9 w-[170px]"
                  placeholder={t("filters.allPartners")}
                  searchPlaceholder={t("filters.searchPartner")}
                  recentsKey="fleet-v2-partner"
                  clearable={false}
                />

                <div className="flex flex-wrap items-center gap-1.5">
                  {FLEET_FILTER_STATUSES.map((status) => (
                    <ToggleChip
                      key={status}
                      selected={activeStatuses.includes(status)}
                      onClick={() => toggleStatus(status)}
                    >
                      {t(`status.${status}`)}
                    </ToggleChip>
                  ))}
                  <ToggleChip
                    selected={filters.alertsOnly}
                    onClick={toggleAlertsOnly}
                  >
                    {t("filters.alertsOnly")}
                  </ToggleChip>
                </div>

                {filtersDirty ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-9 gap-1.5 text-xs"
                    onClick={() => store.resetFilters()}
                  >
                    <RotateCcw className="size-3.5" aria-hidden />
                    {t("controls.reset")}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>

          {/* Top-end: view controls. Fullscreen lives here per §11. */}
          <div className="pointer-events-auto fleet-overlay flex h-9 shrink-0 items-center gap-0.5 rounded-lg border px-1 shadow-sm">
            <CanvasIconButton
              label={t("controls.zones")}
              pressed={showZones}
              onClick={() => setShowZones((value) => !value)}
            >
              <Layers className="size-3.5" aria-hidden />
            </CanvasIconButton>
            <CanvasIconButton
              label={t("controls.satellite")}
              pressed={satellite}
              onClick={() => setSatellite((value) => !value)}
            >
              <Satellite className="size-3.5" aria-hidden />
            </CanvasIconButton>
            <CanvasIconButton
              label={fullscreen ? t("controls.exitFullscreen") : t("controls.fullscreen")}
              onClick={toggleFullscreen}
            >
              {fullscreen ? (
                <Minimize2 className="size-3.5" aria-hidden />
              ) : (
                <Maximize2 className="size-3.5" aria-hidden />
              )}
            </CanvasIconButton>
          </div>
        </div>

        {/* Driver rail above the legend (start side); insights above the zoom stack
            (end side). Stacking each panel with its own chrome keeps the clearance exact
            per side instead of one padding sized for the taller of the two. */}
        <div className="relative z-10 flex min-h-0 min-w-0 flex-1 items-stretch justify-between gap-2">
          <div className="flex min-h-0 flex-col gap-2">
            <div className="flex min-h-0 flex-1 items-stretch">
              <FleetRail
                collapsed={railCollapsed}
                onCollapsedChange={(collapsed) => {
                  railUserOverride.current = collapsed;
                  setRailCollapsed(collapsed);
                }}
                onFocusDriver={(driverId) => mapRef.current?.focusDriver(driverId)}
              />
            </div>
            <div className="pointer-events-auto shrink-0">
              <FleetLegend />
            </div>
          </div>

          <div className="flex min-h-0 flex-col items-end gap-2">
            <div className="flex h-full min-h-0 flex-1 items-stretch">
              <FleetInsightsPanel
                collapsed={insightsCollapsed}
                onCollapsedChange={(collapsed) => {
                  insightsUserOverride.current = collapsed;
                  setInsightsCollapsed(collapsed);
                }}
              />
            </div>
            <div className="fleet-overlay pointer-events-auto flex shrink-0 flex-col rounded-lg border p-1 shadow-sm">
              <CanvasIconButton
                label={t("controls.zoomIn")}
                onClick={() => mapRef.current?.zoomIn()}
              >
                <Plus className="size-3.5" aria-hidden />
              </CanvasIconButton>
              <CanvasIconButton
                label={t("controls.zoomOut")}
                onClick={() => mapRef.current?.zoomOut()}
              >
                <Minus className="size-3.5" aria-hidden />
              </CanvasIconButton>
              <CanvasIconButton
                label={t("controls.fitFleet")}
                onClick={() => mapRef.current?.fitFleet()}
              >
                <Crosshair className="size-3.5" aria-hidden />
              </CanvasIconButton>
            </div>
          </div>
        </div>
      </div>

      {selectedDriverId ? (
        // Keyed by driver so selecting another one remounts with a fresh scrubber
        // rather than replaying the previous driver's cursor position.
        <DriverDayRoute
          key={selectedDriverId}
          driverId={selectedDriverId}
          onGeometry={(path, stops) => {
            setRoutePath(path);
            setRouteStops(stops);
          }}
          onPlayhead={setPlayhead}
          onPlaybackStart={handlePlaybackStart}
          onClose={handleRouteClose}
        />
      ) : null}
    </div>
  );
}

function CanvasIconButton({
  label,
  pressed,
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label={label}
            aria-pressed={pressed}
            onClick={onClick}
            className={cn(
              "size-7 transition-colors duration-150",
              pressed && "bg-emerald-100 text-emerald-900 hover:bg-emerald-100",
            )}
          >
            {children}
          </Button>
        }
      />
      <TooltipContent side="left">{label}</TooltipContent>
    </Tooltip>
  );
}
