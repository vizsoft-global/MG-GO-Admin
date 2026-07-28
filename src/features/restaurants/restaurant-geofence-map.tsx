"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTranslations } from "next-intl";
import { Loader2, MapPin, PenLine } from "lucide-react";
import {
  getGoogleMapsLoadFailure,
  loadGoogleMaps,
  type GoogleCircleInstance,
  type GoogleMapInstance,
  type GoogleMapsApi,
  type GoogleMarkerInstance,
  type GooglePolygonInstance,
} from "@/lib/google-maps/load";
import {
  zoneMapBoundsFromShape,
  buildCircleFeature,
  MAX_RADIUS_METERS,
  MIN_RADIUS_METERS,
  type ZoneGeoFeature,
  type ZoneGeometryType,
} from "@/lib/geo/zone-geometry";
import { GoogleMapsStatusBanner } from "./google-maps-status-banner";
import { RestaurantPlaceSearch } from "./restaurant-place-search";
import type { RestaurantLocation } from "./restaurant-location-utils";
import type { RestaurantGeofenceDraft, RestaurantGeofenceKind } from "./types";
import {
  DEFAULT_MAP_ZOOM,
  KUWAIT_MAP_CENTER,
} from "@/features/zones/constants";
import {
  ZoneFormFindMyLocation,
  ZoneFormMapTypeToggle,
  ZoneFormZoomControls,
} from "@/features/zones/zone-form-map-controls";
import {
  ZoneFormMapToolbar,
  type ZoneMapTool,
} from "@/features/zones/zone-form-map-toolbar";
import type { ZoneMapAdapter } from "@/features/zones/zone-map-adapter";
import {
  bindCircleEditListeners,
  bindPolygonEditListeners,
  circleFromZoneFeature,
  featureFromPolygon,
  googlePathOptions,
  polygonFromFeature,
} from "@/features/zones/zone-map-google-utils";
import { cn } from "@/lib/utils";
import { defaultGeofenceColor } from "./restaurant-geofence-colors";

export type RestaurantMapMode = "pin" | "draw";

const DEFAULT_CIRCLE_RADIUS_METERS = 1000;

function clampCircleRadiusMeters(radius: number) {
  return Math.min(MAX_RADIUS_METERS, Math.max(MIN_RADIUS_METERS, radius));
}

