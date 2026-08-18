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
  buildPolygonFeature,
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
import {
  createPolygonDrawController,
  POLYGON_OVERLAY_TYPE,
  type PolygonDrawController,
} from "./polygon-draw-controller";
import type { ZoneDraftGeometryMeta } from "./zone-draft-geometry";

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
    meta?: ZoneDraftGeometryMeta,
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
  const drawingManagerRef = useRef<PolygonDrawController | null>(null);
  const circleClickListenerRef = useRef<{ remove: () => void } | null>(null);
  const onDraftChangeRef = useRef(onDraftGeometryChange);
  const drawModeRef = useRef(drawMode);
  const draftCircleRadiusRef = useRef(
    clampCircleRadiusMeters(draftCircleRadiusMeters),
  );
  const draftColorRef = useRef(normalizeZoneColor(draftColor));
  const [draftVertexCount, setDraftVertexCount] = useState(0);
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

  const syncCircleClickPlacementRef = useRef(syncCircleClickPlacement);
  syncCircleClickPlacementRef.current = syncCircleClickPlacement;

  const setupDrawingManager = useCallback(() => {
    const map = mapRef.current;
    const google = googleRef.current;
    const activeDrawMode = drawModeRef.current ?? drawMode;
    if (!map || !google || !activeDrawMode) return;

    // Reuse an existing controller so React effect re-runs do not wipe
    // in-progress vertices (that left Save disabled while a preview was visible).
    if (drawingManagerRef.current) {
      const usePolygonDraw =
        activeDrawMode === "polygon" && !draftOverlayRef.current;
      drawingManagerRef.current.setDrawingMode(
        usePolygonDraw ? POLYGON_OVERLAY_TYPE : null,
      );
      syncCircleClickPlacementRef.current();
      return;
    }

    const color = draftColorRef.current;
    const pathOpts = googlePathOptions(color, { fillOpacity: 0.35, weight: 3 });
    const usePolygonDraw = activeDrawMode === "polygon" && !draftGeometry;

    const dm = createPolygonDrawController(google, map, {
      polygonOptions: { ...pathOpts, editable: true, draggable: true },
      onVertexCountChange: setDraftVertexCount,
      onProvisionalPaths: (paths) => {
        // Enable Save as soon as a valid ring exists — users often stop after
        // drawing without double-clicking / closing on the first point.
        // Also covers Escape → reset() → null (mid-sketch clear); keep draw tool.
        if (!paths || paths.length < 3) {
          if (!draftOverlayRef.current) {
            onDraftChangeRef.current?.(null, "polygon", { provisional: true });
          }
          return;
        }
        if (draftOverlayRef.current) return;
        const feature = buildPolygonFeature(
          paths.map((p) => [p.lat, p.lng] as [number, number]),
        );
        onDraftChangeRef.current?.(feature, "polygon", { provisional: true });
      },
    });

    dm.setDrawingMode(usePolygonDraw ? POLYGON_OVERLAY_TYPE : null);

    dm.addListener("overlaycomplete", (e) => {
      const polygon = e.overlay;
      dm.setDrawingMode(null);
      setDraftVertexCount(0);

      polygon.setEditable(true);
      const feature = featureFromPolygon(polygon);
      if (feature) {
        clearDraftOverlay();
        draftOverlayRef.current = polygon;
        bindPolygonEditListeners(polygon, (g, t) =>
          onDraftChangeRef.current?.(g, t),
        );
        onDraftChangeRef.current?.(feature, "polygon", { provisional: false });
      } else {
        polygon.setMap(null);
      }
    });

    drawingManagerRef.current = dm;
    syncCircleClickPlacementRef.current();
  }, [drawMode, draftGeometry, clearDraftOverlay]);

  const handleClearShape = useCallback(() => {
    clearDraftOverlay();
    drawingManagerRef.current?.clearDraft();
    setDraftVertexCount(0);
    if (drawingManagerRef.current && googleRef.current) {
      const mode = drawModeRef.current;
      drawingManagerRef.current.setDrawingMode(
        mode === "polygon" ? POLYGON_OVERLAY_TYPE : null,
      );
      syncCircleClickPlacementRef.current();
    }
    onDraftChangeRef.current?.(
      null,
      drawModeRef.current === "circle" ? "circle" : "polygon",
    );
  }, [clearDraftOverlay]);

  const handleClearShapeRef = useRef(handleClearShape);
  const handleDeleteShapeRef = useRef(() => {
    handleClearShapeRef.current();
  });
  const setupDrawingManagerRef = useRef(setupDrawingManager);
  const onMapReadyRef = useRef(onMapReady);
  const clearDraftOverlayRef = useRef(clearDraftOverlay);
  const clearZoneOverlaysRef = useRef(clearZoneOverlays);
  const clearZoneLabelsRef = useRef(clearZoneLabels);
  const clearCircleClickListenerRef = useRef(clearCircleClickListener);

  handleClearShapeRef.current = handleClearShape;
  setupDrawingManagerRef.current = setupDrawingManager;
  onMapReadyRef.current = onMapReady;
  clearDraftOverlayRef.current = clearDraftOverlay;
  clearZoneOverlaysRef.current = clearZoneOverlays;
  clearZoneLabelsRef.current = clearZoneLabels;
  clearCircleClickListenerRef.current = clearCircleClickListener;

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
        zoomControl: false,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        clickableIcons: false,
        gestureHandling: "greedy",
      });
      mapRef.current = map;
      onMapReadyRef.current?.(
        createMapAdapter(map, google, {
          setDrawMode(mode) {
            if (!mode) {
              if (drawingManagerRef.current) {
                drawingManagerRef.current.setDrawingMode(null);
              }
              syncCircleClickPlacementRef.current();
              return;
            }
            // Keep ref in sync before syncCircleClickPlacement / setupDrawingManager
            // so mid-switch calls (e.g. Polygon → Circle) see the intended mode.
            drawModeRef.current = mode;
            if (draftOverlayRef.current) {
              drawingManagerRef.current?.setDrawingMode(null);
              syncCircleClickPlacementRef.current();
              return;
            }
            if (!drawingManagerRef.current) {
              setupDrawingManagerRef.current();
            }
            if (!drawingManagerRef.current) return;
            if (mode === "circle") {
              drawingManagerRef.current.setDrawingMode(null);
              syncCircleClickPlacementRef.current();
              return;
            }
            drawingManagerRef.current.setDrawingMode(POLYGON_OVERLAY_TYPE);
            clearCircleClickListenerRef.current();
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
            handleDeleteShapeRef.current();
          },
          clearDraft() {
            handleClearShapeRef.current();
          },
        }),
      );
      setMapState("ready");
    });

    return () => {
      cancelled = true;
      setMapState("loading");
      clearCircleClickListenerRef.current();
      if (drawingManagerRef.current) {
        drawingManagerRef.current.setMap(null);
        drawingManagerRef.current = null;
      }
      clearDraftOverlayRef.current();
      clearZoneOverlaysRef.current();
      clearZoneLabelsRef.current();
      mapRef.current = null;
      googleRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount once; handlers via refs
  }, []);

  useEffect(() => {
    if (mapState !== "ready") return;
    if (drawMode) {
      clearZoneLabels();
      syncReferenceOverlays();
      const sketching = Boolean(drawingManagerRef.current?.isDrawing());

      if (draftOverlayRef.current) {
        // Finalized overlay on the map — stop click-to-draw.
        drawingManagerRef.current?.setDrawingMode(null);
      } else if (draftGeometry && !sketching) {
        // Loaded / restored geometry (edit) with no live sketch.
        attachDraftFromGeometry(draftGeometry, draftZoneType, true);
        drawingManagerRef.current?.setDrawingMode(null);
      } else if (!draftGeometry && !sketching) {
        // Fresh draw — ensure a controller exists (do not recreate mid-sketch).
        clearDraftOverlay();
        setupDrawingManager();
      } else {
        // Provisional geometry from an in-progress sketch (≥3 vertices):
        // keep the draw controller so the user can still finish / add points.
        setupDrawingManager();
      }
    } else {
      if (drawingManagerRef.current) {
        drawingManagerRef.current.clearDraft();
        drawingManagerRef.current.setMap(null);
        drawingManagerRef.current = null;
      }
      setDraftVertexCount(0);
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
          {drawMode === "polygon" && draftVertexCount > 0 ? (
            <div className="pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center px-3">
              <div className="flex max-w-lg flex-wrap items-center justify-center gap-2">
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] font-medium text-amber-900 shadow-sm dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
                  {t("polygonFinishHint")}
                </p>
                {draftVertexCount >= 3 ? (
                  <button
                    type="button"
                    className="pointer-events-auto h-9 cursor-pointer rounded-lg border border-emerald-300 bg-emerald-50 px-3 text-xs font-semibold text-emerald-900 shadow-sm transition-colors hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200 dark:hover:bg-emerald-950"
                    onClick={() => {
                      drawingManagerRef.current?.finishDraft();
                    }}
                  >
                    {t("geometryReady")}
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
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
