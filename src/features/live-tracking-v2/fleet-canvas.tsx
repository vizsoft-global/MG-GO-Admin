"use client";

/**
 * Shift attendance on the live map.
 *
 * The page is one full-bleed map. The glass overlay (filters, duty chips, driver rail,
 * legend, insights) always floats on that map. Fullscreen is the Fullscreen API on
 * `shellRef`, the same element the overlay already sits in.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { readSelectedDriverId, writeSelectedDriverId } from "@/lib/browser/tracking-selection";
import { fetchRosterLive } from "@/features/roster/roster-actions";

import { FleetMap, type FleetMapHandle, type FleetRouteStop } from "./fleet-map";
import { FleetRail } from "./fleet-rail";
import { FleetInsightsPanel } from "./fleet-insights-panel";
import { FleetDriverDetails } from "./fleet-driver-details";
import { FleetLegend } from "./fleet-legend";
import { FleetConnectionPill } from "./fleet-connection-pill";
import { DriverDayRoute } from "./driver-day-route";
import { FleetStatusFilter } from "./fleet-status-filter";
import { routeGeometryPositions, type FleetRouteGeometry } from "./fleet-route";
import { type FleetStatus } from "./fleet-status";
import { toggleFleetAlertsOnly, toggleFleetStatusChip } from "./fleet-types";
import { useFleetSnapshot, useFleetStore } from "./use-fleet";

import "./fleet-theme.css";

export function FleetCanvas() {
  const t = useTranslations("pages.liveTrackingV2");
  const rosterT = useTranslations("pages.roster");
  const store = useFleetStore();
  const snapshot = useFleetSnapshot();
  const [rosterRestaurant, setRosterRestaurant] = useState<string | null>(null);
  const [rosterDuty, setRosterDuty] = useState<string | null>(null);
  const [rosterCompany, setRosterCompany] = useState<string | null>(null);
  const rosterQuery = useQuery({
    queryKey: ["roster", "live"],
    queryFn: () => fetchRosterLive(),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
  useEffect(() => {
    const data = rosterQuery.data;
    if (!data || !("restricted" in data)) return;
    store.setRosterScope({ restricted: data.restricted, drivers: data.drivers });
  }, [rosterQuery.data, store]);
  useEffect(() => {
    store.setRosterFilters({
      restaurantId: rosterRestaurant,
      duty: rosterDuty,
      company: rosterCompany,
    });
  }, [rosterRestaurant, rosterDuty, rosterCompany, store]);

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
  const filtersUserOverride = useRef<boolean | null>(null);
  const [routeGeometry, setRouteGeometry] = useState<FleetRouteGeometry | null>(null);
  const [routeStops, setRouteStops] = useState<FleetRouteStop[] | null>(null);
  const [playhead, setPlayhead] = useState<[number, number] | null>(null);
  const [showInsightsWhileSelected, setShowInsightsWhileSelected] = useState(false);

  const { filters, selectedDriverId } = snapshot;

  useEffect(() => {
    setShowInsightsWhileSelected(false);
  }, [selectedDriverId]);

  /*
   * QA #49: the rider that was open when the operator followed a card to the driver detail page.
   *
   * Read from the URL once, at mount, before the write effect below can clear it — the two would
   * otherwise race over the same parameter. Waiting for the rider to exist is what makes this
   * survive a cold load: `getDriver` is null until the room's first snapshot (or the polling
   * rail's) has landed, so the effect re-runs as the fleet streams in and restores on the pass
   * where the rider is finally there.
   */
  const requestedDriverRef = useRef<string | null | undefined>(undefined);
  const restoredDriverRef = useRef(false);
  useEffect(() => {
    if (restoredDriverRef.current) return;
    if (requestedDriverRef.current === undefined) {
      requestedDriverRef.current = readSelectedDriverId();
    }
    const requested = requestedDriverRef.current;
    if (!requested) return;
    if (!store.getDriver(requested)) return;
    restoredDriverRef.current = true;
    // `selectDriver` toggles, so the guard is what makes a restore idempotent.
    if (snapshot.selectedDriverId !== requested) store.selectDriver(requested);
  }, [snapshot, store]);

  /*
   * The write half. The first run is skipped on purpose: at mount the URL is the *source* of the
   * selection, and replacing it there would delete the rider the effect above is about to
   * restore. Every later change is a real selection or a real deselect.
   */
  const selectionWrittenRef = useRef(false);
  useEffect(() => {
    if (!selectionWrittenRef.current) {
      selectionWrittenRef.current = true;
      return;
    }
    writeSelectedDriverId(selectedDriverId);
  }, [selectedDriverId]);

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
  //
  // The filter controls share the title bar, and their floors plus the view-control
  // cluster need ~1000px; below that they are hidden by the same rule rather than
  // wrapping the bar over the map. Force them open on a narrower canvas and the bar
  // wraps — a second row the operator asked for is not the defect a second row they
  // did not ask for was.
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
      if (filtersUserOverride.current == null) {
        setShowFilters(width >= 1000);
      } else if (width >= 1000) {
        filtersUserOverride.current = null;
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

  useEffect(() => {
    const id = requestAnimationFrame(() => mapRef.current?.resize());
    return () => cancelAnimationFrame(id);
  }, [fullscreen]);

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

  const filtersDirty =
    filters.search !== "" ||
    filters.statuses !== null ||
    filters.zoneId !== null ||
    filters.partnerId !== null ||
    filters.alertsOnly ||
    rosterRestaurant !== null ||
    rosterDuty !== null ||
    rosterCompany !== null;

  const clearFilters = useCallback(() => {
    store.resetFilters();
    setRosterRestaurant(null);
    setRosterDuty(null);
    setRosterCompany(null);
  }, [store]);

  const live = useMemo(() => {
    const data = rosterQuery.data;
    if (
      !data ||
      !("drivers" in data) ||
      !("restaurants" in data) ||
      !Array.isArray(data.drivers) ||
      !Array.isArray(data.restaurants)
    ) {
      return null;
    }
    return data;
  }, [rosterQuery.data]);

  const restaurantDrivers = useMemo(() => {
    const drivers = live?.drivers ?? [];
    return drivers.filter((driver) => {
      if (rosterRestaurant && driver.restaurantId !== rosterRestaurant) return false;
      if (rosterCompany && driver.company !== rosterCompany) return false;
      return true;
    });
  }, [live, rosterRestaurant, rosterCompany]);

  const places = useMemo(() => {
    const pins = [];
    for (const row of live?.restaurants ?? []) {
      if (row.lat == null || row.lng == null) continue;
      if (!Number.isFinite(row.lat) || !Number.isFinite(row.lng)) continue;
      pins.push({ id: row.id, name: row.name, lat: row.lat, lng: row.lng });
    }
    return pins;
  }, [live]);

  const restaurantOptions = useMemo(
    () => [
      { value: "all", label: rosterT("allRestaurants"), keywords: ["all", "restaurants"] },
      ...(live?.restaurants ?? []).map((row) => ({
        value: row.id,
        label: row.name,
        keywords: [row.name],
      })),
    ],
    [live, rosterT],
  );

  const companyOptions = useMemo(() => {
    const names = companyNames(live);
    return [
      { value: "all", label: rosterT("allCompanies"), keywords: ["all", "companies"] },
      ...names.map((name) => ({
        value: name,
        label: name,
        keywords: [name],
      })),
    ];
  }, [live, rosterT]);

  const dutyOptions = useMemo(
    () => [
      { value: "all", label: rosterT("allStatuses"), keywords: ["all", "statuses"] },
      ...SCHEDULE_DUTIES.map((key) => {
        const label = scheduleDutyLabel(rosterT, key);
        return { value: key, label, keywords: [label, key] };
      }),
    ],
    [rosterT],
  );

  /*
   * The strip's X is a deselect, not just a "hide the route".
   *
   * Clearing the geometry alone left `selectedDriverId` set, so the strip remounted on the
   * next render and the close button appeared to do nothing. It is also the third deselect
   * path the rulebook requires alongside the map background and a same-marker click.
   */
  const handleRouteClose = useCallback(() => {
    setRouteGeometry(null);
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
    const positions = routeGeometryPositions(routeGeometry);
    if (positions.length > 1) mapRef.current?.fitPath(positions);
  }, [routeGeometry]);

  return (
    <div
      ref={shellRef}
      className={cn(
        "fleet-canvas relative h-[calc(100dvh-1.5rem)] min-h-[520px] w-full overflow-hidden",
        fullscreen && "h-full w-full",
      )}
    >
      <div className="fleet-map-surface absolute inset-0">
        <FleetMap
          ref={mapRef}
          places={places}
          routeGeometry={routeGeometry}
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
        the filter controls sat in a second card beneath it. In flow a taller top bar
        pushes the rail down instead of being covered by it, and there are no magic
        numbers left to keep in sync.

        Logical properties throughout, so the whole canvas mirrors under RTL without a
        second layout.
      */}
      <div className="pointer-events-none absolute inset-3 z-20 flex flex-col gap-2">
        <div className="relative z-30 flex shrink-0 items-center justify-between gap-2">
          {/*
            Identity and filters share one card. Two stacked cards cost ~100px of map at
            the top edge for one row of controls, on a surface where the map is the
            instrument — and the second card was the thing pushing the driver rail down.
            The reserve on the end is the three view controls plus the row gap.

            The controls share the width and truncate rather than the search box absorbing
            whatever the fixed-width selects leave over: on a narrow canvas that remainder
            is a few pixels, so the box collapses to its own border and the row reads as
            broken. `min-h-9` keeps the collapsed bar exactly the height it was before the
            filters moved into it. Identity and filters are two groups rather than ten
            loose children so that the only place the bar can ever break is between them —
            a wrapped title with its toggle marooned on the next line is worse than the
            stacked cards this replaces.
          */}
          <div className="pointer-events-auto fleet-overlay flex min-h-9 min-w-0 max-w-[calc(100%-7rem)] flex-wrap items-center gap-2 rounded-lg border px-2 py-1 shadow-sm">
            <div className="flex shrink-0 items-center gap-2">
              <Satellite className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="whitespace-nowrap text-sm font-semibold">{t("title")}</span>
              {/* Decoration, and it competes with the filters for the row now: at 1280 it
                  is the 120px that pushes the partner select past the bar's edge. It
                  appears only where there is width to spare for it. */}
              <span className="hidden whitespace-nowrap text-xs text-muted-foreground 2xl:inline">
                {t("subtitle")}
              </span>
              {/* Which rail the map is actually on is never the thing that gives way to a
                  filter control — a stale map read as a stopped fleet is the failure this
                  pill exists to prevent. */}
              <FleetConnectionPill className="shrink-0" />
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-7 shrink-0"
                aria-pressed={showFilters}
                aria-label={t("filters.statuses")}
                onClick={() =>
                  setShowFilters((open) => {
                    filtersUserOverride.current = !open;
                    return !open;
                  })
                }
              >
                <SlidersHorizontal className="size-3.5" aria-hidden />
              </Button>
            </div>

            {/* The group's basis is wide enough that it moves to its own line rather than
                overflowing the card: as a `flex-1` child it always "fits" by definition and
                would spill its controls over the view cluster instead of wrapping. */}
            {showFilters ? (
              <div className="flex min-w-[300px] flex-[1_1_420px] flex-col gap-2">
                <div className="grid w-full grid-cols-2 items-center gap-2 xl:grid-cols-4">
                  <Input
                    value={filters.search}
                    onChange={(event) => store.setFilters({ search: event.target.value })}
                    placeholder={t("filters.search")}
                    title={t("filters.search")}
                    className="h-9 min-w-[180px] flex-[1.4_1_220px]"
                    aria-label={t("filters.search")}
                  />

                  <FleetStatusFilter
                    filters={filters}
                    onToggleStatus={toggleStatus}
                    onToggleAlertsOnly={toggleAlertsOnly}
                    onSetStatuses={(statuses) =>
                      store.setFilters({ statuses, alertsOnly: false })
                    }
                    className="min-w-[88px] flex-[0_1_140px]"
                  />

                  <SearchSelect
                    items={zoneOptions}
                    value={filters.zoneId ?? "all"}
                    onChange={(value) =>
                      store.setFilters({ zoneId: !value || value === "all" ? null : value })
                    }
                    className="h-9"
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
                    className="h-9"
                    placeholder={t("filters.allPartners")}
                    searchPlaceholder={t("filters.searchPartner")}
                    recentsKey="fleet-v2-partner"
                    clearable={false}
                  />

                  <SearchSelect
                    items={restaurantOptions}
                    value={rosterRestaurant ?? "all"}
                    onChange={(value) => setRosterRestaurant(!value || value === "all" ? null : value)}
                    className="h-9"
                    placeholder={rosterT("allRestaurants")}
                    searchPlaceholder={rosterT("restaurant")}
                    recentsKey="fleet-v2-roster-restaurant"
                    clearable={false}
                  />

                  <SearchSelect
                    items={companyOptions}
                    value={rosterCompany ?? "all"}
                    onChange={(value) => setRosterCompany(!value || value === "all" ? null : value)}
                    className="h-9"
                    placeholder={rosterT("allCompanies")}
                    searchPlaceholder={rosterT("company")}
                    recentsKey="fleet-v2-roster-company"
                    clearable={false}
                  />

                  <SearchSelect
                    items={dutyOptions}
                    value={rosterDuty ?? "all"}
                    onChange={(value) => setRosterDuty(!value || value === "all" ? null : value)}
                    className="h-9"
                    placeholder={rosterT("allStatuses")}
                    searchPlaceholder={rosterT("status")}
                    recentsKey="fleet-v2-roster-duty"
                    clearable={false}
                  />

                  {filtersDirty ? (
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="size-9 shrink-0"
                      aria-label={t("controls.reset")}
                      title={t("controls.reset")}
                      onClick={clearFilters}
                    >
                      <RotateCcw className="size-3.5" aria-hidden />
                    </Button>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {DUTY_CHIPS.map((chip) => {
                    const selected = chip === "all" ? rosterDuty == null : rosterDuty === chip;
                    return (
                      <button
                        key={chip}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => setRosterDuty(chip === "all" ? null : chip)}
                        className={cn(
                          "inline-flex h-9 items-center gap-1.5 rounded-full px-2.5 text-xs",
                          selected
                            ? cn("font-semibold", chipSelectedClass(chip))
                            : "border border-[#E2DCD8] bg-white text-[#3D3734]",
                        )}
                      >
                        <span className={cn("size-1.5 rounded-full", chipDotClass(chip, selected))} aria-hidden />
                        {chipLabel(rosterT, chip)}
                        <span className="tabular-nums">{dutyCount(restaurantDrivers, chip)}</span>
                      </button>
                    );
                  })}
                </div>
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
            <div
              className={cn(
                "flex min-h-0",
                railCollapsed ? "shrink-0 items-start" : "flex-1 items-stretch",
              )}
            >
              <FleetRail
                collapsed={railCollapsed}
                onCollapsedChange={(collapsed) => {
                  railUserOverride.current = collapsed;
                  setRailCollapsed(collapsed);
                }}
                onFocusDriver={(driverId) => mapRef.current?.focusDriver(driverId)}
                onReselectDriver={() => setShowInsightsWhileSelected(false)}
              />
            </div>
            <div className="pointer-events-auto shrink-0">
              <FleetLegend />
            </div>
          </div>

          <div className="flex min-h-0 flex-col items-end gap-2">
            <div
              className={cn(
                "flex min-h-0",
                insightsCollapsed
                  ? "shrink-0 items-start"
                  : "h-full flex-1 items-stretch",
              )}
            >
              {selectedDriverId && !showInsightsWhileSelected ? (
                <FleetDriverDetails
                  driverId={selectedDriverId}
                  collapsed={insightsCollapsed}
                  onCollapsedChange={(collapsed) => {
                    insightsUserOverride.current = collapsed;
                    setInsightsCollapsed(collapsed);
                  }}
                  onBack={() => setShowInsightsWhileSelected(true)}
                />
              ) : (
                <FleetInsightsPanel
                  collapsed={insightsCollapsed}
                  onCollapsedChange={(collapsed) => {
                    insightsUserOverride.current = collapsed;
                    setInsightsCollapsed(collapsed);
                  }}
                />
              )}
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
          onGeometry={(geometry, stops) => {
            setRouteGeometry(geometry);
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

const DUTY_CHIPS = ["all", "on_shift", "late", "not_logged_in", "logged_out_early", "off"] as const;

type DutyChip = (typeof DUTY_CHIPS)[number];

type RosterCopy = ReturnType<typeof useTranslations<"pages.roster">>;

const SCHEDULE_DUTIES = [
  "early_drop",
  "on_shift",
  "late",
  "not_logged_in",
  "logged_out_early",
  "off",
] as const;

type ScheduleDuty = (typeof SCHEDULE_DUTIES)[number];

function scheduleDutyLabel(t: RosterCopy, key: ScheduleDuty): string {
  switch (key) {
    case "early_drop":
      return t("statuses.early_drop");
    case "on_shift":
      return t("statuses.on_shift");
    case "late":
      return t("statuses.late");
    case "not_logged_in":
      return t("statuses.not_logged_in");
    case "logged_out_early":
      return t("statuses.logged_out_early");
    case "off":
      return t("statuses.off");
    default: {
      const unknown: never = key;
      return unknown;
    }
  }
}

function companyNames(live: { companies?: unknown } | null): string[] {
  if (!live || !Array.isArray(live.companies)) return [];
  const names: string[] = [];
  for (const name of live.companies) {
    if (typeof name === "string" && name.length > 0) names.push(name);
  }
  return names;
}

function chipLabel(t: RosterCopy, chip: DutyChip): string {
  switch (chip) {
    case "all":
      return t("all");
    case "on_shift":
      return t("statuses.on_shift");
    case "late":
      return t("statuses.late");
    case "not_logged_in":
      return t("statuses.not_logged_in");
    case "logged_out_early":
      return t("statuses.logged_out_early");
    case "off":
      return t("statuses.off");
    default: {
      const unknown: never = chip;
      return unknown;
    }
  }
}

function chipSelectedClass(chip: DutyChip): string {
  switch (chip) {
    case "all":
      return "bg-[#1D1B1A] text-white";
    case "on_shift":
      return "bg-[#E7F6EE] text-[#146C43]";
    case "late":
      return "bg-[#FDF0DC] text-[#8A4B06]";
    case "not_logged_in":
      return "bg-[#FDE7E5] text-[#A3221A]";
    case "logged_out_early":
      return "bg-[#EEE8FB] text-[#5B34A8]";
    case "off":
      return "bg-[#F3F0EE] text-[#3D3734]";
    default: {
      const unknown: never = chip;
      return unknown;
    }
  }
}

function chipDotClass(chip: DutyChip, selected: boolean): string {
  switch (chip) {
    case "all":
      return selected ? "bg-white" : "bg-[#1D1B1A]";
    case "on_shift":
      return "bg-[#146C43]";
    case "late":
      return "bg-[#8A4B06]";
    case "not_logged_in":
      return "bg-[#A3221A]";
    case "logged_out_early":
      return "bg-[#5B34A8]";
    case "off":
      return "bg-[#3D3734]";
    default: {
      const unknown: never = chip;
      return unknown;
    }
  }
}

function dutyCount(drivers: { status: string }[], chip: DutyChip): number {
  if (chip === "all") return drivers.length;
  let count = 0;
  for (const driver of drivers) {
    if (driver.status === chip) count += 1;
  }
  return count;
}