function tupleToLatLng(center: [number, number]) {
  return { lat: center[0], lng: center[1] };
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
    invalidateSize() {},
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

export function RestaurantGeofenceMap({
  location,
  onLocationChange,
  geofences,
  selectedGeofenceId,
  onSelectGeofence,
  onGeofenceChange,
  onAddGeofence,
  onDeleteGeofence,
  drawKind,
  zoneType,
  mapMode,
  onMapModeChange,
  activeTool,
  onToolChange,
  onMapReady,
  className,
}: {
  location: RestaurantLocation | null;
  onLocationChange: (next: RestaurantLocation | null) => void;
  geofences: RestaurantGeofenceDraft[];
  selectedGeofenceId: string | null;
  onSelectGeofence: (id: string | null) => void;
  onGeofenceChange: (
    id: string,
    geometry: ZoneGeoFeature,
    zoneType: ZoneGeometryType,
  ) => void;
  onAddGeofence: (
    draft: Omit<RestaurantGeofenceDraft, "id">,
  ) => void;
  onDeleteGeofence: (id: string) => void;
  drawKind: RestaurantGeofenceKind;
  zoneType: ZoneGeometryType;
  mapMode: RestaurantMapMode;
  onMapModeChange: (mode: RestaurantMapMode) => void;
  activeTool: ZoneMapTool;
  onToolChange: (tool: ZoneMapTool) => void;
  onMapReady?: (adapter: ZoneMapAdapter) => void;
  className?: string;
}) {
  const t = useTranslations("pages.restaurants");
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<GoogleMapInstance | null>(null);
  const googleRef = useRef<GoogleMapsApi | null>(null);
  const markerRef = useRef<GoogleMarkerInstance | null>(null);
  const geofenceLayersRef = useRef<
    Map<string, GooglePolygonInstance | GoogleCircleInstance>
  >(new Map());
  const draftOverlayRef = useRef<GooglePolygonInstance | GoogleCircleInstance | null>(
    null,
  );
  const drawingManagerRef = useRef<
    import("@/lib/google-maps/load").GoogleDrawingManagerInstance | null
  >(null);
  const activeToolRef = useRef(activeTool);
  const onLocationChangeRef = useRef(onLocationChange);
  const onGeofenceChangeRef = useRef(onGeofenceChange);
  const onAddGeofenceRef = useRef(onAddGeofence);
  const onDeleteGeofenceRef = useRef(onDeleteGeofence);
  const onSelectGeofenceRef = useRef(onSelectGeofence);
  const drawKindRef = useRef(drawKind);
  const zoneTypeRef = useRef(zoneType);
  const mapModeRef = useRef(mapMode);
  const selectedGeofenceIdRef = useRef(selectedGeofenceId);
  const [mapAdapter, setMapAdapter] = useState<ZoneMapAdapter | null>(null);
  const [mapState, setMapState] = useState<"loading" | "ready" | "unavailable">(
    "loading",
  );

  onLocationChangeRef.current = onLocationChange;
  onGeofenceChangeRef.current = onGeofenceChange;
  onAddGeofenceRef.current = onAddGeofence;
  onDeleteGeofenceRef.current = onDeleteGeofence;
  onSelectGeofenceRef.current = onSelectGeofence;
  drawKindRef.current = drawKind;
  zoneTypeRef.current = zoneType;
  mapModeRef.current = mapMode;
  selectedGeofenceIdRef.current = selectedGeofenceId;
  activeToolRef.current = activeTool;

  const clearGeofenceLayers = useCallback(() => {
    for (const layer of geofenceLayersRef.current.values()) {
      layer.setMap(null);
    }
    geofenceLayersRef.current.clear();
  }, []);

  const clearDraftOverlay = useCallback(() => {
    if (draftOverlayRef.current) {
      draftOverlayRef.current.setMap(null);
      draftOverlayRef.current = null;
    }
  }, []);

  const syncMarker = useCallback(
    (google: GoogleMapsApi, map: GoogleMapInstance, loc: RestaurantLocation | null) => {
      if (loc) {
        const pos = { lat: loc.lat, lng: loc.lng };
        if (markerRef.current) {
          markerRef.current.setPosition(pos);
        } else {
          const marker = new google.maps.Marker({
            position: pos,
            map,
            draggable: true,
            title: t("fields.location"),
          });
          marker.addListener("dragend", () => {
            const p = marker.getPosition();
            if (p) {
              onLocationChangeRef.current({ lat: p.lat(), lng: p.lng() });
            }
          });
          markerRef.current = marker;
        }
      } else if (markerRef.current) {
        google.maps.event.clearInstanceListeners(markerRef.current);
        markerRef.current.setMap(null);
        markerRef.current = null;
      }
    },
    [t],
  );

  const renderGeofenceLayer = useCallback(
    (
      google: GoogleMapsApi,
      map: GoogleMapInstance,
      geofence: RestaurantGeofenceDraft,
      selected: boolean,
    ) => {
      const color = geofence.color;
      const common = {
        fillOpacity: selected ? 0.4 : 0.25,
        weight: selected ? 3 : 2,
        clickable: true,
      };

      let layer: GooglePolygonInstance | GoogleCircleInstance | null = null;

      if (geofence.zone_type === "circle") {
        layer = circleFromZoneFeature(google, map, geofence.geometry, color, {
          ...common,
          editable: selected && mapModeRef.current === "draw",
        });
      } else {
        layer = polygonFromFeature(google, map, geofence.geometry, color, {
          ...common,
          editable: selected && mapModeRef.current === "draw",
        });
      }

      if (!layer) return null;

      if (selected && activeTool === "move") {
        layer.setDraggable(true);
      }

      layer.addListener("click", () => {
        onSelectGeofenceRef.current(geofence.id);
      });

      if (selected && mapModeRef.current === "draw") {
        if (geofence.zone_type === "circle") {
          bindCircleEditListeners(layer as GoogleCircleInstance, (g, type) => {
            onGeofenceChangeRef.current(geofence.id, g, type);
          });
        } else {
          bindPolygonEditListeners(layer as GooglePolygonInstance, (g, type) => {
            onGeofenceChangeRef.current(geofence.id, g, type);
          });
        }
      }

      return layer;
    },
    [activeTool],
  );

  const syncGeofenceLayers = useCallback(() => {
    const map = mapRef.current;
    const google = googleRef.current;
    if (!map || !google || mapState !== "ready") return;

    clearGeofenceLayers();

    for (const geofence of geofences) {
      const layer = renderGeofenceLayer(
        google,
        map,
        geofence,
        geofence.id === selectedGeofenceIdRef.current,
      );
      if (layer) {
        geofenceLayersRef.current.set(geofence.id, layer);
      }
    }
  }, [geofences, clearGeofenceLayers, renderGeofenceLayer, mapState]);

  const setupDrawingManager = useCallback(() => {
    const map = mapRef.current;
    const google = googleRef.current;
    if (!map || !google || !google.maps.drawing || mapModeRef.current !== "draw") {
      return;
    }

    if (drawingManagerRef.current) {
      drawingManagerRef.current.setMap(null);
      drawingManagerRef.current = null;
    }

    const color = defaultGeofenceColor(drawKindRef.current);
    const pathOpts = googlePathOptions(color, { fillOpacity: 0.35, weight: 3 });

    const dm = new google.maps.drawing.DrawingManager({
      map,
      drawingControl: false,
      drawingMode:
        activeTool === "draw" && zoneTypeRef.current === "polygon"
          ? google.maps.drawing.OverlayType.POLYGON
          : null,
      polygonOptions: { ...pathOpts, editable: true, draggable: true },
      circleOptions: { ...pathOpts, editable: true, draggable: true },
    });

    dm.addListener("overlaycomplete", (e) => {
      const overlay = e.overlay;
      dm.setDrawingMode(null);

      if (e.type === google.maps.drawing.OverlayType.POLYGON) {
        const feature = featureFromPolygon(overlay as GooglePolygonInstance);
        if (feature) {
          overlay.setMap(null);
          onAddGeofenceRef.current({
            kind: drawKindRef.current,
            zone_type: "polygon",
            geometry: feature,
            name: null,
            color: defaultGeofenceColor(drawKindRef.current),
          });
        } else {
          overlay.setMap(null);
        }
      }
    });

    drawingManagerRef.current = dm;
  }, [activeTool]);

  const handleDeleteSelected = useCallback(() => {
    const id = selectedGeofenceIdRef.current;
    if (id) {
      onDeleteGeofenceRef.current(id);
      onSelectGeofenceRef.current(null);
    }
  }, []);

  const handleClearDraft = useCallback(() => {
    clearDraftOverlay();
    onSelectGeofenceRef.current(null);
    onToolChange("draw");
    setupDrawingManager();
  }, [clearDraftOverlay, onToolChange, setupDrawingManager]);

  const handleDeleteSelectedRef = useRef(handleDeleteSelected);
  const handleClearDraftRef = useRef(handleClearDraft);
  handleDeleteSelectedRef.current = handleDeleteSelected;
  handleClearDraftRef.current = handleClearDraft;

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
      const center = location
        ? { lat: location.lat, lng: location.lng }
        : tupleToLatLng(KUWAIT_MAP_CENTER);
      const zoom = location ? 16 : DEFAULT_MAP_ZOOM;

      const map = new google.maps.Map(container, {
        center,
        zoom,
        disableDefaultUI: true,
        zoomControl: true,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        clickableIcons: false,
        gestureHandling: "greedy",
      });
      mapRef.current = map;

      google.maps.event.addListener(map, "click", (e) => {
        const latLng = e.latLng;
        if (!latLng) return;

        if (mapModeRef.current === "pin") {
          onSelectGeofenceRef.current(null);
          onLocationChangeRef.current({
            lat: latLng.lat(),
            lng: latLng.lng(),
          });
          return;
        }

        if (
          mapModeRef.current === "draw" &&
          activeToolRef.current === "draw" &&
          zoneTypeRef.current === "circle"
        ) {
          const feature = buildCircleFeature(
            [latLng.lat(), latLng.lng()],
            clampCircleRadiusMeters(DEFAULT_CIRCLE_RADIUS_METERS),
          );
          onAddGeofenceRef.current({
            kind: drawKindRef.current,
            zone_type: "circle",
            geometry: feature,
            name: null,
            color: defaultGeofenceColor(drawKindRef.current),
          });
          return;
        }

        onSelectGeofenceRef.current(null);
      });

      syncMarker(google, map, location);
      onMapReady?.(
        createMapAdapter(map, google, {
          setDrawMode(mode) {
            if (!drawingManagerRef.current) return;
            if (!mode) {
              drawingManagerRef.current.setDrawingMode(null);
              return;
            }
            if (mode === "circle") {
              drawingManagerRef.current.setDrawingMode(null);
              return;
            }
            drawingManagerRef.current.setDrawingMode(
              google.maps.drawing.OverlayType.POLYGON,
            );
          },
          setEditing(enabled) {
            const id = selectedGeofenceIdRef.current;
            if (!id) return;
            const layer = geofenceLayersRef.current.get(id);
            layer?.setEditable(enabled);
          },
          setDragging(enabled) {
            const id = selectedGeofenceIdRef.current;
            if (!id) return;
            const layer = geofenceLayersRef.current.get(id);
            layer?.setDraggable(enabled);
          },
          deleteSelected: () => handleDeleteSelectedRef.current(),
          clearDraft: () => handleClearDraftRef.current(),
        }),
      );
      setMapAdapter(createMapAdapter(map, google));
      setMapState("ready");
    });

    return () => {
      cancelled = true;
      setMapState("loading");
      if (drawingManagerRef.current) {
        drawingManagerRef.current.setMap(null);
        drawingManagerRef.current = null;
      }
      clearGeofenceLayers();
      clearDraftOverlay();
      if (markerRef.current && googleRef.current) {
        googleRef.current.maps.event.clearInstanceListeners(markerRef.current);
        markerRef.current.setMap(null);
        markerRef.current = null;
      }
      mapRef.current = null;
      googleRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount once; handlers via refs
  }, [onMapReady, clearDraftOverlay, clearGeofenceLayers, syncMarker]);

  useEffect(() => {
    const google = googleRef.current;
    const map = mapRef.current;
    if (!google || !map || mapState !== "ready") return;
    syncMarker(google, map, location);
    if (location) {
      map.panTo({ lat: location.lat, lng: location.lng });
    }
  }, [location, mapState, syncMarker]);

  useEffect(() => {
    if (mapState !== "ready") return;
    syncGeofenceLayers();
  }, [mapState, geofences, selectedGeofenceId, syncGeofenceLayers]);

  useEffect(() => {
    if (mapState !== "ready") return;

    if (mapMode === "draw") {
      setupDrawingManager();
    } else if (drawingManagerRef.current) {
      drawingManagerRef.current.setMap(null);
      drawingManagerRef.current.setDrawingMode(null);
    }
  }, [mapMode, zoneType, activeTool, mapState, setupDrawingManager]);

  useEffect(() => {
    const adapter = mapAdapter;
    if (!adapter) return;
    if (activeTool === "draw" && mapMode === "draw") {
      adapter.setDrawMode?.(zoneType);
      adapter.setEditing?.(false);
      adapter.setDragging?.(false);
    } else if (activeTool === "edit") {
      adapter.setDrawMode?.(null);
      adapter.setDragging?.(false);
      adapter.setEditing?.(true);
    } else if (activeTool === "move") {
      adapter.setDrawMode?.(null);
      adapter.setEditing?.(false);
      adapter.setDragging?.(true);
    } else if (activeTool === "delete") {
      handleDeleteSelected();
      onToolChange("edit");
    } else if (activeTool === "clear") {
      handleClearDraft();
    }
  }, [
    activeTool,
    zoneType,
    mapMode,
    mapAdapter,
    handleDeleteSelected,
    handleClearDraft,
    onToolChange,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    const google = googleRef.current;
    if (!map || !google || mapState !== "ready") return;

    const bounds = new google.maps.LatLngBounds();
    let hasPoint = false;

    if (location) {
      bounds.extend({ lat: location.lat, lng: location.lng });
      hasPoint = true;
    }

    for (const geofence of geofences) {
      const corners = zoneMapBoundsFromShape(
        geofence.zone_type,
        geofence.geometry,
      );
      if (!corners) continue;
      for (const [lat, lng] of corners) {
        bounds.extend({ lat, lng });
        hasPoint = true;
      }
    }

    if (!hasPoint) return;

    if (geofences.length === 0 && location) {
      map.setCenter({ lat: location.lat, lng: location.lng });
      map.setZoom(16);
      return;
    }

    map.fitBounds(bounds, 48);
  }, [location, geofences, mapState]);

  if (mapState === "unavailable") {
    const failure = getGoogleMapsLoadFailure();
    return (
      <div
        className={cn(
          "flex h-full w-full flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-muted/30 px-4 py-6",
          className,
        )}
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
    <div className={cn("relative h-full min-h-0 w-full", className)}>
      <div ref={containerRef} className="h-full w-full" />

      {mapState === "loading" ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-muted">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : null}

      {mapState === "ready" ? (
        <>
          <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex flex-wrap items-start justify-between gap-2 p-3">
            <div className="pointer-events-auto flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-md dark:border-slate-700 dark:bg-slate-900">
                <button
                  type="button"
                  onClick={() => onMapModeChange("pin")}
                  className={cn(
                    "inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-xs font-medium",
                    mapMode === "pin"
                      ? "bg-primary/10 text-primary ring-1 ring-primary/30"
                      : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800",
                  )}
                >
                  <MapPin className="h-4 w-4" />
                  {t("geofences.toolbar.pin")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onMapModeChange("draw");
                    onToolChange("draw");
                  }}
                  className={cn(
                    "inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-xs font-medium",
                    mapMode === "draw"
                      ? "bg-primary/10 text-primary ring-1 ring-primary/30"
                      : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800",
                  )}
                >
                  <PenLine className="h-4 w-4" />
                  {t("geofences.toolbar.draw")}
                </button>
              </div>
              {mapMode === "draw" ? (
                <ZoneFormMapToolbar
                  activeTool={activeTool}
                  onToolChange={onToolChange}
                  tools={["move", "delete", "clear"]}
                  labels={{
                    move: t("geofences.toolbar.move"),
                    delete: t("geofences.toolbar.delete"),
                    clear: t("geofences.toolbar.clear"),
                  }}
                />
              ) : null}
            </div>
          </div>

          <div className="pointer-events-none absolute start-3 end-3 top-16 z-20 flex flex-col gap-2 md:top-14 md:w-72">
            <div className="pointer-events-auto">
              <GoogleMapsStatusBanner />
            </div>
            <div className="pointer-events-auto">
              <RestaurantPlaceSearch
                onSelect={onLocationChange}
                placeholder={t("placeholders.searchPlace")}
                keyMissingHint={t("hints.googleKeyMissing")}
              />
            </div>
          </div>

          <div className="pointer-events-none absolute end-3 top-32 z-20 flex flex-col items-end gap-2">
            <div className="pointer-events-auto">
              <ZoneFormMapTypeToggle adapter={mapAdapter} />
            </div>
            <div className="pointer-events-auto">
              <ZoneFormZoomControls adapter={mapAdapter} />
            </div>
            <div className="pointer-events-auto">
              <ZoneFormFindMyLocation adapter={mapAdapter} />
            </div>
          </div>

          <p className="pointer-events-none absolute start-3 bottom-3 z-10 max-w-[min(320px,70%)] rounded-md bg-background/90 px-2 py-1 text-[10px] text-muted-foreground shadow-sm backdrop-blur-sm">
            {mapMode === "pin"
              ? t("hints.pickLocation")
              : t("geofences.drawHint")}
          </p>
        </>
      ) : null}
    </div>
  );
}
