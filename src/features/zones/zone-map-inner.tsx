"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  Circle,
  MapContainer,
  Polygon,
  TileLayer,
  Tooltip,
  useMap,
  ZoomControl,
} from "react-leaflet";
import L from "leaflet";
import "@geoman-io/leaflet-geoman-free";
import "@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css";
import "leaflet/dist/leaflet.css";
import type { ZoneGeoFeature, ZoneGeometryType } from "@/lib/geo/zone-geometry";
import {
  circleFromFeature,
  polygonPositionsFromFeature,
  zoneMapBoundsFromShape,
} from "@/lib/geo/zone-geometry";
import {
  addZoneLayerToMap,
  applyZoneLayerStyle,
  geomanDrawOptions,
  isPmVectorLayer,
  isZoneDraftLayer,
  markZoneDraftLayer,
  parseLayerToZone,
  removeZoneDraftLayers,
} from "./zone-map-geoman";
import {
  DEFAULT_MAP_ZOOM,
  getZoneMapTileProps,
  KUWAIT_MAP_CENTER,
  ZONE_REFERENCE_FILL_OPACITY,
  ZONE_REFERENCE_STROKE_OPACITY,
} from "./constants";
import { normalizeZoneColor, zonePathStyle } from "./zone-colors";
import type { ZoneRow } from "./types";
import { ZoneLiveDriversLeaflet } from "./zone-live-drivers-leaflet";
import type { ZoneMapAdapter } from "./zone-map-adapter";

function FitBounds({ zones, selectedId }: { zones: ZoneRow[]; selectedId: string | null }) {
  const map = useMap();

  useEffect(() => {
    let cancelled = false;

    const fit = () => {
      if (cancelled) return;

      const { x, y } = map.getSize();
      if (x === 0 || y === 0) return;

      const latlngs: L.LatLngExpression[] = [];

      if (selectedId) {
        const target = zones.find((z) => z.id === selectedId);
        if (target?.geometry) {
          const corners = zoneMapBoundsFromShape(target.zone_type, target.geometry);
          if (corners) latlngs.push(...corners);
        }
      } else {
        for (const z of zones) {
          if (!z.geometry) continue;
          const corners = zoneMapBoundsFromShape(z.zone_type, z.geometry);
          if (corners) latlngs.push(...corners);
        }
      }

      if (latlngs.length === 0) return;

      const bounds = L.latLngBounds(latlngs);
      if (!bounds.isValid()) return;

      map.fitBounds(bounds, { padding: [48, 48], maxZoom: 15 });
    };

    map.whenReady(fit);
    return () => {
      cancelled = true;
    };
  }, [map, zones, selectedId]);

  return null;
}

function ZoneOverlay({
  zone,
  selected,
  variant = "default",
}: {
  zone: ZoneRow;
  selected: boolean;
  variant?: "default" | "reference";
}) {
  if (!zone.geometry) return null;

  const isReference = variant === "reference";
  const zoneColor = normalizeZoneColor(zone.color);
  const pathOptions = {
    ...zonePathStyle(zoneColor, {
      fillOpacity: isReference
        ? ZONE_REFERENCE_FILL_OPACITY
        : selected
          ? 0.35
          : 0.2,
      weight: isReference ? 1.5 : selected ? 3 : 2,
      strokeOpacity: isReference ? ZONE_REFERENCE_STROKE_OPACITY : 1,
      dashArray: isReference ? "6 4" : undefined,
    }),
    ...(isReference ? { pmIgnore: true } : {}),
  } as L.PathOptions;

  const tooltip = (
    <Tooltip direction="top" offset={[0, -4]} opacity={0.92}>
      {zone.name}
    </Tooltip>
  );

  if (zone.zone_type === "circle") {
    const circle = circleFromFeature(zone.geometry);
    if (!circle) return null;
    return (
      <Circle
        center={circle.center}
        radius={circle.radiusMeters}
        interactive={!isReference}
        pathOptions={pathOptions}
      >
        {tooltip}
      </Circle>
    );
  }

  const positions = polygonPositionsFromFeature(zone.geometry);
  if (positions.length < 3) return null;

  return (
    <Polygon
      positions={positions}
      interactive={!isReference}
      pathOptions={pathOptions}
    >
      {tooltip}
    </Polygon>
  );
}

