"use client";

import { MarkerClusterer } from "@googlemaps/markerclusterer";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { loadGoogleMaps } from "@/lib/google-maps/load";
import { ensureVisualizationLibrary } from "@/lib/google-maps/visualization";
import { GoogleMapsStatusBanner } from "@/features/restaurants/google-maps-status-banner";
import {
  circleFromZoneFeature,
  polygonFromFeature,
} from "@/features/zones/zone-map-google-utils";
import { circleFromFeature, polygonPositionsFromFeature } from "@/lib/geo/zone-geometry";
import {
  geofenceFillOpacity,
  type GeofenceMapOverlay,
} from "@/features/locations/geofence-map-overlays";
import { cn } from "@/lib/utils";
import { createFleetMarkerIcon, createRestaurantMarkerIcon } from "./fleet-marker-icon";
import type {
  DriverLocationMapMarker,
  DriverLocationMapPath,
  RestaurantMapMarker,
} from "./types";
import { createDriverPulseOverlay } from "./driver-marker-pulse-overlay";
import {
  buildHeatmapPoints,
  heatmapLayerDataFromPoints,
  isHeatmapLayerEnabled,
  isTrafficLayerEnabled,
} from "@/features/live-tracking/tracking-map-layer-controller";
import { createZoneLabelOverlay } from "./zone-label-overlay";

/**
 * Type-only bridge to `@googlemaps/markerclusterer`.
 *
 * This page drives Google Maps through the hand-written interfaces in
 * `@/lib/google-maps/load`, which describe only the surface it uses. The clusterer's
 * own types are written against `@types/google.maps`, which entered the tree as a
 * transitive dependency of `@deck.gl/google-maps` (Live Tracking V2) and so began
 * resolving where it previously fell back to `any`. Two structurally different
 * descriptions of the same runtime objects need a cast at the boundary; nothing about
 * what is handed to the clusterer has changed.
 */
type ClustererMap = google.maps.Map;
type ClustererMarker = google.maps.Marker;

function asClustererMarker(
  marker: import("@/lib/google-maps/load").GoogleMarkerInstance,
): ClustererMarker {
  return marker as unknown as ClustererMarker;
}

function asClustererMarkers(
  markers: import("@/lib/google-maps/load").GoogleMarkerInstance[],
): ClustererMarker[] {
  return markers as unknown as ClustererMarker[];
}

function asClustererMap(
  map: import("@/lib/google-maps/load").GoogleMapInstance | null,
): ClustererMap | undefined {
  return (map ?? undefined) as unknown as ClustererMap | undefined;
}

/** Cap animated pulses — thousands of moving overlays kill the main thread. */
const MAX_PULSE_MARKERS = 16;
/** Coalesce MarkerClusterer re-layout under GPS storms. */
const CLUSTER_RENDER_MS = 200;

function isValidLatLng(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180 &&
    !(lat === 0 && lng === 0)
  );
}

function approxMoved(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): boolean {
  return a.lat !== b.lat || a.lng !== b.lng;
}

