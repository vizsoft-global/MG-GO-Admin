"use client";

import { MarkerClusterer } from "@googlemaps/markerclusterer";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { loadGoogleMaps } from "@/lib/google-maps/load";
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
import { createFleetMarkerIcon } from "./fleet-marker-icon";
import type {
  DriverLocationMapMarker,
  DriverLocationMapPath,
  RestaurantMapMarker,
} from "./types";
import { createDriverPulseOverlay } from "./driver-marker-pulse-overlay";
import {
  buildHeatmapPoints,
  isHeatmapLayerEnabled,
  isTrafficLayerEnabled,
} from "@/features/live-tracking/tracking-map-layer-controller";
import { createZoneLabelOverlay } from "./zone-label-overlay";

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
  const markerRefs = useRef<import("@/lib/google-maps/load").GoogleMarkerInstance[]>([]);
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
  const pulseRefs = useRef<Array<{ setMap: (map: import("@/lib/google-maps/load").GoogleMapInstance | null) => void }>>([]);
  const mapClickListenerRef = useRef<{ remove: () => void } | null>(null);
  const hasInitialFitRef = useRef(false);
  const [mapState, setMapState] = useState<"loading" | "ready" | "unavailable">("loading");
  const stableStyles = useMemo(() => mapStyles ?? [], [mapStyles]);

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
      for (const m of markerRefs.current) m.setMap(null);
      markerRefs.current = [];
      for (const m of restaurantMarkerRefs.current) m.setMap(null);
      restaurantMarkerRefs.current = [];
      for (const g of geofenceRefs.current) g.setMap(null);
      geofenceRefs.current = [];
      for (const label of geofenceLabelRefs.current) label.setMap(null);
      geofenceLabelRefs.current = [];
      for (const pulse of pulseRefs.current) pulse.setMap(null);
      pulseRefs.current = [];
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

    void loadGoogleMaps().then((google) => {
      if (!google?.maps?.Map || !mapRef.current) return;

      clustererRef.current?.clearMarkers();
      clustererRef.current = null;
      onClusterCountChange?.(0);

      for (const m of markerRefs.current) m.setMap(null);
      markerRefs.current = [];
      for (const m of restaurantMarkerRefs.current) m.setMap(null);
      restaurantMarkerRefs.current = [];
      for (const pulse of pulseRefs.current) pulse.setMap(null);
      pulseRefs.current = [];

      const MarkerCtor = google.maps.Marker;

      for (const pin of restaurantMarkers) {
        const marker = new MarkerCtor({
          position: { lat: pin.lat, lng: pin.lng },
          map: mapRef.current,
          title: pin.title,
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 10,
            fillColor: "#16a34a",
            fillOpacity: 1,
            strokeColor: "#ffffff",
            strokeWeight: 2,
          },
          zIndex: 500,
        });
        restaurantMarkerRefs.current.push(marker);
      }

      for (const pin of markers) {
        const marker = new MarkerCtor({
          position: { lat: pin.lat, lng: pin.lng },
          map: mapRef.current,
          title: pin.title,
          icon: createFleetMarkerIcon({
            pinStatus: pin.pinStatus,
            selected: Boolean(pin.highlight),
            vehicle: pin.vehicleType ?? "bike",
          }),
          zIndex: pin.highlight ? 999 : undefined,
        });
        if (onMarkerSelect) {
          marker.addListener("click", () => {
            const shouldClear = pin.id === focusMarkerId;
            onMarkerSelect(shouldClear ? null : pin.id);
          });
        }
        markerRefs.current.push(marker);

        if (mapLayer !== "heatmap" && pin.trackingStatus === "moving" && pin.pinStatus) {
          const pulse = createDriverPulseOverlay(
            google,
            mapRef.current,
            { lat: pin.lat, lng: pin.lng },
            pin.pinStatus,
          );
          pulseRefs.current.push(pulse);
        }
      }

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
      }

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
            const label = createZoneLabelOverlay(google, mapRef.current, {
              position: center,
              zoneName: zone.name,
              zoneColor: zone.color,
              driverCount: zone.driverCount ?? 0,
            });
            geofenceLabelRefs.current.push(label);
          }
        }
      }

      if (
        fitToMarkers &&
        !hasInitialFitRef.current &&
        (markers.length > 0 || (path && path.length > 0))
      ) {
        const bounds = new google.maps.LatLngBounds();
        for (const pin of markers) bounds.extend({ lat: pin.lat, lng: pin.lng });
        for (const pin of restaurantMarkers) bounds.extend({ lat: pin.lat, lng: pin.lng });
        for (const pt of path ?? []) bounds.extend(pt);
        mapRef.current.fitBounds(bounds, initialFitPadding);
        hasInitialFitRef.current = true;
      }

      if (isHeatmapLayerEnabled(mapLayer)) {
        for (const marker of markerRefs.current) marker.setMap(null);
        trafficRef.current?.setMap(null);
        if (!heatmapRef.current && google.maps.visualization?.HeatmapLayer) {
          heatmapRef.current = new google.maps.visualization.HeatmapLayer({});
        }
        const heatmapPoints = buildHeatmapPoints(markers);
        heatmapRef.current?.setData(heatmapPoints);
        heatmapRef.current?.setOptions({
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
        heatmapRef.current?.setMap(mapRef.current);
      } else {
        heatmapRef.current?.setMap(null);
        if (isTrafficLayerEnabled(mapLayer)) {
          if (!trafficRef.current) trafficRef.current = new google.maps.TrafficLayer();
          trafficRef.current.setMap(mapRef.current);
        } else {
          trafficRef.current?.setMap(null);
        }

        if (markers.length > 0) {
          clustererRef.current = new MarkerClusterer({
            map: mapRef.current,
            markers: markerRefs.current,
            renderer: {
              render: ({ count, position }) =>
                new google.maps.Marker({
                  position,
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
            },
          });
          const clusters =
            (clustererRef.current as unknown as { clusters?: Array<unknown> }).clusters?.length ??
            0;
          onClusterCountChange?.(clusters);
        }
      }
    });
  }, [
    markers,
    restaurantMarkers,
    path,
    mapState,
    fitToMarkers,
    geofenceOverlays,
    onMarkerSelect,
    focusMarkerId,
    initialFitPadding,
    mapLayer,
    onClusterCountChange,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || mapState !== "ready" || !focusMarkerId) return;
    const pin = markers.find((m) => m.id === focusMarkerId);
    if (!pin) return;
    map.panTo({ lat: pin.lat, lng: pin.lng });
    map.setZoom(16);
  }, [focusMarkerId, markers, mapState]);

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
