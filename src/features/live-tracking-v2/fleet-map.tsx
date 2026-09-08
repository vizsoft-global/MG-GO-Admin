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
import type { PathStyleExtension, PathStyleExtensionProps } from "@deck.gl/extensions";
import type {
  IconLayer,
  IconLayerProps,
  Layer,
  PathLayer,
  PolygonLayer,
  ScatterplotLayer,
} from "deck.gl";

import { loadGoogleMaps } from "@/lib/google-maps/load";
import { GoogleMapsStatusBanner } from "@/features/restaurants/google-maps-status-banner";
import { cn } from "@/lib/utils";

import { fleetMarkerTone, isFleetAlert, type FleetTone } from "./fleet-status";
import {
  FLEET_ICON_SIZE,
  fleetIconMapping,
  fleetPinIcon,
  loadFleetIconAtlas,
  type FleetIconAtlas,
} from "./fleet-marker-atlas";
import {
  FLEET_FIT_PADDING_PX,
  needsRecentre,
  pathBounds,
  type FleetBounds,
} from "./fleet-camera";
import { FleetPulseTracker, pulseEligible, pulseRing, selectPulseDrivers } from "./fleet-pulse";
import type { FleetRouteGeometry } from "./fleet-route";
import { fleetZoneRing } from "./fleet-zones";
import { trailSpanMeters, type FleetTrail } from "./fleet-trail";
import { buildZoneMapStyles } from "@/features/zones/zone-map-google-styles";
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
/** Street-level zoom when an operator clicks a driver. Matches v1's focus zoom. */
const DRIVER_FOCUS_ZOOM = 16;
/**
 * Zoom floor: a whole-world view.
 *
 * This was 6 — roughly the Gulf — on the reasoning that a fleet in Kuwait is never
 * legible from further out. But an operator zooms out to *orient*, not to read pins, and
 * a map that stops responding to the gesture reads as broken rather than as a limit. V1
 * sets no floor at all, and interest management already keeps a wide viewport cheap: the
 * room culls to what a socket can see and the trail cap holds tesselation flat.
 */
const MIN_ZOOM = 3;
const MAX_ZOOM = 20;

const ZONE_FALLBACK_RGB: [number, number, number] = [99, 102, 241];
/** Coral, the scoped data-layer accent: routes, stops and the playhead — never status. */
const ROUTE_RGB: [number, number, number] = [255, 106, 77];
/**
 * Slate, for the connectors across an unobserved gap.
 *
 * Deliberately the one piece of route furniture with no accent: the coral line is a claim
 * that the rider went that way, and these are the places where nothing is being claimed.
 * Dashed as well as grey because at a city zoom a thin grey line and a thin coral one are
 * the same line, and this distinction has to survive the squint test.
 */
const ROUTE_GAP_RGB: [number, number, number] = [100, 116, 139];

const TONE_RGB: Record<FleetTone, [number, number, number]> = {
  success: [16, 185, 129],
  primary: [59, 130, 246],
  warning: [245, 158, 11],
  danger: [244, 63, 94],
  neutral: [100, 116, 139],
};

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

/**
 * Below this bounding-box diagonal a trail is not drawn at all.
 *
 * 25m is roughly the width of a marker at street zoom and about twice the drift a
 * stationary phone produces, so it separates "parked" from "moved a little" without
 * hiding a rider who crept up a queue. See `trailSpanMeters` for why the points exist.
 */
const MIN_TRAIL_SPAN_M = 25;

/**
 * How often the camera is allowed to check whether the followed rider has drifted out of
 * view. `map.getBounds()` allocates, and a rider crossing the edge of the screen is not a
 * per-frame event — half a second is well inside the time it takes to notice.
 */
const FOLLOW_CHECK_INTERVAL_MS = 500;

/**
 * `IconLayer.iconAtlas` is typed `string | Texture`, but its runtime contract is wider
 * than that type: it is declared `{type: 'image'}`, and deck's image prop transform
 * (`createTexture` in `@deck.gl/core`) wraps any browser image source as `{data}` before
 * calling `device.createTexture`. A decoded bitmap is therefore a supported value, and
 * the one we want — see `loadFleetIconAtlas` for why the URL form is not.
 *
 * The cast is confined to this one function so the gap is stated once rather than
 * asserted at each call site.
 */