export function DriverLocationsMap({
  markers,
  restaurantMarkers = [],
  path,
  className,
  mapHeightClass = "h-[220px]",
  fitToMarkers = true,
  focusMarkerId,
  onMarkerSelect,
  geofenceOverlays,
  frameless = false,
  mapStyles,
  mapTypeId = "roadmap",
  defaultZoom = 11,
  initialFitPadding = 72,
  mapLayer = "live",
  onMapReady,
  onMapActionsReady,
  onClusterCountChange,
  children,
}: {
  markers: DriverLocationMapMarker[];
  restaurantMarkers?: RestaurantMapMarker[];
  path?: DriverLocationMapPath;
  className?: string;
  mapHeightClass?: string;
  fitToMarkers?: boolean;
  focusMarkerId?: string | null;
  onMarkerSelect?: (markerId: string | null) => void;
  geofenceOverlays?: GeofenceMapOverlay[];
  frameless?: boolean;
  mapStyles?: import("@/lib/google-maps/load").GoogleMapStyleRule[];
  mapTypeId?: "roadmap" | "satellite" | "hybrid";
  defaultZoom?: number;
  initialFitPadding?: number;
  mapLayer?: "live" | "traffic" | "heatmap";
  onMapReady?: (map: import("@/lib/google-maps/load").GoogleMapInstance) => void;
  onMapActionsReady?: (actions: {
    recenter: () => void;
    zoomIn: () => void;
    zoomOut: () => void;
  }) => void;
  onClusterCountChange?: (count: number) => void;
  children?: ReactNode;
}) {
  const t = useTranslations("pages.locations");
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("@/lib/google-maps/load").GoogleMapInstance | null>(null);
  /** Stable marker identity so live GPS updates move pins instead of recreating them. */
  const driverMarkerByIdRef = useRef(
    new Map<
      string,
      {
        marker: import("@/lib/google-maps/load").GoogleMarkerInstance;
        pulse: {
          setMap: (map: import("@/lib/google-maps/load").GoogleMapInstance | null) => void;
          setPosition: (lat: number, lng: number) => void;
        } | null;
        iconKey: string;
        clickListener: { remove?: () => void } | null;
      }
    >(),
  );
  const restaurantMarkerRefs = useRef<import("@/lib/google-maps/load").GoogleMarkerInstance[]>([]);
  const geofenceRefs = useRef<
    Array<{ setMap: (map: import("@/lib/google-maps/load").GoogleMapInstance | null) => void }>
  >([]);
  const geofenceLabelRefs = useRef<
    Array<{ setMap: (map: import("@/lib/google-maps/load").GoogleMapInstance | null) => void }>
  >([]);
  const polylineRef = useRef<{ setMap: (map: unknown) => void } | null>(null);
  const trafficRef = useRef<import("@/lib/google-maps/load").GoogleOverlayLayer | null>(null);
  const heatmapRef = useRef<import("@/lib/google-maps/load").GoogleHeatmapLayerInstance | null>(
    null,
  );
  const clustererRef = useRef<MarkerClusterer | null>(null);
  const clusterRenderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastMarkerPosRef = useRef(new Map<string, { lat: number; lng: number }>());
  const mapClickListenerRef = useRef<{ remove: () => void } | null>(null);
  const hasInitialFitRef = useRef(false);
  const lastFitMarkerKeyRef = useRef("");
  const markerSyncGenRef = useRef(0);
  const onMarkerSelectRef = useRef(onMarkerSelect);
  const focusMarkerIdRef = useRef(focusMarkerId);
  onMarkerSelectRef.current = onMarkerSelect;
  focusMarkerIdRef.current = focusMarkerId;
  const [mapState, setMapState] = useState<"loading" | "ready" | "unavailable">("loading");
  const stableStyles = useMemo(() => mapStyles ?? [], [mapStyles]);

  const scheduleClusterRender = () => {
    if (clusterRenderTimerRef.current != null) return;
    clusterRenderTimerRef.current = setTimeout(() => {
      clusterRenderTimerRef.current = null;
      try {
        clustererRef.current?.render();
        const clusters =
          (clustererRef.current as unknown as { clusters?: Array<unknown> }).clusters?.length ?? 0;
        onClusterCountChange?.(clusters);
      } catch {
        // Clusterer can throw if markers were cleared mid-render; ignore.
      }
    }, CLUSTER_RENDER_MS);
  };

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container) return;

    loadGoogleMaps().then((google) => {
      if (cancelled || !container) return;
      if (!google?.maps?.Map) {
        setMapState("unavailable");
        return;
      }

      const defaultCenter =
        markers[0] != null
          ? { lat: markers[0].lat, lng: markers[0].lng }
          : path?.[0] != null
            ? { lat: path[0].lat, lng: path[0].lng }
            : { lat: 29.3759, lng: 47.9774 };

      const map = new google.maps.Map(container, {
        center: defaultCenter,
        zoom: defaultZoom,
        disableDefaultUI: true,
        zoomControl: false,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        clickableIcons: false,
        mapTypeId,
        styles: stableStyles,
      });
      mapRef.current = map;
      mapClickListenerRef.current = map.addListener("click", () => onMarkerSelect?.(null));
      onMapReady?.(map);
      onMapActionsReady?.({
        recenter: () => {
          const current = mapRef.current;
          if (!current) return;
          if (markers.length > 0 || (path?.length ?? 0) > 0) {
            const bounds = new google.maps.LatLngBounds();
            for (const pin of markers) bounds.extend({ lat: pin.lat, lng: pin.lng });
            for (const pin of restaurantMarkers) bounds.extend({ lat: pin.lat, lng: pin.lng });
            for (const pt of path ?? []) bounds.extend(pt);
            current.fitBounds(bounds, initialFitPadding);
          }
        },
        zoomIn: () => {
          const current = mapRef.current;
          if (!current) return;
          const currentZoom = current.getZoom() ?? defaultZoom;
          current.setZoom(Math.min(currentZoom + 1, 20));
        },
        zoomOut: () => {
          const current = mapRef.current;
          if (!current) return;
          const currentZoom = current.getZoom() ?? defaultZoom;
          current.setZoom(Math.max(currentZoom - 1, 3));
        },
      });
      setMapState("ready");
    });

    return () => {
      cancelled = true;
      mapClickListenerRef.current?.remove();
      mapClickListenerRef.current = null;
      if (clusterRenderTimerRef.current != null) {
        clearTimeout(clusterRenderTimerRef.current);
        clusterRenderTimerRef.current = null;
      }
      for (const entry of driverMarkerByIdRef.current.values()) {
        entry.clickListener?.remove?.();
        entry.pulse?.setMap(null);
        entry.marker.setMap(null);
      }
      driverMarkerByIdRef.current.clear();
      lastMarkerPosRef.current.clear();
      for (const m of restaurantMarkerRefs.current) m.setMap(null);
      restaurantMarkerRefs.current = [];
      for (const g of geofenceRefs.current) g.setMap(null);
      geofenceRefs.current = [];
      for (const label of geofenceLabelRefs.current) label.setMap(null);
      geofenceLabelRefs.current = [];
      trafficRef.current?.setMap(null);
      trafficRef.current = null;
      heatmapRef.current?.setMap(null);
      heatmapRef.current = null;
      clustererRef.current?.clearMarkers();
      clustererRef.current = null;
      polylineRef.current?.setMap(null);
      polylineRef.current = null;
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || mapState !== "ready") return;
    map.setOptions({ styles: stableStyles, mapTypeId });
  }, [mapTypeId, mapState, stableStyles]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || mapState !== "ready") return;

    const syncGen = ++markerSyncGenRef.current;
    void loadGoogleMaps().then(async (google) => {
      if (syncGen !== markerSyncGenRef.current) return;
      if (!google?.maps?.Map || !mapRef.current) return;

      const MarkerCtor = google.maps.Marker;
      if (!MarkerCtor) return;

      const validMarkers = markers.filter((m) => isValidLatLng(m.lat, m.lng));
      const nextIds = new Set(validMarkers.map((m) => m.id));
      const byId = driverMarkerByIdRef.current;
      const focusedId = focusMarkerIdRef.current;

      // Prefer selected + first moving pins for pulse budget.
      const pulseEligible = new Set<string>();
      if (focusedId) pulseEligible.add(focusedId);
      for (const pin of validMarkers) {
        if (pulseEligible.size >= MAX_PULSE_MARKERS) break;
        if (pin.trackingStatus === "moving") pulseEligible.add(pin.id);
      }

      const created: import("@/lib/google-maps/load").GoogleMarkerInstance[] = [];
      let anyMoved = false;
      let anyRemoved = false;

      for (const [id, entry] of byId) {
        if (nextIds.has(id)) continue;
        entry.clickListener?.remove?.();
        entry.pulse?.setMap(null);
        entry.marker.setMap(null);
        try {
          clustererRef.current?.removeMarker(asClustererMarker(entry.marker));
        } catch {
          /* ignore */
        }
        byId.delete(id);
        lastMarkerPosRef.current.delete(id);
        anyRemoved = true;
      }

      for (const pin of validMarkers) {
        const iconKey = `${pin.pinStatus ?? ""}|${pin.vehicleType ?? "bike"}|${pin.highlight ? "1" : "0"}|${pin.trackingStatus ?? ""}`;
        const existing = byId.get(pin.id);
        const wantPulse =
          mapLayer !== "heatmap" &&
          pin.trackingStatus === "moving" &&
          Boolean(pin.pinStatus) &&
          pulseEligible.has(pin.id);

        if (existing) {
          const last = lastMarkerPosRef.current.get(pin.id);
          if (!last || approxMoved(last, pin)) {
            existing.marker.setPosition({ lat: pin.lat, lng: pin.lng });
            lastMarkerPosRef.current.set(pin.id, { lat: pin.lat, lng: pin.lng });
            anyMoved = true;
          }
          existing.marker.setTitle?.(pin.title ?? "");
          existing.marker.setZIndex?.(pin.highlight ? 999 : 1);
          if (existing.iconKey !== iconKey) {
            existing.marker.setIcon?.(
              createFleetMarkerIcon({
                pinStatus: pin.pinStatus,
                selected: Boolean(pin.highlight),
                vehicle: pin.vehicleType ?? "bike",
              }),
            );
            existing.iconKey = iconKey;
            anyMoved = true;
          }
          if (existing.pulse) {
            existing.pulse.setPosition(pin.lat, pin.lng);
          }
          if (!existing.pulse && wantPulse && pin.pinStatus) {
            existing.pulse = createDriverPulseOverlay(
              google,
              mapRef.current,
              { lat: pin.lat, lng: pin.lng },
              pin.pinStatus,
            );
          }
          if (existing.pulse && !wantPulse) {
            existing.pulse.setMap(null);
            existing.pulse = null;
          }
          continue;
        }

        const marker = new MarkerCtor({
          position: { lat: pin.lat, lng: pin.lng },
          map: isHeatmapLayerEnabled(mapLayer) ? null : mapRef.current,
          title: pin.title,
          icon: createFleetMarkerIcon({
            pinStatus: pin.pinStatus,
            selected: Boolean(pin.highlight),
            vehicle: pin.vehicleType ?? "bike",
          }),
          zIndex: pin.highlight ? 999 : undefined,
        });
        const clickListener = marker.addListener("click", () => {
          const select = onMarkerSelectRef.current;
          if (!select) return;
          const focused = focusMarkerIdRef.current;
          select(pin.id === focused ? null : pin.id);
        });

        let pulse: {
          setMap: (map: import("@/lib/google-maps/load").GoogleMapInstance | null) => void;
          setPosition: (lat: number, lng: number) => void;
        } | null = null;
        if (wantPulse && pin.pinStatus) {
          pulse = createDriverPulseOverlay(
            google,
            mapRef.current,
            { lat: pin.lat, lng: pin.lng },
            pin.pinStatus,
          );
        }

        byId.set(pin.id, {
          marker,
          pulse,
          iconKey,
          clickListener,
        });
        lastMarkerPosRef.current.set(pin.id, { lat: pin.lat, lng: pin.lng });
        created.push(marker);
        anyMoved = true;
      }

      if (fitToMarkers && validMarkers.length > 0) {
        const markerKey = validMarkers.map((pin) => pin.id).sort().join("|");
        if (markerKey !== lastFitMarkerKeyRef.current) {
          const bounds = new google.maps.LatLngBounds();
          for (const pin of validMarkers) bounds.extend({ lat: pin.lat, lng: pin.lng });
          for (const pin of restaurantMarkers) {
            if (isValidLatLng(pin.lat, pin.lng)) bounds.extend({ lat: pin.lat, lng: pin.lng });
          }
          mapRef.current.fitBounds(bounds, initialFitPadding);
          lastFitMarkerKeyRef.current = markerKey;
          hasInitialFitRef.current = true;
        }
      }

      const allDriverMarkers = [...byId.values()].map((e) => e.marker);

      if (isHeatmapLayerEnabled(mapLayer)) {
        for (const entry of byId.values()) {
          entry.marker.setMap(null);
          entry.pulse?.setMap(null);
        }
        clustererRef.current?.clearMarkers();
        clustererRef.current = null;
        trafficRef.current?.setMap(null);
        await ensureVisualizationLibrary(google);
        const HeatmapLayer = google.maps.visualization?.HeatmapLayer;
        if (!HeatmapLayer) {
          for (const entry of byId.values()) {
            entry.marker.setMap(mapRef.current);
          }
          onClusterCountChange?.(0);
          return;
        }
        if (!heatmapRef.current) {
          heatmapRef.current = new HeatmapLayer({});
        }
        const heatmapPoints = heatmapLayerDataFromPoints(
          buildHeatmapPoints(validMarkers),
          google.maps.LatLng,
        );
        heatmapRef.current.setData(heatmapPoints);
        heatmapRef.current.setOptions({
          radius: 34,
          opacity: 0.7,
          gradient: [
            "rgba(16, 185, 129, 0.15)",
            "rgba(34, 197, 94, 0.35)",
            "rgba(250, 204, 21, 0.6)",
            "rgba(249, 115, 22, 0.8)",
            "rgba(239, 68, 68, 0.95)",
          ],
        });
        heatmapRef.current.setMap(mapRef.current);
        onClusterCountChange?.(0);
      } else {
        heatmapRef.current?.setMap(null);
        if (isTrafficLayerEnabled(mapLayer)) {
          if (!trafficRef.current) trafficRef.current = new google.maps.TrafficLayer();
          trafficRef.current.setMap(mapRef.current);
        } else {
          trafficRef.current?.setMap(null);
        }

        if (!clustererRef.current) {
          clustererRef.current = new MarkerClusterer({
            map: asClustererMap(mapRef.current),
            markers: asClustererMarkers(allDriverMarkers),
            renderer: {
              render: ({ count, position }) =>
                asClustererMarker(
                  new google.maps.Marker({
                    position: { lat: position.lat(), lng: position.lng() },
                    map: null,
                    icon: {
                      url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(
                        `<svg width="42" height="42" viewBox="0 0 42 42" xmlns="http://www.w3.org/2000/svg"><circle cx="21" cy="21" r="20" fill="#2563EB"/><circle cx="21" cy="21" r="15" fill="#1D4ED8"/><text x="21" y="26" text-anchor="middle" fill="white" font-size="12" font-family="Inter,Arial,sans-serif" font-weight="700">${count}</text></svg>`,
                      )}`,
                      scaledSize: { width: 42, height: 42 },
                      anchor: { x: 21, y: 21 },
                    },
                    zIndex: 1000,
                  }),
                ),
            },
          });
          anyMoved = true;
        } else if (created.length > 0 || anyMoved || anyRemoved) {
          clustererRef.current.clearMarkers();
          if (allDriverMarkers.length > 0) {
            clustererRef.current.addMarkers(asClustererMarkers(allDriverMarkers));
          }
          anyMoved = true;
        }
        if (anyMoved || anyRemoved) scheduleClusterRender();
      }
    });
  }, [
    markers,
    mapState,
    fitToMarkers,
    restaurantMarkers,
    initialFitPadding,
    mapLayer,
    onClusterCountChange,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || mapState !== "ready") return;

    void loadGoogleMaps().then((google) => {
      if (!google?.maps?.Map || !mapRef.current) return;
      const MarkerCtor = google.maps.Marker;
      if (!MarkerCtor) return;

      for (const m of restaurantMarkerRefs.current) {
        try {
          m.setMap(null);
        } catch {
          /* ignore */
        }
      }
      restaurantMarkerRefs.current = [];

      const bounds = new google.maps.LatLngBounds();
      let placed = 0;

      for (const pin of restaurantMarkers) {
        if (!isValidLatLng(pin.lat, pin.lng)) continue;
        try {
          const marker = new MarkerCtor({
            position: { lat: pin.lat, lng: pin.lng },
            map: mapRef.current,
            title: pin.title ?? "Restaurant",
            icon: createRestaurantMarkerIcon({ selected: true }),
            zIndex: 2000,
          });
          restaurantMarkerRefs.current.push(marker);
          bounds.extend({ lat: pin.lat, lng: pin.lng });
          placed += 1;
        } catch (err) {
          console.error("[live-map] restaurant marker failed", pin, err);
        }
      }

      // Frame restaurants + focused driver once per restaurant set (not every GPS tick).
      if (placed > 0 && focusMarkerIdRef.current) {
        const fitKey = `${focusMarkerIdRef.current}|${restaurantMarkers
          .map((p) => p.id)
          .sort()
          .join(",")}`;
        const mapAny = mapRef.current as unknown as { __restaurantFitKey?: string };
        if (mapAny.__restaurantFitKey !== fitKey) {
          mapAny.__restaurantFitKey = fitKey;
          const focusPin = markers.find((m) => m.id === focusMarkerIdRef.current);
          if (focusPin && isValidLatLng(focusPin.lat, focusPin.lng)) {
            bounds.extend({ lat: focusPin.lat, lng: focusPin.lng });
          }
          try {
            mapRef.current.fitBounds(bounds, 80);
          } catch {
            /* ignore */
          }
        }
      }
    });
  }, [restaurantMarkers, mapState]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || mapState !== "ready") return;

    void loadGoogleMaps().then((google) => {
      if (!google?.maps?.Map || !mapRef.current) return;

      polylineRef.current?.setMap(null);
      polylineRef.current = null;

      if (path && path.length >= 2) {
        const Polyline = (
          google.maps as unknown as {
            Polyline: new (opts: {
              path: { lat: number; lng: number }[];
              geodesic: boolean;
              strokeColor: string;
              strokeOpacity: number;
              strokeWeight: number;
              map: typeof map;
            }) => { setMap: (map: unknown) => void };
          }
        ).Polyline;

        if (Polyline) {
          polylineRef.current = new Polyline({
            path,
            geodesic: true,
            strokeColor: "#6366f1",
            strokeOpacity: 0.85,
            strokeWeight: 3,
            map: mapRef.current,
          });
        }

        if (fitToMarkers && !hasInitialFitRef.current) {
          const bounds = new google.maps.LatLngBounds();
          for (const pt of path) bounds.extend(pt);
          mapRef.current.fitBounds(bounds, initialFitPadding);
          hasInitialFitRef.current = true;
        }
      }
    });
  }, [path, mapState, fitToMarkers, initialFitPadding]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || mapState !== "ready") return;

    void loadGoogleMaps().then((google) => {
      if (!google?.maps?.Map || !mapRef.current) return;

      for (const g of geofenceRefs.current) g.setMap(null);
      geofenceRefs.current = [];
      for (const label of geofenceLabelRefs.current) label.setMap(null);
      geofenceLabelRefs.current = [];

      for (const zone of geofenceOverlays ?? []) {
        const fillOpacity = geofenceFillOpacity(zone.status);
        const shape =
          zone.zone_type === "circle"
            ? circleFromZoneFeature(google, mapRef.current, zone.geometry, zone.color, {
                fillOpacity,
                clickable: false,
              })
            : polygonFromFeature(google, mapRef.current, zone.geometry, zone.color, {
                fillOpacity,
                clickable: false,
              });
        if (shape) geofenceRefs.current.push(shape);
        if (zone.name) {
          const center = getOverlayCenter(zone);
          if (center) {
            geofenceLabelRefs.current.push(
              createZoneLabelOverlay(google, mapRef.current, {
                position: center,
                zoneName: zone.name,
                zoneColor: zone.color,
                driverCount: zone.driverCount ?? 0,
              }),
            );
          }
        }
      }
    });
  }, [geofenceOverlays, mapState]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || mapState !== "ready" || !focusMarkerId) return;
    const pin = markers.find((m) => m.id === focusMarkerId);
    if (!pin) return;
    map.panTo({ lat: pin.lat, lng: pin.lng });
  }, [focusMarkerId, markers, mapState]);

  // Zoom once when a driver is first selected; don't reset zoom on every GPS tick.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || mapState !== "ready" || !focusMarkerId) return;
    map.setZoom(16);
  }, [focusMarkerId, mapState]);

  return (
    <div
      className={cn(
        "relative overflow-hidden",
        !frameless && "rounded-lg border border-border",
        className,
      )}
    >
      <div className={cn("relative w-full bg-muted", mapHeightClass)}>
        {mapState === "loading" ? (
          <div className="absolute inset-0 z-[1] flex items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : null}
        {mapState === "unavailable" ? (
          <div className="absolute inset-0 z-[1] flex flex-col items-center justify-center gap-2 p-4">
            <GoogleMapsStatusBanner className="max-w-sm text-center" />
            <p className="text-center text-xs text-muted-foreground">{t("mapUnavailable")}</p>
          </div>
        ) : null}
        <div ref={containerRef} className="h-full w-full" aria-hidden={mapState !== "ready"} />
        {children}
      </div>
    </div>
  );
}

function getOverlayCenter(zone: GeofenceMapOverlay): { lat: number; lng: number } | null {
  if (zone.zone_type === "circle") {
    const circle = circleFromFeature(zone.geometry);
    if (!circle) return null;
    return { lat: circle.center[0], lng: circle.center[1] };
  }
  const positions = polygonPositionsFromFeature(zone.geometry);
  if (positions.length === 0) return null;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const [lat, lng] of positions) {
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
  }
  if (!Number.isFinite(minLat) || !Number.isFinite(maxLat) || !Number.isFinite(minLng) || !Number.isFinite(maxLng)) {
    return null;
  }
  return {
    lat: (minLat + maxLat) / 2,
    lng: (minLng + maxLng) / 2,
  };
}