export type ZoneMapDrawMode = "polygon" | "circle" | null;

function LeafletMapAdapterBridge({
  onMapAdapterReady,
}: {
  onMapAdapterReady?: (adapter: ZoneMapAdapter) => void;
}) {
  const map = useMap();

  useEffect(() => {
    if (!onMapAdapterReady) return;
    onMapAdapterReady({
      panTo(lat, lng, zoom = 14) {
        map.setView([lat, lng], zoom);
      },
      fitViewport(viewport) {
        map.fitBounds(
          [
            [viewport.south, viewport.west],
            [viewport.north, viewport.east],
          ],
          { padding: [48, 48], maxZoom: 15 },
        );
      },
      invalidateSize() {
        map.invalidateSize({ animate: false });
      },
      setDrawMode() {
        // Drawing controls are available only when draw mode is enabled.
      },
      setEditing() {
        // Drawing controls are available only when draw mode is enabled.
      },
      setDragging() {
        // Drawing controls are available only when draw mode is enabled.
      },
      deleteSelected() {
        // Drawing controls are available only when draw mode is enabled.
      },
      clearDraft() {
        // Drawing controls are available only when draw mode is enabled.
      },
    });
  }, [map, onMapAdapterReady]);

  return null;
}

function MapInvalidateSize({ active }: { active?: boolean }) {
  const map = useMap();

  useEffect(() => {
    const resize = () => {
      map.invalidateSize({ animate: false });
    };

    resize();
    const t1 = window.setTimeout(resize, 100);
    const t2 = window.setTimeout(resize, 400);
    const t3 = window.setTimeout(resize, 800);

    const container = map.getContainer();
    const observeTarget = container.parentElement ?? container;
    let observer: ResizeObserver | undefined;

    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => resize());
      observer.observe(observeTarget);
    }

    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
      observer?.disconnect();
    };
  }, [map, active]);

  return null;
}

