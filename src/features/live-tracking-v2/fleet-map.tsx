"use client";

/**
 * The WebGL fleet renderer: the existing Google Maps base with a deck.gl overlay on
 * top. DOM markers plus MarkerClusterer cannot hold 60fps at 500 animated pins — that
 * cluster-rebuild cost is the largest frame expense on the v1 page — so every driver,
 * zone, route and stop is drawn in one GPU pass instead.
 *
 * Positions never travel through React. The animation frame reads the interpolator,
 * mutates a stable entity array in place and hands fresh layers to the overlay; React
 * is only involved when the *roster* changes.
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import type { GoogleMapsOverlay } from "@deck.gl/google-maps";
import type { IconLayer, Layer, PathLayer, PolygonLayer, ScatterplotLayer } from "deck.gl";

import { loadGoogleMaps } from "@/lib/google-maps/load";
import { GoogleMapsStatusBanner } from "@/features/restaurants/google-maps-status-banner";
import { cn } from "@/lib/utils";

import { fleetStatusTone, isFleetAlert, type FleetTone } from "./fleet-status";
import {
  FLEET_ICON_SIZE,
  fleetIconAtlasUrl,
  fleetIconMapping,
  fleetPinIcon,
} from "./fleet-marker-atlas";
import { fleetZoneRing } from "./fleet-zones";
import type { FleetTrail } from "./fleet-trail";
import {
  useFleetFrame,
  useFleetSnapshot,
  useFleetStore,
  useFleetTransport,
} from "./use-fleet";
import type { FleetZone } from "./fleet-types";

/** Kuwait City — the same default centre as the existing page, so the two compare. */
const DEFAULT_CENTER = { lat: 29.3759, lng: 47.9774 };
const DEFAULT_ZOOM = 11;
const MIN_ZOOM = 6;
const MAX_ZOOM = 20;

const ZONE_FALLBACK_RGB: [number, number, number] = [99, 102, 241];
/** Coral, the scoped data-layer accent: routes, stops and the playhead — never status. */
const ROUTE_RGB: [number, number, number] = [255, 106, 77];

/**
 * Trails drawn at once, besides the selected rider who is always drawn.
 *
 * A trail is 200 segments where a marker is one quad, so the honest limit here is
 * tesselation cost, not pin count. At a city-wide zoom the tails also overlap into a
 * single unreadable mat, so the cap costs the operator nothing they could have read.
 */
const MAX_TRAILS_DRAWN = 150;

/** How often expired trail points are swept. See `FleetTrailStore.prune`. */
const TRAIL_PRUNE_INTERVAL_MS = 5_000;

export type FleetRouteStop = {
  id: string;
  /** [lng, lat], GeoJSON order, as everything in this feature uses. */
  position: [number, number];
  kind: "pickup" | "delivery" | "stop";
  label: string;
};

export type FleetMapHandle = {
  zoomIn: () => void;
  zoomOut: () => void;
  /** Frames every drawable driver. */
  fitFleet: () => void;
  focusDriver: (driverId: string) => void;
  resize: () => void;
};

type FleetMapProps = {
  className?: string;
  routePath?: [number, number][] | null;
  routeStops?: FleetRouteStop[] | null;
  playheadPosition?: [number, number] | null;
  showZones?: boolean;
  mapTypeId?: "roadmap" | "hybrid";
};

/** One drawable driver. Mutated in place every frame — never re-created. */
type FleetEntity = {
  driverId: string;
  name: string;
  position: [number, number];
  angle: number;
  tone: FleetTone;
  icon: string;
  alert: boolean;
  selected: boolean;
  located: boolean;
};

type LayerClasses = {
  IconLayer: typeof IconLayer;
  PathLayer: typeof PathLayer;
  PolygonLayer: typeof PolygonLayer;
  ScatterplotLayer: typeof ScatterplotLayer;
};

type DeckLayer = Layer;

