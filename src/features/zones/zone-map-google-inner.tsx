"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import {
  getGoogleMapsLoadFailure,
  loadGoogleMaps,
  type GoogleCircleInstance,
  type GoogleMapInstance,
  type GoogleMapsApi,
  type GoogleOverlayViewInstance,
  type GooglePolygonInstance,
} from "@/lib/google-maps/load";
import {
  buildCircleFeature,
  MAX_RADIUS_METERS,
  MIN_RADIUS_METERS,
  zoneMapBoundsFromShape,
  type ZoneGeoFeature,
  type ZoneGeometryType,
} from "@/lib/geo/zone-geometry";
import { GoogleMapsStatusBanner } from "@/features/restaurants/google-maps-status-banner";
import {
  DEFAULT_MAP_ZOOM,
  KUWAIT_MAP_CENTER,
  ZONE_REFERENCE_FILL_OPACITY,
  ZONE_REFERENCE_STROKE_OPACITY,
} from "./constants";
import { normalizeZoneColor } from "./zone-colors";
import type { ZoneMapDrawMode } from "./zone-map-inner";
import type { ZoneRow } from "./types";
import type { ZoneMapAdapter } from "./zone-map-adapter";
import { ZoneMapLayersControl } from "./zone-map-layers-control";
import { useGoogleLiveDriverMarkers } from "./zone-live-drivers-markers";
import { createZoneLabelOverlay } from "./zone-map-google-label";
import {
  DEFAULT_ZONE_MAP_PREFS,
  loadZoneMapPrefs,
  subscribeZoneMapPrefs,
  type ZoneMapLayerPrefs,
} from "./zone-map-layer-prefs";
import {
  bindCircleEditListeners,
  bindPolygonEditListeners,
  circleFromZoneFeature,
  featureFromPolygon,
  googlePathOptions,
  polygonFromFeature,
} from "./zone-map-google-utils";

function tupleToLatLng(center: [number, number]) {
  return { lat: center[0], lng: center[1] };
}

const DEFAULT_CIRCLE_RADIUS_METERS = 1000;

function clampCircleRadiusMeters(radius: number) {
  return Math.min(MAX_RADIUS_METERS, Math.max(MIN_RADIUS_METERS, radius));
}

function createMapAdapter(
  map: GoogleMapInstance,
  google: GoogleMapsApi,
  controls?: {
    setDrawMode?: (mode: "polygon" | "circle" | null) => void;
    setEditing?: (enabled: boolean) => void;
    setDragging?: (enabled: boolean) => void;
    deleteSelected?: () => void;
    clearDraft?: () => void;
  },
): ZoneMapAdapter {
  return {
    panTo(lat, lng, zoom = 14) {
      map.panTo({ lat, lng });
      map.setZoom(zoom);
    },
    fitViewport(viewport) {
      const bounds = new google.maps.LatLngBounds();
      bounds.extend({ lat: viewport.north, lng: viewport.east });
      bounds.extend({ lat: viewport.south, lng: viewport.west });
      map.fitBounds(bounds, 48);
    },
    invalidateSize() {
      /* Google Maps auto-resizes */
    },
    setDrawMode: controls?.setDrawMode,
    setEditing: controls?.setEditing,
    setDragging: controls?.setDragging,
    deleteSelected: controls?.deleteSelected,
    clearDraft: controls?.clearDraft,
    setMapType(type) {
      map.setMapTypeId(type);
    },
    zoomIn() {
      const current = map.getZoom?.() ?? 12;
      map.setZoom(current + 1);
    },
    zoomOut() {
      const current = map.getZoom?.() ?? 12;
      map.setZoom(Math.max(0, current - 1));
    },
  };
}