function asIconAtlasProp(image: FleetIconAtlas): IconLayerProps["iconAtlas"] {
  return image as unknown as IconLayerProps["iconAtlas"];
}

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
  /** Pan + street-zoom to a driver. Returns false when the pin is not yet located. */
  focusDriver: (driverId: string) => boolean;
  /**
   * Frames a day route and hands the camera back to the follower.
   *
   * Called when playback starts rather than when the route loads: selecting a rider
   * street-zooms to them, and framing the whole day on top of that would move the camera
   * twice for one click — the second move undoing the first.
   */
  fitPath: (path: readonly [number, number][]) => boolean;
  resize: () => void;
};

type FleetMapProps = {
  className?: string;
  routeGeometry?: FleetRouteGeometry | null;
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
  /** Whether this driver's status permits a pulse ring. See `pulseEligible`. */
  pulses: boolean;
};

type LayerClasses = {
  IconLayer: typeof IconLayer;
  PathLayer: typeof PathLayer;
  PolygonLayer: typeof PolygonLayer;
  ScatterplotLayer: typeof ScatterplotLayer;
  /** Screen-space dashes for the gap connectors. See `ROUTE_GAP_RGB`. */
  PathStyleExtension: typeof PathStyleExtension;
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

/** The map's viewport in this feature's plain-object form, or null before first layout. */
function mapBounds(map: google.maps.Map): FleetBounds | null {
  const bounds = map.getBounds();
  if (!bounds) return null;
  const ne = bounds.getNorthEast();
  const sw = bounds.getSouthWest();
  return { west: sw.lng(), south: sw.lat(), east: ne.lng(), north: ne.lat() };
}

export const FleetMap = forwardRef<FleetMapHandle, FleetMapProps>(function FleetMap(
  {
    className,
    routeGeometry = null,
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

  /** Ring starts, keyed on fix timestamps rather than arrival. See `FleetPulseTracker`. */
  const pulseTrackerRef = useRef(new FleetPulseTracker());
  /** The capped ring roster, recomputed when statuses or the selection change. */
  const pulseIdsRef = useRef<string[]>([]);
  /** Server clock of the frame being drawn, so `buildLayers` can age the rings. */
  const frameNowRef = useRef(0);

  /**
   * Whether the camera may still move itself.
   *
   * Cleared by a user drag, restored by selecting a driver or pressing focus. An operator
   * who has dragged the map is looking at something, and a camera that pulls back to the
   * selected rider a second later is unusable.
   */
  const cameraFollowRef = useRef(false);
  const lastFollowCheckRef = useRef(0);
  /** Route playback owns the camera while it is running — the playhead, not the live pin. */
  const playbackFollowRef = useRef(false);
  /**
   * Pin picks fire both deck.gl `onClick` and the Google Maps `click` we use to
   * deselect on background. The Google event must not undo the pick.
   */
  const pickHandledRef = useRef(false);

  const didFitRef = useRef(false);
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">("loading");

  const iconMapping = useMemo(() => fleetIconMapping(), []);
  const [iconAtlas, setIconAtlas] = useState<FleetIconAtlas | null>(null);
  const selectedDriverId = snapshot.selectedDriverId;

  /**
   * The selection as the frame loop sees it. The loop is a stable callback that must not
   * be rebuilt every time the operator clicks a driver, so it reads the id from a ref
   * rather than closing over it.
   */
  const selectedDriverIdRef = useRef<string | null>(selectedDriverId);

  /*
   * Selecting a driver hands the camera back to the follower, and deselecting takes it
   * away again — otherwise the map would keep chasing whoever was last selected.
   */
  useEffect(() => {
    selectedDriverIdRef.current = selectedDriverId;
    cameraFollowRef.current = selectedDriverId != null;
    lastFollowCheckRef.current = 0;
    if (!selectedDriverId) playbackFollowRef.current = false;
  }, [selectedDriverId]);

  useEffect(() => {
    let cancelled = false;
    void loadFleetIconAtlas()
      .then((atlas) => {
        if (!cancelled) setIconAtlas(atlas);
      })
      .catch((error: unknown) => {
        // The map stays usable on status pucks alone, so this must not throw — but a
        // silent failure here is indistinguishable from a working map with plain discs,
        // which is exactly the confusion that cost two release cycles.
        console.error("live-tracking-v2: marker atlas failed to load", error);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Roster → drawable entities. Structural changes only, never positions.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const index = entityIndexRef.current;
    const next: FleetEntity[] = [];
    const seen = new Set<string>();
    const pulseCandidates: string[] = [];

    for (const driverId of snapshot.driverIds) {
      const driver = store.getDriver(driverId);
      if (!driver) continue;
      seen.add(driverId);

      const tone = fleetMarkerTone(driver.status, driver.flags);
      const stale = driver.status === "gps_offline" || driver.status === "offline";
      const selected = driverId === selectedDriverId;
      let entity = index.get(driverId);

      if (!entity) {
        entity = {
          driverId,
          name: driver.meta.driverName || driver.meta.driverCode || driverId,
          position: [driver.lng ?? 0, driver.lat ?? 0],
          angle: driver.headingDeg,
          tone,
          icon: fleetPinIcon(tone, stale, driver.meta.vehicleTypeKey),
          alert: false,
          selected: false,
          located: driver.lat != null && driver.lng != null,
          pulses: false,
        };
        index.set(driverId, entity);
      }

      entity.name = driver.meta.driverName || driver.meta.driverCode || driverId;
      entity.tone = tone;
      entity.icon = fleetPinIcon(tone, stale, driver.meta.vehicleTypeKey);
      entity.alert = isFleetAlert(driver.status, driver.flags);
      entity.selected = selected;
      entity.pulses = pulseEligible(driver.status, selected);
      if (driver.lat != null && driver.lng != null && !entity.located) {
        entity.position = [driver.lng, driver.lat];
        entity.located = true;
      }
      if (entity.pulses) pulseCandidates.push(driverId);
      next.push(entity);
    }

    for (const key of [...index.keys()]) {
      if (!seen.has(key)) {
        index.delete(key);
        pulseTrackerRef.current.forget(key);
      }
    }

    // Capped here rather than per frame: eligibility only changes when a status or the
    // selection does, and both of those arrive through this snapshot. The roster is
    // already sorted by status severity, so the cap keeps the drivers worth watching.
    pulseIdsRef.current = selectPulseDrivers(pulseCandidates, selectedDriverId);

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
    let dragListener: google.maps.MapsEventListener | null = null;

    reducedMotionRef.current = prefersReducedMotion();

    async function boot() {
      const [api, overlayModule, layerModule, extensionModule] = await Promise.all([
        loadGoogleMaps(),
        import("@deck.gl/google-maps"),
        import("deck.gl"),
        // Not re-exported by the `deck.gl` umbrella, so it is its own chunk.
        import("@deck.gl/extensions"),
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
        PathStyleExtension: extensionModule.PathStyleExtension,
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
        // Place, road and POI names compete with the pins on a fleet map, so
        // the basemap carries geometry only. JSON styles are honoured by the
        // raster basemap; a cloud-styled vector map (`mapId`) ignores them and
        // must hide labels in its own cloud style.
        styles: buildZoneMapStyles(true),
        // A vector map lets deck.gl share the map's WebGL context instead of
        // compositing a second canvas on top of raster tiles.
        ...(mapId ? { mapId } : {}),
      });

      mapRef.current = map;

      const overlay = new overlayModule.GoogleMapsOverlay({
        layers: [],
        // Vector maps (mapId) draw into the map's GL context. Without this the
        // overlay can land *under* the basemap and every pin is invisible.
        interleaved: Boolean(mapId),
      });
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
      clickListener = map.addListener("click", () => {
        if (pickHandledRef.current) {
          pickHandledRef.current = false;
          return;
        }
        store.clearSelection();
      });
      /*
       * A drag hands the camera to the operator.
       *
       * `dragstart` rather than `center_changed`, because the latter also fires for the
       * camera's own moves — a follower that reads its own pan as a user gesture would
       * switch itself off the first time it worked.
       */
      dragListener = map.addListener("dragstart", () => {
        cameraFollowRef.current = false;
      });

      setStatus("ready");
      publishViewport();
    }

    void boot();

    return () => {
      cancelled = true;
      idleListener?.remove();
      clickListener?.remove();
      dragListener?.remove();
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

  /*
   * Playback follow: the camera tracks the playhead, not the live pin.
   *
   * `setCenter`, not `panTo`. At 64x the scrubber advances every 100ms, and stacked pan
   * animations rubber-band — each one is still easing towards a target the next one has
   * already replaced. A scrubber is a direct manipulation, so the camera should land where
   * the playhead is rather than chase it. Zoom is left alone: the operator chose it.
   */
  useEffect(() => {
    if (!playheadPosition) {
      playbackFollowRef.current = false;
      return;
    }
    playbackFollowRef.current = true;
    if (!cameraFollowRef.current) return;
    mapRef.current?.setCenter({ lat: playheadPosition[1], lng: playheadPosition[0] });
  }, [playheadPosition]);

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

    const {
      IconLayer: Icon,
      PathLayer: Path,
      PolygonLayer: Polygon,
      ScatterplotLayer: Scatter,
      PathStyleExtension: DashExtension,
    } = classes;
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
          // One flat region per zone. The H3 cells a zone was painted from are
          // deliberately not redrawn here: on a fleet map the honeycomb competes
          // with the drivers, and the union ring already is the zone.
          // 77/255 ≈ 0.30 fill.
          getFillColor: (d) => [d.rgb[0], d.rgb[1], d.rgb[2], 77],
          getLineColor: (d) => [d.rgb[0], d.rgb[1], d.rgb[2], 200],
          getLineWidth: 2,
          lineWidthUnits: "pixels",
        }),
      );
    }

    if (routeGeometry && routeGeometry.segments.length > 0) {
      layers.push(
        new Path<{ path: [number, number][] }>({
          id: "fleet-route",
          data: routeGeometry.segments.map((path) => ({ path })),
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

    if (routeGeometry && routeGeometry.gaps.length > 0) {
      layers.push(
        new Path<
          { path: [number, number][] },
          PathStyleExtensionProps<{ path: [number, number][] }>
        >({
          id: "fleet-route-gaps",
          data: routeGeometry.gaps.map((path) => ({ path })),
          getPath: (d) => d.path,
          getColor: [...ROUTE_GAP_RGB, 210],
          // Thinner than the route as well as greyer, so the eye reads the solid line
          // as the record and this as the note that there isn't one.
          getWidth: 2.5,
          widthUnits: "pixels",
          // The dash array is in multiples of the path width, so this dashes at 10px on
          // / 7.5px off — in screen space, which is the only space where a dash stays a
          // dash across ten zoom levels. Finer than this renders as a dotted hairline
          // that a busy basemap swallows.
          getDashArray: [4, 3],
          dashJustified: true,
          extensions: [new DashExtension({ dash: true })],
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
          getRadius: (d) => (d.kind === "stop" ? 4.5 : 6),
          radiusUnits: "pixels",
          stroked: true,
          getLineWidth: 2.5,
          lineWidthUnits: "pixels",
          /*
           * Hollow rings, not filled discs.
           *
           * These were solid green / blue / coral circles a few pixels smaller than a
           * driver puck, which reads as three more drivers of three more statuses standing
           * next to the one you selected. A filled coloured circle means "a rider is here
           * and this is their status" on this map, so route furniture gets the inverse
           * treatment: white centre, colour in the stroke. The colour still says which
           * kind of stop it was.
           */
          getLineColor: (d) =>
            d.kind === "delivery"
              ? [16, 185, 129, 255]
              : d.kind === "pickup"
                ? [59, 130, 246, 255]
                : [ROUTE_RGB[0], ROUTE_RGB[1], ROUTE_RGB[2], 255],
          getFillColor: [255, 255, 255, 235],
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
          getLineWidth: 3.5,
          lineWidthUnits: "pixels",
          // Same inversion as the stops: the playhead marks a time, not a rider.
          getLineColor: [...ROUTE_RGB, 255],
          getFillColor: [255, 255, 255, 245],
        }),
      );
    }

    const drawable = entitiesRef.current.filter((entity) => entity.located);

    /*
     * Pulse rings, under every marker.
     *
     * One ring per arriving fix, which is what separates "this rider is being tracked" from
     * "this marker has stopped being told anything" — the interpolated sprite glides to a
     * halt either way, so the sprite alone cannot answer that. `data` is rebuilt per frame
     * rather than mutated in place: the set is at most `FLEET_PULSE_MAX` and its members
     * change constantly as rings expire, so a fresh array is cheaper than the bookkeeping
     * that would let deck reuse one.
     */
    const pulseNow = frameNowRef.current;
    const pulseTracker = pulseTrackerRef.current;
    const pulseData: Array<{
      position: [number, number];
      radius: number;
      color: [number, number, number, number];
    }> = [];

    for (const driverId of pulseIdsRef.current) {
      const entity = entityIndexRef.current.get(driverId);
      if (!entity?.located || !entity.pulses) continue;
      const phase = pulseTracker.phase(driverId, pulseNow);
      if (phase == null) continue;
      const ring = pulseRing(phase, reducedMotionRef.current);
      const rgb = TONE_RGB[entity.tone];
      pulseData.push({
        position: entity.position,
        radius: ring.radiusPx,
        color: [rgb[0], rgb[1], rgb[2], ring.alpha],
      });
    }

    if (pulseData.length > 0) {
      layers.push(
        new Scatter<(typeof pulseData)[number]>({
          id: "fleet-driver-pulses",
          data: pulseData,
          getPosition: (d) => d.position,
          getRadius: (d) => d.radius,
          radiusUnits: "pixels",
          stroked: false,
          filled: true,
          getFillColor: (d) => d.color,
          pickable: false,
        }),
      );
    }

    if (drawable.length > 0) {
      layers.push(
        new Scatter<FleetEntity>({
          id: "fleet-driver-pucks",
          data: drawable,
          getPosition: (d) => d.position,
          getRadius: (d) => (d.selected ? 11 : 8),
          radiusUnits: "pixels",
          stroked: true,
          getLineWidth: 2,
          lineWidthUnits: "pixels",
          getLineColor: [255, 255, 255, 230],
          getFillColor: (d) => [...TONE_RGB[d.tone], d.alert ? 250 : 220],
          updateTriggers: {
            getPosition: revision,
            getFillColor: revision,
            getRadius: revision,
          },
          pickable: !iconAtlas,
          onClick: (info) => {
            if (!info.object) return false;
            pickHandledRef.current = true;
            window.setTimeout(() => {
              pickHandledRef.current = false;
            }, 0);
            store.selectDriver(info.object.driverId);
            return true;
          },
        }),
      );
    }

    // Trails first, so a tail passes under every marker rather than over the rider it
    // belongs to. The entity list is already what the room decided this socket can
    // see, so iterating it *is* the viewport-and-filter restriction.
    const trailData: FleetTrail[] = [];
    let selectedTrail: FleetTrail | null = null;
    for (const entity of drawable) {
      const trail = store.trails.get(entity.driverId);
      // deck.gl needs two points to make a segment.
      if (!trail || trail.coords.length < 4) continue;
      // A trail that never left the marker is GPS noise, and drawn it is a coloured
      // smudge over the status it is sitting on. Suppressed for everyone including the
      // selected rider: their movement history is the route polyline, which is drawn
      // from the durable record and does not carry this noise.
      if (trailSpanMeters(trail) < MIN_TRAIL_SPAN_M) continue;
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

    if (drawable.length > 0 && iconAtlas) {
      const selected = drawable.filter((entity) => entity.selected);
      if (selected.length > 0) {
        layers.push(
          new Icon<FleetEntity>({
            id: "fleet-selection-ring",
            data: selected,
            iconAtlas: asIconAtlasProp(iconAtlas),
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
          iconAtlas: asIconAtlasProp(iconAtlas),
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
            if (!info.object) return false;
            pickHandledRef.current = true;
            window.setTimeout(() => {
              pickHandledRef.current = false;
            }, 0);
            store.selectDriver(info.object.driverId);
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
    routeGeometry,
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
        const pulseTracker = pulseTrackerRef.current;
        frameNowRef.current = serverNowMs;
        let moved = false;

        // Sweeping here rather than on a timer keeps the trail store free of its own
        // scheduler, and a driver who stopped reporting still has their tail expire.
        if (serverNowMs - lastTrailPruneRef.current >= TRAIL_PRUNE_INTERVAL_MS) {
          lastTrailPruneRef.current = serverNowMs;
          store.trails.prune(serverNowMs);
        }

        for (const entity of entitiesRef.current) {
          // The newest authoritative fix, which is both the reduced-motion position and
          // the pulse's trigger. Read for every driver, not only the pulsing ones, so a
          // driver who becomes eligible mid-shift already has a previous fix on record
          // and their first ring marks a real arrival.
          const fix = interpolator.latest(entity.driverId);
          if (fix) pulseTracker.observe(entity.driverId, fix.tMs, serverNowMs);

          const sample = reduced
            ? fix
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

        /*
         * The opening camera move.
         *
         * Skipped entirely when a driver is already selected: the selection's own focus
         * has either run or is retrying, and framing the whole fleet on top of it is what
         * made clicking a rider look like nothing happened — the pan landed, then this
         * fit pulled straight back out.
         */
        if (
          !didFitRef.current &&
          !selectedDriverIdRef.current &&
          entitiesRef.current.some((entity) => entity.located)
        ) {
          didFitRef.current = true;
          const map = mapRef.current;
          const located = entitiesRef.current.filter((entity) => entity.located);
          if (map && located.length === 1) {
            map.panTo({ lat: located[0]!.position[1], lng: located[0]!.position[0] });
            map.setZoom(DRIVER_FOCUS_ZOOM);
          } else if (map && located.length > 1) {
            const bounds = new google.maps.LatLngBounds();
            for (const entity of located) {
              bounds.extend({ lat: entity.position[1], lng: entity.position[0] });
            }
            map.fitBounds(bounds, FLEET_FIT_PADDING_PX);
          }
        }

        /*
         * Keep the followed rider on screen.
         *
         * Deliberately not a lock-on: recentring every frame would make the map crawl and
         * take panning away from the operator. The camera only intervenes once the rider
         * reaches the edge band, and playback owns the camera while it is running — the
         * playhead is a past position, and following both would fight over the centre.
         */
        if (
          cameraFollowRef.current &&
          !playbackFollowRef.current &&
          selectedDriverIdRef.current &&
          serverNowMs - lastFollowCheckRef.current >= FOLLOW_CHECK_INTERVAL_MS
        ) {
          lastFollowCheckRef.current = serverNowMs;
          const map = mapRef.current;
          const entity = entityIndexRef.current.get(selectedDriverIdRef.current);
          if (map && entity?.located) {
            const bounds = mapBounds(map);
            if (bounds && needsRecentre(entity.position, bounds)) {
              map.panTo({ lat: entity.position[1], lng: entity.position[0] });
            }
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
        // Framing the whole fleet is an explicit request to stop watching one rider.
        cameraFollowRef.current = false;
        map.fitBounds(bounds, FLEET_FIT_PADDING_PX);
      },
      focusDriver: (driverId: string) => {
        const map = mapRef.current;
        if (!map) return false;
        const entity = entityIndexRef.current.get(driverId);
        const driver = store.getDriver(driverId);
        const lat = entity?.located ? entity.position[1] : driver?.lat;
        const lng = entity?.located ? entity.position[0] : driver?.lng;
        if (lat == null || lng == null) return false;
        // An explicit focus is also how an operator takes back a follow they cancelled by
        // dragging, so this restores it rather than only moving the camera once.
        cameraFollowRef.current = true;
        lastFollowCheckRef.current = 0;
        didFitRef.current = true;
        map.panTo({ lat, lng });
        map.setZoom(DRIVER_FOCUS_ZOOM);
        return true;
      },
      fitPath: (path: readonly [number, number][]) => {
        const map = mapRef.current;
        if (!map) return false;
        cameraFollowRef.current = true;
        const box = pathBounds(path);
        if (!box) {
          // A route that never left one spot: centre on it, because fitting a zero-area
          // bounds snaps Google Maps to maximum zoom.
          const point = path[0];
          if (!point) return false;
          map.setCenter({ lat: point[1], lng: point[0] });
          return true;
        }
        const bounds = new google.maps.LatLngBounds(
          { lat: box.south, lng: box.west },
          { lat: box.north, lng: box.east },
        );
        map.fitBounds(bounds, FLEET_FIT_PADDING_PX);
        return true;
      },
      resize: () => {
        const map = mapRef.current;
        if (map) google.maps.event.trigger(map, "resize");
      },
    }),
    [store],
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