function GeomanDrawControl({
  drawMode,
  draftColor,
  draftGeometry,
  draftZoneType,
  onGeometryChange,
  onMapReady,
  onMapAdapterReady,
}: {
  drawMode: ZoneMapDrawMode;
  draftColor: string;
  draftGeometry: ZoneGeoFeature | null;
  draftZoneType: ZoneGeometryType;
  onGeometryChange: (
    geometry: ZoneGeoFeature | null,
    zoneType: ZoneGeometryType,
  ) => void;
  onMapReady?: (map: L.Map) => void;
  onMapAdapterReady?: (adapter: ZoneMapAdapter) => void;
}) {
  const map = useMap();
  const onGeometryChangeRef = useRef(onGeometryChange);
  const activeLayerRef = useRef<L.Layer | null>(null);
  const drawModeRef = useRef(drawMode);
  const detachAttachedLayerHandlersRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    drawModeRef.current = drawMode;
  }, [drawMode]);

  useEffect(() => {
    onGeometryChangeRef.current = onGeometryChange;
  });

  useEffect(() => {
    onMapReady?.(map);
    onMapAdapterReady?.({
      panTo(lat, lng, zoom = 14) {
        map.setView([lat, lng], zoom);
      },
      fitViewport(viewport) {
        map.fitBounds(
          [
            [viewport.south, viewport.west],
            [viewport.north, viewport.east],
          ],
          { padding: [48, 48], maxZoom: 15 },
        );
      },
      invalidateSize() {
        map.invalidateSize({ animate: false });
      },
      setDrawMode(mode) {
        drawModeRef.current = mode;
        if (!mode) {
          try {
            map.pm?.disableDraw();
          } catch {
            /* ignore */
          }
          return;
        }
        syncDrawingMode();
      },
      setEditing(enabled) {
        try {
          if (enabled) map.pm?.enableGlobalEditMode();
          else map.pm?.disableGlobalEditMode();
        } catch {
          /* ignore */
        }
      },
      setDragging(enabled) {
        try {
          if (enabled) map.pm?.enableGlobalDragMode();
          else map.pm?.disableGlobalDragMode();
        } catch {
          /* ignore */
        }
      },
      deleteSelected() {
        const layer = activeLayerRef.current;
        if (!layer) return;
        try {
          map.removeLayer(layer);
        } catch {
          /* ignore */
        }
        clearActiveLayer();
        syncDrawingMode();
      },
      clearDraft() {
        removeZoneDraftLayers(map);
        clearActiveLayer();
        syncDrawingMode();
      },
    });
  }, [map, onMapReady, onMapAdapterReady]);

  const syncLayerGeometry = (layer: L.Layer, shape: string) => {
    const parsed = parseLayerToZone(layer, shape);
    if (parsed) {
      onGeometryChangeRef.current(parsed.geometry, parsed.zoneType);
    }
  };

  const syncDrawingModeRef = useRef<() => void>(() => {});

  const clearActiveLayer = () => {
    detachAttachedLayerHandlersRef.current?.();
    detachAttachedLayerHandlersRef.current = null;
    activeLayerRef.current = null;
    onGeometryChangeRef.current(
      null,
      drawModeRef.current === "circle" ? "circle" : "polygon",
    );
  };

  const attachActiveLayer = (layer: L.Layer, shape: string) => {
    detachAttachedLayerHandlersRef.current?.();
    detachAttachedLayerHandlersRef.current = null;
    markZoneDraftLayer(layer);
    activeLayerRef.current = layer;
    applyZoneLayerStyle(layer, draftColor);

    if (isPmVectorLayer(layer)) {
      try {
        (layer as L.Layer & { pm: { enable: () => void } }).pm.enable();
      } catch {
        /* Geoman may already have edit enabled */
      }
    }

    const onUpdate = () => syncLayerGeometry(layer, shape);
    const onRemove = () => {
      clearActiveLayer();
      syncDrawingModeRef.current();
    };
    layer.on("pm:update", onUpdate);
    layer.on("pm:edit", onUpdate);
    layer.on("pm:change", onUpdate);
    layer.on("pm:remove", onRemove);
    syncLayerGeometry(layer, shape);

    detachAttachedLayerHandlersRef.current = () => {
      layer.off("pm:update", onUpdate);
      layer.off("pm:edit", onUpdate);
      layer.off("pm:change", onUpdate);
      layer.off("pm:remove", onRemove);
    };
  };

  useEffect(() => {
    if (!drawMode) return;

    if (!draftGeometry) {
      detachAttachedLayerHandlersRef.current?.();
      detachAttachedLayerHandlersRef.current = null;
      if (activeLayerRef.current) {
        map.removeLayer(activeLayerRef.current);
        activeLayerRef.current = null;
      }
      return;
    }

    if (activeLayerRef.current) return;

    const restored = addZoneLayerToMap(map, draftGeometry, draftZoneType, draftColor);
    if (!restored) return;

    const shape = draftZoneType === "circle" ? "Circle" : "Polygon";
    attachActiveLayer(restored, shape);

    return () => {
      detachAttachedLayerHandlersRef.current?.();
      detachAttachedLayerHandlersRef.current = null;
    };
  }, [map, drawMode, draftColor, draftGeometry, draftZoneType]);

  useEffect(() => {
    if (activeLayerRef.current) {
      applyZoneLayerStyle(activeLayerRef.current, draftColor);
    }
  }, [draftColor]);

  const syncDrawingMode = () => {
    const mode = drawModeRef.current;
    if (!mode || !map.pm) return;
    const hasShape = Boolean(activeLayerRef.current);
    const opts = geomanDrawOptions(mode);
    try {
      map.pm.disableDraw();
      if (!hasShape) {
        map.pm.enableDraw(opts.shape, opts.options);
      }
    } catch {
      /* ignore */
    }
  };
  syncDrawingModeRef.current = syncDrawingMode;

  useEffect(() => {
    if (!drawMode) return;

    const setupControls = () => {
      if (!map.pm) return;

      map.invalidateSize({ animate: false });
      try {
        map.pm.setLang("en");
      } catch {
        /* ignore */
      }
      map.pm.setGlobalOptions({
        allowSelfIntersection: true,
        snappable: true,
      });

      map.pm.removeControls();
      map.pm.addControls({
        position: "bottomright",
        drawControls: false,
        drawCircle: false,
        drawPolygon: false,
        drawMarker: false,
        drawPolyline: false,
        drawRectangle: false,
        drawCircleMarker: false,
        drawText: false,
        editMode: true,
        dragMode: false,
        cutPolygon: false,
        removalMode: false,
        rotateMode: false,
      });

      try {
        if (map.pm.Toolbar.controlExists("zoneClear")) {
          map.pm.Toolbar.deleteControl("zoneClear");
        }
        map.pm.Toolbar.createCustomControl({
          name: "zoneClear",
          block: "custom",
          title: "Clear shape",
          className: "leaflet-pm-icon-delete",
          toggle: false,
          onClick: () => {
            const layer = activeLayerRef.current;
            if (layer) {
              try {
                map.removeLayer(layer);
              } catch {
                /* ignore */
              }
            }
            removeZoneDraftLayers(map);
            clearActiveLayer();
            syncDrawingMode();
          },
        });
      } catch {
        /* ignore */
      }
    };

    const finishLayer = (layer: L.Layer, shape: string) => {
      removeZoneDraftLayers(map, layer);
      attachActiveLayer(layer, shape);
      try {
        map.pm?.disableDraw();
        map.pm?.disableGlobalEditMode();
        map.pm?.disableGlobalRemovalMode();
      } catch {
        /* ignore */
      }
    };

    const handleCreate: L.LeafletEventHandlerFn = (event) => {
      const e = event as L.LeafletEvent & {
        layer?: L.Layer;
        marker?: L.Layer;
        shape?: string;
      };
      const layer = e.layer ?? e.marker;
      if (!layer) return;

      const shapeGuess = drawModeRef.current === "circle" ? "Circle" : "Polygon";
      const shape =
        typeof e.shape === "string" && e.shape.trim().length > 0 ? e.shape : shapeGuess;

      finishLayer(layer, shape);
    };

    const handleRemove: L.LeafletEventHandlerFn = (event) => {
      const e = event as L.LeafletEvent & { layer?: L.Layer };
      if (!e.layer) return;
      if (e.layer === activeLayerRef.current || isZoneDraftLayer(e.layer)) {
        clearActiveLayer();
        syncDrawingMode();
      }
    };

    const handleGlobalEditToggled: L.LeafletEventHandlerFn = (event) => {
      const e = event as L.LeafletEvent & { enabled?: boolean };
      if (e.enabled) {
        try {
          map.pm?.disableDraw();
        } catch {
          /* ignore */
        }
      } else if (!activeLayerRef.current) {
        syncDrawingMode();
      }
    };

    const handleGlobalRemovalToggled: L.LeafletEventHandlerFn = (event) => {
      const e = event as L.LeafletEvent & { enabled?: boolean };
      if (e.enabled) {
        try {
          map.pm?.disableDraw();
        } catch {
          /* ignore */
        }
      } else if (!activeLayerRef.current) {
        syncDrawingMode();
      }
    };

    setupControls();
    syncDrawingMode();

    map.whenReady(() => {
      setupControls();
      syncDrawingMode();
    });

    map.on("pm:create", handleCreate);
    map.on("pm:remove", handleRemove);
    map.on("pm:globaleditmodetoggled", handleGlobalEditToggled);
    map.on("pm:globalremovalmodetoggled", handleGlobalRemovalToggled);

    return () => {
      map.off("pm:create", handleCreate);
      map.off("pm:remove", handleRemove);
      map.off("pm:globaleditmodetoggled", handleGlobalEditToggled);
      map.off("pm:globalremovalmodetoggled", handleGlobalRemovalToggled);
      detachAttachedLayerHandlersRef.current?.();
      detachAttachedLayerHandlersRef.current = null;
      if (map.pm) {
        try {
          map.pm.disableDraw();
          map.pm.disableGlobalEditMode();
          map.pm.disableGlobalRemovalMode();
          map.pm.removeControls();
        } catch {
          /* ignore */
        }
      }
      removeZoneDraftLayers(map);
      activeLayerRef.current = null;
    };
  }, [map, drawMode]);

  useEffect(() => {
    if (!drawMode || !map.pm) return;
    if (!draftGeometry && !activeLayerRef.current) {
      syncDrawingMode();
    }
  }, [map, drawMode, draftGeometry]);

  return null;
}