function hexToRgb(
  hex: string | null,
  fallback: [number, number, number],
): [number, number, number] {
  if (!hex) return fallback;
  const value = hex.trim().replace("#", "");
  const full =
    value.length === 3
      ? value
          .split("")
          .map((char) => char + char)
          .join("")
      : value;
  if (full.length !== 6) return fallback;
  const int = Number.parseInt(full, 16);
  if (Number.isNaN(int)) return fallback;
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export const FleetMap = forwardRef<FleetMapHandle, FleetMapProps>(function FleetMap(
  {
    className,
    routePath = null,
    routeStops = null,
    playheadPosition = null,
    showZones = true,
    mapTypeId = "roadmap",
  },
  ref,
) {
  const t = useTranslations("pages.liveTrackingV2");
  const store = useFleetStore();
  const transport = useFleetTransport();
  const snapshot = useFleetSnapshot();

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const overlayRef = useRef<GoogleMapsOverlay | null>(null);
  const layersRef = useRef<LayerClasses | null>(null);

  const entitiesRef = useRef<FleetEntity[]>([]);
  const entityIndexRef = useRef(new Map<string, FleetEntity>());
  /** Bumped whenever a deck accessor would return something new. */
  const revisionRef = useRef(0);
  const reducedMotionRef = useRef(false);
  const lastTrailPruneRef = useRef(0);

  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">("loading");

  const iconMapping = useMemo(() => fleetIconMapping(), []);
  const iconAtlas = useMemo(() => fleetIconAtlasUrl(), []);
  const selectedDriverId = snapshot.selectedDriverId;

  // ---------------------------------------------------------------------------
  // Roster → drawable entities. Structural changes only, never positions.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const index = entityIndexRef.current;
    const next: FleetEntity[] = [];
    const seen = new Set<string>();

    for (const driverId of snapshot.driverIds) {
      const driver = store.getDriver(driverId);
      if (!driver) continue;
      seen.add(driverId);

      const tone = fleetStatusTone(driver.status);
      const stale = driver.status === "gps_offline" || driver.status === "offline";
      let entity = index.get(driverId);

      if (!entity) {
        entity = {
          driverId,
          name: driver.meta.driverName || driver.meta.driverCode || driverId,
          position: [driver.lng ?? 0, driver.lat ?? 0],
          angle: driver.headingDeg,
          tone,
          icon: fleetPinIcon(tone, stale),
          alert: false,
          selected: false,
          located: driver.lat != null && driver.lng != null,
        };
        index.set(driverId, entity);
      }

      entity.name = driver.meta.driverName || driver.meta.driverCode || driverId;
      entity.tone = tone;
      entity.icon = fleetPinIcon(tone, stale);
      entity.alert = isFleetAlert(driver.status, driver.flags);
      entity.selected = driverId === selectedDriverId;
      if (driver.lat != null && driver.lng != null && !entity.located) {
        entity.position = [driver.lng, driver.lat];
        entity.located = true;
      }
      next.push(entity);
    }

    for (const key of [...index.keys()]) {
      if (!seen.has(key)) index.delete(key);
    }

    entitiesRef.current = next;
    revisionRef.current += 1;
  }, [snapshot.version, snapshot.driverIds, selectedDriverId, store]);

  // ---------------------------------------------------------------------------
  // Map, atlas and deck bootstrap. One dynamic import keeps deck.gl out of the
  // shared bundle, so no other admin page pays for it.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    let idleListener: google.maps.MapsEventListener | null = null;
    let clickListener: google.maps.MapsEventListener | null = null;

    reducedMotionRef.current = prefersReducedMotion();

    async function boot() {
      const [api, overlayModule, layerModule] = await Promise.all([
        loadGoogleMaps(),
        import("@deck.gl/google-maps"),
        import("deck.gl"),
      ]);

      if (cancelled) return;
      if (!api || !containerRef.current) {
        setStatus("unavailable");
        return;
      }

      layersRef.current = {
        IconLayer: layerModule.IconLayer,
        PathLayer: layerModule.PathLayer,
        PolygonLayer: layerModule.PolygonLayer,
        ScatterplotLayer: layerModule.ScatterplotLayer,
      };

      /**
       * The shared loader (`@/lib/google-maps/load`) describes only the surface the
       * existing pages use. This page needs bounds, projection and event plumbing, and
       * deck.gl's overlay is typed against `@types/google.maps` — so the two
       * descriptions of the same runtime object are reconciled once, here.
       */
      const maps = api.maps as unknown as typeof google.maps;
      const mapId = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID?.trim();

      const map = new maps.Map(containerRef.current, {
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
        minZoom: MIN_ZOOM,
        maxZoom: MAX_ZOOM,
        mapTypeId,
        disableDefaultUI: true,
        clickableIcons: false,
        gestureHandling: "greedy",
        // A vector map lets deck.gl share the map's WebGL context instead of
        // compositing a second canvas on top of raster tiles.
        ...(mapId ? { mapId } : {}),
      });

      mapRef.current = map;

      const overlay = new overlayModule.GoogleMapsOverlay({ layers: [] });
      overlay.setMap(map);
      overlayRef.current = overlay;

      // Interest management: the room streams only what is on screen.
      const publishViewport = () => {
        const bounds = map.getBounds();
        if (!bounds) return;
        const ne = bounds.getNorthEast();
        const sw = bounds.getSouthWest();
        transport?.setViewport([sw.lng(), sw.lat(), ne.lng(), ne.lat()]);
      };

      idleListener = map.addListener("idle", publishViewport);
      // Map background click is one of the three required deselect paths (§12).
      clickListener = map.addListener("click", () => store.clearSelection());

      setStatus("ready");
      publishViewport();
    }

    void boot();

    return () => {
      cancelled = true;
      idleListener?.remove();
      clickListener?.remove();
      overlayRef.current?.finalize();
      overlayRef.current = null;
      mapRef.current = null;
    };
    // Mount-only: re-creating the map would drop the WebGL context and the tiles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    mapRef.current?.setMapTypeId(mapTypeId);
  }, [mapTypeId]);

  // ---------------------------------------------------------------------------
  // Layers
  // ---------------------------------------------------------------------------
  const zoneData = useMemo(
    () =>
      snapshot.zones
        .map((zone: FleetZone) => ({
          zone,
          ring: fleetZoneRing(zone),
          rgb: hexToRgb(zone.color, ZONE_FALLBACK_RGB),
        }))
        .filter((entry) => entry.ring.length >= 4),
    [snapshot.zones],
  );

  const buildLayers = useCallback((): DeckLayer[] => {
    const classes = layersRef.current;
    if (!classes) return [];

    const { IconLayer: Icon, PathLayer: Path, PolygonLayer: Polygon, ScatterplotLayer: Scatter } =
      classes;
    const layers: DeckLayer[] = [];
    const revision = revisionRef.current;
    const trailRevision = store.trails.revision;

    if (showZones && zoneData.length > 0) {
      layers.push(
        new Polygon<(typeof zoneData)[number]>({
          id: "fleet-zones",
          data: zoneData,
          pickable: false,
          stroked: true,
          filled: true,
          getPolygon: (d) => d.ring,
          // 56/255 ≈ the 0.22 zone fill opacity the rulebook fixes for zone overlays.
          getFillColor: (d) => [d.rgb[0], d.rgb[1], d.rgb[2], 56],
          getLineColor: (d) => [d.rgb[0], d.rgb[1], d.rgb[2], 200],
          getLineWidth: 2,
          lineWidthUnits: "pixels",
        }),
      );
    }

    if (routePath && routePath.length > 1) {
      layers.push(
        new Path<{ path: [number, number][] }>({
          id: "fleet-route",
          data: [{ path: routePath }],
          getPath: (d) => d.path,
          getColor: [...ROUTE_RGB, 235],
          getWidth: 4,
          widthUnits: "pixels",
          capRounded: true,
          jointRounded: true,
          pickable: false,
        }),
      );
    }

    if (routeStops && routeStops.length > 0) {
      layers.push(
        new Scatter<FleetRouteStop>({
          id: "fleet-route-stops",
          data: routeStops,
          getPosition: (d) => d.position,
          getRadius: (d) => (d.kind === "stop" ? 4 : 6),
          radiusUnits: "pixels",
          stroked: true,
          getLineWidth: 2,
          lineWidthUnits: "pixels",
          getLineColor: [255, 255, 255, 240],
          getFillColor: (d) =>
            d.kind === "delivery"
              ? [16, 185, 129, 240]
              : d.kind === "pickup"
                ? [59, 130, 246, 240]
                : [ROUTE_RGB[0], ROUTE_RGB[1], ROUTE_RGB[2], 220],
          pickable: false,
        }),
      );
    }

    if (playheadPosition) {
      layers.push(
        new Scatter<{ position: [number, number] }>({
          id: "fleet-route-playhead",
          data: [{ position: playheadPosition }],
          getPosition: (d) => d.position,
          getRadius: 9,
          radiusUnits: "pixels",
          stroked: true,
          getLineWidth: 3,
          lineWidthUnits: "pixels",
          getLineColor: [255, 255, 255, 255],
          getFillColor: [...ROUTE_RGB, 255],
        }),
      );
    }

    const drawable = entitiesRef.current.filter((entity) => entity.located);

    // Trails first, so a tail passes under every marker rather than over the rider it
    // belongs to. The entity list is already what the room decided this socket can
    // see, so iterating it *is* the viewport-and-filter restriction.
    const trailData: FleetTrail[] = [];
    let selectedTrail: FleetTrail | null = null;
    for (const entity of drawable) {
      const trail = store.trails.get(entity.driverId);
      // deck.gl needs two points to make a segment.
      if (!trail || trail.coords.length < 4) continue;
      if (entity.selected) {
        selectedTrail = trail;
      } else if (trailData.length < MAX_TRAILS_DRAWN) {
        trailData.push(trail);
      }
    }
    // Pushed last so the followed rider's history sits on top of everyone else's.
    if (selectedTrail) trailData.push(selectedTrail);

    if (trailData.length > 0) {
      layers.push(
        new Path<FleetTrail>({
          id: "fleet-trails",
          data: trailData,
          // Flat `lng, lat` buffers straight from the trail store — no per-point
          // array to allocate on the way to the GPU.
          positionFormat: "XY",
          getPath: (d) => d.coords,
          getColor: (d) => [
            d.color[0],
            d.color[1],
            d.color[2],
            d.driverId === selectedDriverId ? 240 : 130,
          ],
          getWidth: (d) => (d.driverId === selectedDriverId ? 4 : 2.5),
          widthUnits: "pixels",
          widthMinPixels: 1.5,
          capRounded: true,
          jointRounded: true,
          pickable: false,
          updateTriggers: {
            getPath: trailRevision,
            getColor: `${trailRevision}:${selectedDriverId ?? ""}`,
            getWidth: selectedDriverId ?? "",
          },
        }),
      );
    }

    if (drawable.length > 0) {
      const selected = drawable.filter((entity) => entity.selected);
      if (selected.length > 0) {
        layers.push(
          new Icon<FleetEntity>({
            id: "fleet-selection-ring",
            data: selected,
            iconAtlas,
            iconMapping,
            getIcon: () => "ring",
            getPosition: (d) => d.position,
            getSize: FLEET_ICON_SIZE.height,
            sizeUnits: "pixels",
            updateTriggers: { getPosition: revision },
            pickable: false,
          }),
        );
      }

      layers.push(
        new Icon<FleetEntity>({
          id: "fleet-drivers",
          data: drawable,
          iconAtlas,
          iconMapping,
          getIcon: (d) => d.icon,
          getPosition: (d) => d.position,
          getSize: (d) =>
            d.selected ? FLEET_ICON_SIZE.height * 1.15 : FLEET_ICON_SIZE.height,
          sizeUnits: "pixels",
          // The marker is a vehicle now, so the bearing rotates the sprite itself
          // rather than a chevron beside it. deck.gl rotates counter-clockwise;
          // compass bearings run clockwise. The store holds the last known bearing
          // when a fix carries none, so a stopped bike keeps facing the way it was
          // travelling instead of snapping north.
          getAngle: (d) => -d.angle,
          updateTriggers: {
            getPosition: revision,
            getIcon: revision,
            getSize: revision,
            getAngle: revision,
          },
          pickable: true,
          onClick: (info) => {
            if (info.object) store.selectDriver(info.object.driverId);
            return true;
          },
        }),
      );
    }

    return layers;
  }, [
    iconAtlas,
    iconMapping,
    playheadPosition,
    routePath,
    routeStops,
    selectedDriverId,
    showZones,
    store,
    zoneData,
  ]);

  // ---------------------------------------------------------------------------
  // Animation frame: interpolate, then hand the layers over.
  // ---------------------------------------------------------------------------
  useFleetFrame(
    useCallback(
      (serverNowMs: number) => {
        const overlay = overlayRef.current;
        if (!overlay || !layersRef.current) return;

        const interpolator = store.interpolator;
        const reduced = reducedMotionRef.current;
        let moved = false;

        // Sweeping here rather than on a timer keeps the trail store free of its own
        // scheduler, and a driver who stopped reporting still has their tail expire.
        if (serverNowMs - lastTrailPruneRef.current >= TRAIL_PRUNE_INTERVAL_MS) {
          lastTrailPruneRef.current = serverNowMs;
          store.trails.prune(serverNowMs);
        }

        for (const entity of entitiesRef.current) {
          const sample = reduced
            ? interpolator.latest(entity.driverId)
            : interpolator.sample(entity.driverId, serverNowMs);
          if (!sample) continue;

          if (entity.position[0] !== sample.lng || entity.position[1] !== sample.lat) {
            entity.position = [sample.lng, sample.lat];
            moved = true;
          }
          if (entity.angle !== sample.headingDeg) {
            entity.angle = sample.headingDeg;
            moved = true;
          }
          if (!entity.located) {
            entity.located = true;
            moved = true;
          }
        }

        if (moved) revisionRef.current += 1;
        overlay.setProps({ layers: buildLayers() });
      },
      [buildLayers, store],
    ),
  );

  // ---------------------------------------------------------------------------
  // Imperative controls for the canvas chrome
  // ---------------------------------------------------------------------------
  useImperativeHandle(
    ref,
    () => ({
      zoomIn: () => {
        const map = mapRef.current;
        if (map) map.setZoom(Math.min((map.getZoom() ?? DEFAULT_ZOOM) + 1, MAX_ZOOM));
      },
      zoomOut: () => {
        const map = mapRef.current;
        if (map) map.setZoom(Math.max((map.getZoom() ?? DEFAULT_ZOOM) - 1, MIN_ZOOM));
      },
      fitFleet: () => {
        const map = mapRef.current;
        if (!map) return;
        const located = entitiesRef.current.filter((entity) => entity.located);
        if (located.length === 0) return;
        const bounds = new google.maps.LatLngBounds();
        for (const entity of located) {
          bounds.extend({ lat: entity.position[1], lng: entity.position[0] });
        }
        map.fitBounds(bounds, 64);
      },
      focusDriver: (driverId: string) => {
        const map = mapRef.current;
        const entity = entityIndexRef.current.get(driverId);
        if (!map || !entity?.located) return;
        map.panTo({ lat: entity.position[1], lng: entity.position[0] });
        if ((map.getZoom() ?? 0) < 14) map.setZoom(14);
      },
      resize: () => {
        const map = mapRef.current;
        if (map) google.maps.event.trigger(map, "resize");
      },
    }),
    [],
  );

  return (
    <div className={cn("relative h-full w-full overflow-hidden", className)}>
      <div ref={containerRef} className="h-full w-full" aria-label={t("map.label")} />

      {status === "loading" ? (
        <div className="pointer-events-none absolute inset-0 grid place-items-center bg-background/60">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : null}

      {status === "unavailable" ? (
        <div className="absolute inset-x-3 top-3">
          <GoogleMapsStatusBanner />
        </div>
      ) : null}
    </div>
  );
});