export function ZoneMapGoogleInner({
  zones,
  selectedId,
  className,
  drawMode = null,
  excludeZoneId = null,
  draftGeometry = null,
  draftZoneType = "polygon",
  draftCircleRadiusMeters = DEFAULT_CIRCLE_RADIUS_METERS,
  draftColor,
  onDraftGeometryChange,
  onMapReady,
  onZoneSelect,
}: {
  zones: ZoneRow[];
  selectedId: string | null;
  className?: string;
  drawMode?: ZoneMapDrawMode;
  excludeZoneId?: string | null;
  draftGeometry?: ZoneGeoFeature | null;
  draftZoneType?: ZoneGeometryType;
  draftCircleRadiusMeters?: number;
  draftColor?: string;
  onDraftGeometryChange?: (
    geometry: ZoneGeoFeature | null,
    zoneType: ZoneGeometryType,
  ) => void;
  onMapReady?: (adapter: ZoneMapAdapter) => void;
  onZoneSelect?: (zoneId: string) => void;
}) {
  const t = useTranslations("pages.zones");
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<GoogleMapInstance | null>(null);
  const googleRef = useRef<GoogleMapsApi | null>(null);
  const zoneOverlaysRef = useRef<
    Array<{ id: string; layer: GooglePolygonInstance | GoogleCircleInstance }>
  >([]);
  const zoneLabelsRef = useRef<
    Array<{ id: string; overlay: GoogleOverlayViewInstance }>
  >([]);
  const showLabelsRef = useRef(true);
  const [mapPrefs, setMapPrefs] = useState<ZoneMapLayerPrefs>(DEFAULT_ZONE_MAP_PREFS);
  const draftOverlayRef = useRef<GooglePolygonInstance | GoogleCircleInstance | null>(
    null,
  );
  const drawingManagerRef = useRef<
    import("@/lib/google-maps/load").GoogleDrawingManagerInstance | null
  >(null);
  const circleClickListenerRef = useRef<{ remove: () => void } | null>(null);
  const onDraftChangeRef = useRef(onDraftGeometryChange);
  const drawModeRef = useRef(drawMode);
  const draftCircleRadiusRef = useRef(
    clampCircleRadiusMeters(draftCircleRadiusMeters),
  );
  const draftColorRef = useRef(normalizeZoneColor(draftColor));
  const [mapState, setMapState] = useState<"loading" | "ready" | "unavailable">(
    "loading",
  );

  useGoogleLiveDriverMarkers(
    mapRef.current,
    mapState === "ready" && mapPrefs.showLiveDrivers,
  );

  onDraftChangeRef.current = onDraftGeometryChange;
  drawModeRef.current = drawMode;
  draftCircleRadiusRef.current = clampCircleRadiusMeters(draftCircleRadiusMeters);
  draftColorRef.current = normalizeZoneColor(draftColor);

  const clearCircleClickListener = useCallback(() => {
    circleClickListenerRef.current?.remove();
    circleClickListenerRef.current = null;
  }, []);

  const referenceZones = useMemo(() => {
    if (!drawMode) return [];
    return zones.filter((z) => z.geometry && z.id !== excludeZoneId);
  }, [drawMode, zones, excludeZoneId]);

  const clearZoneOverlays = useCallback(() => {
    for (const o of zoneOverlaysRef.current) {
      o.layer.setMap(null);
    }
    zoneOverlaysRef.current = [];
  }, []);

  const clearZoneLabels = useCallback(() => {
    for (const o of zoneLabelsRef.current) {
      o.overlay.setMap(null);
    }
    zoneLabelsRef.current = [];
  }, []);

  useEffect(() => {
    showLabelsRef.current = mapPrefs.showLabels;
  }, [mapPrefs.showLabels]);

  useEffect(() => {
    setMapPrefs(loadZoneMapPrefs());
    const unsub = subscribeZoneMapPrefs((prefs) => setMapPrefs(prefs));
    return unsub;
  }, []);

  const clearDraftOverlay = useCallback(() => {
    if (draftOverlayRef.current) {
      draftOverlayRef.current.setMap(null);
      draftOverlayRef.current = null;
    }
  }, []);

  const fitZonesBounds = useCallback(
    (map: GoogleMapInstance, google: GoogleMapsApi, targetId: string | null) => {
      const bounds = new google.maps.LatLngBounds();
      let hasPoint = false;

      const list = targetId
        ? zones.filter((z) => z.id === targetId)
        : zones;

      for (const z of list) {
        if (!z.geometry) continue;
        const corners = zoneMapBoundsFromShape(z.zone_type, z.geometry);
        if (!corners) continue;
        for (const [lat, lng] of corners) {
          bounds.extend({ lat, lng });
          hasPoint = true;
        }
      }

      if (hasPoint) {
        map.fitBounds(bounds, 48);
      }
    },
    [zones],
  );

  const renderZoneOverlay = useCallback(
    (
      google: GoogleMapsApi,
      map: GoogleMapInstance,
      zone: ZoneRow,
      opts: {
        selected: boolean;
        reference: boolean;
        clickable: boolean;
      },
    ) => {
      if (!zone.geometry) return null;
      const color = normalizeZoneColor(zone.color);
      const fillOpacity = opts.reference
        ? ZONE_REFERENCE_FILL_OPACITY
        : opts.selected
          ? 0.35
          : 0.2;
      const weight = opts.reference ? 1.5 : opts.selected ? 3 : 2;
      const strokeOpacity = opts.reference ? ZONE_REFERENCE_STROKE_OPACITY : 1;

      const common = {
        fillOpacity,
        weight,
        strokeOpacity,
        clickable: opts.clickable,
      };

      let layer: GooglePolygonInstance | GoogleCircleInstance | null = null;

      if (zone.zone_type === "circle") {
        layer = circleFromZoneFeature(google, map, zone.geometry, color, common);
      } else {
        layer = polygonFromFeature(google, map, zone.geometry, color, common);
      }

      if (layer && opts.clickable) {
        layer.addListener("click", () => onZoneSelect?.(zone.id));
      }

      return layer;
    },
    [onZoneSelect],
  );

  const syncBrowseOverlays = useCallback(() => {
    const map = mapRef.current;
    const google = googleRef.current;
    if (!map || !google || drawMode) return;

    clearZoneOverlays();
    for (const zone of zones) {
      if (!zone.geometry) continue;
      const layer = renderZoneOverlay(google, map, zone, {
        selected: zone.id === selectedId,
        reference: false,
        clickable: Boolean(onZoneSelect),
      });
      if (layer) {
        zoneOverlaysRef.current.push({ id: zone.id, layer });
      }
    }
    fitZonesBounds(map, google, selectedId);
  }, [
    zones,
    selectedId,
    drawMode,
    clearZoneOverlays,
    renderZoneOverlay,
    fitZonesBounds,
    onZoneSelect,
  ]);

  const syncZoneLabels = useCallback(() => {
    const map = mapRef.current;
    const google = googleRef.current;
    if (!map || !google || drawMode || !showLabelsRef.current) {
      clearZoneLabels();
      return;
    }

    clearZoneLabels();
    for (const zone of zones) {
      if (!zone.geometry) continue;
      const overlay = createZoneLabelOverlay(google, map, zone, {
        onSelect: onZoneSelect,
      });
      if (overlay) {
        zoneLabelsRef.current.push({ id: zone.id, overlay });
      }
    }
  }, [zones, drawMode, clearZoneLabels, onZoneSelect]);

  const syncReferenceOverlays = useCallback(() => {
    const map = mapRef.current;
    const google = googleRef.current;
    if (!map || !google || !drawMode) return;

    clearZoneOverlays();
    for (const zone of referenceZones) {
      const layer = renderZoneOverlay(google, map, zone, {
        selected: false,
        reference: true,
        clickable: false,
      });
      if (layer) {
        zoneOverlaysRef.current.push({ id: zone.id, layer });
      }
    }
  }, [drawMode, referenceZones, clearZoneOverlays, renderZoneOverlay]);

  const attachDraftFromGeometry = useCallback(
    (
      geometry: ZoneGeoFeature,
      zoneType: ZoneGeometryType,
      editable: boolean,
    ) => {
      const map = mapRef.current;
      const google = googleRef.current;
      if (!map || !google) return;

      clearDraftOverlay();
      const color = draftColorRef.current;

      if (zoneType === "circle") {
        const circle = circleFromZoneFeature(google, map, geometry, color, {
          editable,
          fillOpacity: 0.35,
          weight: 3,
        });
        if (circle) {
          if (editable) {
            bindCircleEditListeners(circle, (g, t) =>
              onDraftChangeRef.current?.(g, t),
            );
          }
          draftOverlayRef.current = circle;
        }
      } else {
        const polygon = polygonFromFeature(google, map, geometry, color, {
          editable,
          fillOpacity: 0.35,
          weight: 3,
        });
        if (polygon) {
          if (editable) {
            bindPolygonEditListeners(polygon, (g, t) =>
              onDraftChangeRef.current?.(g, t),
            );
          }
          draftOverlayRef.current = polygon;
        }
      }
    },
    [clearDraftOverlay],
  );

  const placeCircleAt = useCallback(
    (lat: number, lng: number) => {
      const feature = buildCircleFeature(
        [lat, lng],
        clampCircleRadiusMeters(draftCircleRadiusRef.current),
      );
      attachDraftFromGeometry(feature, "circle", true);
      onDraftChangeRef.current?.(feature, "circle");
      if (drawingManagerRef.current) {
        drawingManagerRef.current.setDrawingMode(null);
      }
      clearCircleClickListener();
    },
    [attachDraftFromGeometry, clearCircleClickListener],
  );

  const syncCircleClickPlacement = useCallback(() => {
    const map = mapRef.current;
    const google = googleRef.current;
    if (!map || !google || mapState !== "ready") return;

    clearCircleClickListener();

    const shouldListen =
      Boolean(drawModeRef.current) &&
      drawModeRef.current === "circle" &&
      !draftOverlayRef.current &&
      !draftGeometry;

    if (!shouldListen) return;

    circleClickListenerRef.current = map.addListener(
      "click",
      ((e: { latLng?: { lat: () => number; lng: () => number } | null }) => {
        if (drawModeRef.current !== "circle" || draftOverlayRef.current) return;
        const latLng = e.latLng;
        if (!latLng) return;
        placeCircleAt(latLng.lat(), latLng.lng());
      }) as () => void,
    );
  }, [mapState, draftGeometry, clearCircleClickListener, placeCircleAt]);

  const setupDrawingManager = useCallback(() => {
    const map = mapRef.current;
    const google = googleRef.current;
    if (!map || !google || !drawMode || !google.maps.drawing) return;

    if (drawingManagerRef.current) {
      drawingManagerRef.current.setMap(null);
      drawingManagerRef.current = null;
    }

    const color = draftColorRef.current;
    const pathOpts = googlePathOptions(color, { fillOpacity: 0.35, weight: 3 });
    const usePolygonDraw = drawMode === "polygon" && !draftGeometry;

    const dm = new google.maps.drawing.DrawingManager({
      map,
      drawingControl: false,
      drawingMode: usePolygonDraw
        ? google.maps.drawing.OverlayType.POLYGON
        : null,
      polygonOptions: { ...pathOpts, editable: true, draggable: true },
      circleOptions: { ...pathOpts, editable: true, draggable: true },
    });

    dm.addListener("overlaycomplete", (e) => {
      const overlay = e.overlay;
      dm.setDrawingMode(null);

      if (e.type === google.maps.drawing.OverlayType.POLYGON) {
        const polygon = overlay as GooglePolygonInstance;
        polygon.setEditable(true);
        const feature = featureFromPolygon(polygon);
        if (feature) {
          clearDraftOverlay();
          draftOverlayRef.current = polygon;
          bindPolygonEditListeners(polygon, (g, t) =>
            onDraftChangeRef.current?.(g, t),
          );
          onDraftChangeRef.current?.(feature, "polygon");
        }
      }
    });

    drawingManagerRef.current = dm;
    syncCircleClickPlacement();
  }, [drawMode, draftGeometry, clearDraftOverlay, syncCircleClickPlacement]);

  const handleClearShape = useCallback(() => {
    clearDraftOverlay();
    if (drawingManagerRef.current && googleRef.current) {
      const mode = drawModeRef.current;
      if (mode === "polygon") {
        drawingManagerRef.current.setDrawingMode(
          googleRef.current.maps.drawing.OverlayType.POLYGON,
        );
      } else {
        drawingManagerRef.current.setDrawingMode(null);
      }
      syncCircleClickPlacement();
    }
    onDraftChangeRef.current?.(
      null,
      drawModeRef.current === "circle" ? "circle" : "polygon",
    );
  }, [clearDraftOverlay, syncCircleClickPlacement]);

  const handleDeleteShape = useCallback(() => {
    handleClearShape();
  }, [handleClearShape]);

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

      googleRef.current = google;
      const map = new google.maps.Map(container, {
        center: tupleToLatLng(KUWAIT_MAP_CENTER),
        zoom: DEFAULT_MAP_ZOOM,
        disableDefaultUI: true,
        zoomControl: true,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        clickableIcons: false,
        gestureHandling: "greedy",
      });
      mapRef.current = map;
      onMapReady?.(
        createMapAdapter(map, google, {
          setDrawMode(mode) {
            if (!drawingManagerRef.current) return;
            if (!mode || draftOverlayRef.current) {
              drawingManagerRef.current.setDrawingMode(null);
              syncCircleClickPlacement();
              return;
            }
            if (mode === "circle") {
              drawingManagerRef.current.setDrawingMode(null);
              syncCircleClickPlacement();
              return;
            }
            drawingManagerRef.current.setDrawingMode(
              google.maps.drawing.OverlayType.POLYGON,
            );
            clearCircleClickListener();
          },
          setEditing(enabled) {
            if (!draftOverlayRef.current) return;
            draftOverlayRef.current.setEditable(enabled);
          },
          setDragging(enabled) {
            if (!draftOverlayRef.current) return;
            draftOverlayRef.current.setDraggable(enabled);
          },
          deleteSelected() {
            handleDeleteShape();
          },
          clearDraft() {
            handleClearShape();
          },
        }),
      );
      setMapState("ready");
    });

    return () => {
      cancelled = true;
      clearCircleClickListener();
      if (drawingManagerRef.current) {
        drawingManagerRef.current.setMap(null);
        drawingManagerRef.current = null;
      }
      clearDraftOverlay();
      clearZoneOverlays();
      clearZoneLabels();
      mapRef.current = null;
      googleRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount once
  }, [handleClearShape, handleDeleteShape, onMapReady, clearDraftOverlay, clearZoneOverlays, clearZoneLabels]);

  useEffect(() => {
    if (mapState !== "ready") return;
    if (drawMode) {
      clearZoneLabels();
      syncReferenceOverlays();
      if (draftGeometry) {
        if (!draftOverlayRef.current) {
          attachDraftFromGeometry(draftGeometry, draftZoneType, true);
        }
        if (drawingManagerRef.current) {
          drawingManagerRef.current.setDrawingMode(null);
        }
      } else {
        clearDraftOverlay();
        setupDrawingManager();
      }
    } else {
      if (drawingManagerRef.current) {
        drawingManagerRef.current.setMap(null);
        drawingManagerRef.current = null;
      }
      clearDraftOverlay();
      clearZoneLabels();
      syncBrowseOverlays();
      syncZoneLabels();
    }
  }, [
    mapState,
    drawMode,
    draftGeometry,
    draftZoneType,
    zones,
    selectedId,
    syncBrowseOverlays,
    syncReferenceOverlays,
    syncZoneLabels,
    attachDraftFromGeometry,
    setupDrawingManager,
    clearDraftOverlay,
    clearZoneLabels,
  ]);

  useEffect(() => {
    if (mapState !== "ready" || drawMode) return;
    syncZoneLabels();
  }, [mapState, drawMode, mapPrefs.showLabels, zones, syncZoneLabels]);

  useEffect(() => {
    if (mapState !== "ready" || draftZoneType !== "circle" || !draftGeometry) return;
    const center = draftGeometry.geometry;
    if (center.type !== "Point") return;
    const [lng, lat] = center.coordinates;
    const nextRadius = clampCircleRadiusMeters(draftCircleRadiusMeters);
    const currentRadius = draftGeometry.properties?.radiusMeters ?? 0;
    if (Math.abs(currentRadius - nextRadius) < 1) return;
    attachDraftFromGeometry(
      buildCircleFeature([lat, lng], nextRadius),
      "circle",
      true,
    );
    onDraftChangeRef.current?.(buildCircleFeature([lat, lng], nextRadius), "circle");
  }, [
    draftCircleRadiusMeters,
    draftGeometry,
    draftZoneType,
    mapState,
    attachDraftFromGeometry,
  ]);

  useEffect(() => {
    if (!draftOverlayRef.current || mapState !== "ready") return;
    const color = draftColorRef.current;
    draftOverlayRef.current.setOptions(googlePathOptions(color, { fillOpacity: 0.35, weight: 3 }));
  }, [draftColor, mapState]);

  useEffect(() => {
    if (mapState !== "ready" || drawMode) return;
    const map = mapRef.current;
    const google = googleRef.current;
    if (!map || !google) return;
    for (const o of zoneOverlaysRef.current) {
      const zone = zones.find((z) => z.id === o.id);
      if (!zone) continue;
      const selected = zone.id === selectedId;
      o.layer.setOptions(
        googlePathOptions(normalizeZoneColor(zone.color), {
          fillOpacity: selected ? 0.35 : 0.2,
          weight: selected ? 3 : 2,
        }),
      );
    }
    if (selectedId) {
      fitZonesBounds(map, google, selectedId);
    }
  }, [selectedId, mapState, drawMode, zones, fitZonesBounds]);

  if (mapState === "unavailable") {
    const failure = getGoogleMapsLoadFailure();
    return (
      <div
        className={
          className ??
          "flex h-full w-full flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-muted/30 px-4 py-6"
        }
      >
        <GoogleMapsStatusBanner className="max-w-md text-center" />
        {!failure ? (
          <p className="text-center text-xs text-muted-foreground">
            {t("hints.googleKeyMissing")}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className={className ?? "relative h-full w-full"}>
      <div ref={containerRef} className="h-full w-full rounded-xl" />
      {mapState === "loading" ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-muted">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : null}
      {mapState === "ready" ? (
        <>
          <div className="pointer-events-none absolute bottom-3 start-3 z-10">
            <ZoneMapLayersControl
              map={mapRef.current}
              google={googleRef.current}
              className="pointer-events-auto"
            />
          </div>
        </>
      ) : null}
    </div>
  );
}