export function ZoneMapInner({
  zones,
  selectedId,
  className,
  drawMode = null,
  excludeZoneId = null,
  draftGeometry = null,
  draftZoneType = "polygon",
  draftColor,
  onDraftGeometryChange,
  onMapReady,
  onMapAdapterReady,
}: {
  zones: ZoneRow[];
  selectedId: string | null;
  className?: string;
  drawMode?: ZoneMapDrawMode;
  /** When drawing/editing, hide this zone from the reference overlays */
  excludeZoneId?: string | null;
  draftGeometry?: ZoneGeoFeature | null;
  draftZoneType?: ZoneGeometryType;
  draftColor?: string;
  onDraftGeometryChange?: (
    geometry: ZoneGeoFeature | null,
    zoneType: ZoneGeometryType,
  ) => void;
  onMapReady?: (map: L.Map) => void;
  onMapAdapterReady?: (adapter: ZoneMapAdapter) => void;
}) {
  const referenceZones = useMemo(() => {
    if (!drawMode) return [];
    return zones.filter(
      (z) => z.geometry && z.id !== excludeZoneId,
    );
  }, [drawMode, zones, excludeZoneId]);

  const tile = useMemo(() => getZoneMapTileProps(), []);

  return (
    <MapContainer
      center={KUWAIT_MAP_CENTER}
      zoom={DEFAULT_MAP_ZOOM}
      className={className ?? "zones-leaflet-map h-full w-full rounded-xl"}
      scrollWheelZoom
      zoomControl={false}
    >
      <TileLayer attribution={tile.attribution} url={tile.url} />
      <ZoomControl position="topright" />
      <LeafletMapAdapterBridge onMapAdapterReady={onMapAdapterReady} />
      <MapInvalidateSize active={Boolean(drawMode)} />
      {!drawMode &&
        zones.map((zone) => (
          <ZoneOverlay
            key={zone.id}
            zone={zone}
            selected={zone.id === selectedId}
          />
        ))}
      {drawMode &&
        referenceZones.map((zone) => (
          <ZoneOverlay
            key={zone.id}
            zone={zone}
            selected={false}
            variant="reference"
          />
        ))}
      {drawMode && onDraftGeometryChange && (
        <GeomanDrawControl
          drawMode={drawMode}
          draftColor={normalizeZoneColor(draftColor)}
          draftGeometry={draftGeometry ?? null}
          draftZoneType={draftZoneType}
          onGeometryChange={onDraftGeometryChange}
          onMapReady={onMapReady}
          onMapAdapterReady={onMapAdapterReady}
        />
      )}
      {!drawMode && <ZoneLiveDriversLeaflet />}
      {!drawMode && <FitBounds zones={zones} selectedId={selectedId} />}
    </MapContainer>
  );
}
