"use client";

import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import { hexGridForView } from "@/lib/geo/h3-blocks";
import {
  createProjector,
  drawHexGrid,
  prepareCanvas,
} from "./hex-grid-canvas";
import {
  ZONE_BLOCK_HEX_STYLE,
  type ZoneBlockHexStyle,
  zoneBlockSelectedStyle,
} from "./zone-blocks-layer";

export function ZoneBlocksLeafletLayer({
  enabled,
  resolution,
  selectedCells,
  selectedColor,
  onHit,
  onZoomCapped,
}: {
  enabled: boolean;
  resolution: number;
  selectedCells: readonly string[];
  /** Draft zone colour; painted cells take it so the stroke previews the save. */
  selectedColor?: string;
  onHit?: (lat: number, lng: number, gesture: "click" | "drag") => void;
  onZoomCapped?: (capped: boolean) => void;
}) {
  const map = useMap();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cellsRef = useRef<string[]>([]);
  const gridVisibleRef = useRef(true);
  const selectedRef = useRef(new Set<string>());
  const selectedStyleRef = useRef<ZoneBlockHexStyle>(ZONE_BLOCK_HEX_STYLE.selected);
  const onHitRef = useRef(onHit);
  const onZoomCappedRef = useRef(onZoomCapped);
  const resolutionRef = useRef(resolution);
  const paintingRef = useRef(false);
  const movedRef = useRef(false);
  const paintableRef = useRef(false);
  const syncViewportRef = useRef<() => void>(() => {});
  const redrawRef = useRef<() => void>(() => {});

  onHitRef.current = onHit;
  onZoomCappedRef.current = onZoomCapped;
  resolutionRef.current = resolution;
  selectedRef.current = new Set(selectedCells);

  useEffect(() => {
    if (!enabled) {
      onZoomCappedRef.current?.(false);
      return;
    }

    const canvas = L.DomUtil.create(
      "canvas",
      "leaflet-zone-blocks-layer",
    ) as HTMLCanvasElement;
    canvas.style.position = "absolute";
    canvas.style.left = "0";
    canvas.style.top = "0";
    // The map keeps receiving the mouse events that drive painting.
    canvas.style.pointerEvents = "none";
    // First child of the pane so drawn zones and handles stay above the grid.
    const pane = map.getPanes().overlayPane;
    pane.insertBefore(canvas, pane.firstChild);
    canvasRef.current = canvas;

    /**
     * Painting owns the left drag, so panning gets Space-hold and right-drag —
     * the same two gestures as the Google layer, since the tool is the same tool
     * whichever basemap happens to be behind it.
     */
    let spacePanning = false;
    let rightPanning = false;
    let lastPanX = 0;
    let lastPanY = 0;
    const container = map.getContainer();

    const applyGestureMode = () => {
      if (spacePanning || !paintableRef.current) map.dragging.enable();
      else map.dragging.disable();
      container.style.cursor = spacePanning ? "grab" : "crosshair";
    };

    map.doubleClickZoom.disable();
    applyGestureMode();

    const redraw = () => {
      const size = map.getSize();
      const ctx = prepareCanvas(canvas, size.x, size.y);
      if (!ctx) return;
      // Pin the canvas to the container's top-left in layer coordinates so
      // canvas pixels line up with container pixels. This also clears any
      // transform left over from a zoom animation.
      L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));
      const nw = map.getBounds().getNorthWest();
      drawHexGrid({
        ctx,
        width: size.x,
        height: size.y,
        cells: cellsRef.current,
        selected: selectedRef.current,
        project: createProjector(map.getZoom(), nw.lat, nw.lng),
        gridVisible: gridVisibleRef.current,
        selectedStyle: selectedStyleRef.current,
      });
    };
    redrawRef.current = redraw;

    const syncViewport = () => {
      const bounds = map.getBounds();
      const view = hexGridForView({
        west: bounds.getWest(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        north: bounds.getNorth(),
        zoom: map.getZoom(),
        resolution: resolutionRef.current,
        extraCells: [...selectedRef.current],
      });
      cellsRef.current = view.cells;
      gridVisibleRef.current = view.visible;
      paintableRef.current = view.paintable;
      onZoomCappedRef.current?.(!view.paintable);
      applyGestureMode();
      redraw();
    };
    syncViewportRef.current = syncViewport;

    // Transform the existing bitmap through the zoom animation, then redraw it
    // crisply on zoomend. Mirrors what Leaflet's own canvas renderer does.
    type ZoomAnimatableMap = L.Map & {
      _latLngBoundsToNewLayerBounds: (
        bounds: L.LatLngBounds,
        zoom: number,
        center: L.LatLng,
      ) => L.Bounds;
    };
    const onZoomAnim = (e: L.ZoomAnimEvent) => {
      const scale = map.getZoomScale(e.zoom, map.getZoom());
      const offset = (map as ZoomAnimatableMap)._latLngBoundsToNewLayerBounds(
        map.getBounds(),
        e.zoom,
        e.center,
      ).min;
      if (offset) L.DomUtil.setTransform(canvas, offset, scale);
    };

    const onDown = (e: L.LeafletMouseEvent) => {
      if (spacePanning || rightPanning) return;
      if (e.originalEvent.button !== 0) return;
      paintingRef.current = true;
      movedRef.current = false;
      if (paintableRef.current) L.DomEvent.preventDefault(e.originalEvent);
    };

    const onMove = (e: L.LeafletMouseEvent) => {
      if (!paintingRef.current) return;
      movedRef.current = true;
      if (!paintableRef.current) return;
      onHitRef.current?.(e.latlng.lat, e.latlng.lng, "drag");
    };

    const onUp = (e: L.LeafletMouseEvent) => {
      if (!paintingRef.current) return;
      const wasDrag = movedRef.current;
      paintingRef.current = false;
      movedRef.current = false;
      if (!wasDrag && paintableRef.current) {
        onHitRef.current?.(e.latlng.lat, e.latlng.lng, "click");
      }
    };

    const onWindowUp = () => {
      paintingRef.current = false;
      movedRef.current = false;
    };

    const isTypingTarget = (target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      if (!el || !el.tagName) return false;
      return (
        el.tagName === "INPUT" ||
        el.tagName === "TEXTAREA" ||
        el.tagName === "SELECT" ||
        el.isContentEditable
      );
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat) return;
      if (isTypingTarget(e.target)) return;
      // Space would otherwise scroll the form or re-press a focused button.
      e.preventDefault();
      if (spacePanning) return;
      spacePanning = true;
      paintingRef.current = false;
      movedRef.current = false;
      applyGestureMode();
    };

    const endSpacePan = () => {
      if (!spacePanning) return;
      spacePanning = false;
      applyGestureMode();
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") endSpacePan();
    };

    // A tab switch mid-pan never delivers the keyup.
    const onWindowBlur = () => {
      endSpacePan();
      rightPanning = false;
    };

    const onContainerMouseDown = (e: MouseEvent) => {
      if (e.button !== 2) return;
      e.preventDefault();
      rightPanning = true;
      lastPanX = e.clientX;
      lastPanY = e.clientY;
    };

    const onDocMouseMove = (e: MouseEvent) => {
      if (!rightPanning) return;
      const dx = e.clientX - lastPanX;
      const dy = e.clientY - lastPanY;
      lastPanX = e.clientX;
      lastPanY = e.clientY;
      // Invert the delta so the map follows the cursor.
      map.panBy([-dx, -dy], { animate: false });
    };

    const onDocMouseUp = () => {
      rightPanning = false;
    };

    const onContextMenu = (e: MouseEvent) => e.preventDefault();

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onWindowBlur);
    window.addEventListener("mousemove", onDocMouseMove);
    window.addEventListener("mouseup", onDocMouseUp);
    container.addEventListener("mousedown", onContainerMouseDown);
    container.addEventListener("contextmenu", onContextMenu);

    map.on("moveend", syncViewport);
    map.on("zoomend", syncViewport);
    map.on("resize", syncViewport);
    map.on("zoomanim", onZoomAnim);
    map.on("mousedown", onDown);
    map.on("mousemove", onMove);
    map.on("mouseup", onUp);
    window.addEventListener("mouseup", onWindowUp);
    syncViewport();

    return () => {
      map.off("moveend", syncViewport);
      map.off("zoomend", syncViewport);
      map.off("resize", syncViewport);
      map.off("zoomanim", onZoomAnim);
      map.off("mousedown", onDown);
      map.off("mousemove", onMove);
      map.off("mouseup", onUp);
      window.removeEventListener("mouseup", onWindowUp);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onWindowBlur);
      window.removeEventListener("mousemove", onDocMouseMove);
      window.removeEventListener("mouseup", onDocMouseUp);
      container.removeEventListener("mousedown", onContainerMouseDown);
      container.removeEventListener("contextmenu", onContextMenu);
      container.style.cursor = "";
      canvas.remove();
      canvasRef.current = null;
      cellsRef.current = [];
      map.dragging.enable();
      map.doubleClickZoom.enable();
      paintingRef.current = false;
      movedRef.current = false;
    };
  }, [map, enabled, resolution]);

  // Selection changes only need a repaint, not a viewport rebuild — unless a
  // newly selected cell sits outside the current cell list.
  useEffect(() => {
    if (!enabled) return;
    const known = new Set(cellsRef.current);
    const needsRebuild = selectedCells.some((cell) => !known.has(cell));
    if (needsRebuild) syncViewportRef.current();
    else redrawRef.current();
  }, [enabled, selectedCells]);

  // A colour change is a repaint only; the cells have not moved.
  useEffect(() => {
    selectedStyleRef.current = selectedColor
      ? zoneBlockSelectedStyle(selectedColor)
      : ZONE_BLOCK_HEX_STYLE.selected;
    if (!enabled) return;
    redrawRef.current();
  }, [enabled, selectedColor]);

  return null;
}
