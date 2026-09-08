"use client";

import { useEffect, useRef, useState } from "react";
import { hexGridForView } from "@/lib/geo/h3-blocks";
import type {
  GoogleMapInstance,
  GoogleMapsApi,
  GoogleOverlayViewInstance,
} from "@/lib/google-maps/load";
import { createProjector, drawHexGrid, prepareCanvas } from "./hex-grid-canvas";
import {
  ZONE_BLOCK_HEX_STYLE,
  type ZoneBlockHexStyle,
  zoneBlockSelectedStyle,
} from "./zone-blocks-layer";
import { buildBlocksModeStyles } from "./zone-map-google-styles";
import { latLngToTuple } from "./zone-map-google-utils";

type BlockHitHandler = (
  lat: number,
  lng: number,
  gesture: "click" | "drag",
) => void;

function eventLatLng(e: unknown): { lat: number; lng: number } | null {
  const latLng = (e as { latLng?: { lat: () => number; lng: () => number } | null })
    ?.latLng;
  if (!latLng) return null;
  return { lat: latLng.lat(), lng: latLng.lng() };
}

/** Left button only paints; the right button is reserved for panning. */
function isPrimaryButton(e: unknown): boolean {
  const button = (e as { domEvent?: { button?: number } })?.domEvent?.button;
  return button == null || button === 0;
}

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return (
    el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.tagName === "SELECT" ||
    el.isContentEditable
  );
}

export function useGoogleZoneBlocks({
  map,
  google,
  enabled,
  resolution,
  selectedCells,
  selectedColor,
  onHit,
  onZoomCapped,
}: {
  map: GoogleMapInstance | null;
  google: GoogleMapsApi | null;
  enabled: boolean;
  resolution: number;
  selectedCells: readonly string[];
  /** Draft zone colour; painted cells take it so the stroke previews the save. */
  selectedColor?: string;
  onHit?: BlockHitHandler;
  onZoomCapped?: (capped: boolean) => void;
}): { zoomCapped: boolean } {
  const [zoomCapped, setZoomCapped] = useState(false);
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
    if (!map || !google || !enabled || !google.maps.OverlayView) {
      setZoomCapped(false);
      onZoomCappedRef.current?.(false);
      return;
    }

    // Capture post-guard so the overlay class body keeps the narrowed types.
    const mapInstance = map;
    const mapDiv = mapInstance.getDiv?.() ?? null;

    /**
     * Painting owns the left drag, so panning needs gestures of its own: hold
     * Space (the convention every canvas editor uses) or drag with the right
     * button. Without one of these the only way to reach the next block was to
     * leave Blocks for the Move tool, which hides the honeycomb and loses your
     * place on the map.
     */
    let spacePanning = false;
    let rightPanning = false;
    let lastPanX = 0;
    let lastPanY = 0;

    const applyGestureMode = () => {
      mapInstance.setOptions({
        // The map drags itself while Space is held, and whenever the user is
        // zoomed too far out to paint anyway.
        draggable: spacePanning || !paintableRef.current,
        disableDoubleClickZoom: true,
        draggableCursor: spacePanning ? "grab" : "crosshair",
        draggingCursor: spacePanning ? "grabbing" : "crosshair",
      });
    };

    mapInstance.setOptions({ styles: buildBlocksModeStyles() });
    applyGestureMode();

    let overlay: GoogleOverlayViewInstance | null = null;
    let canvas: HTMLCanvasElement | null = null;
    let frame = 0;

    /**
     * One canvas covering the viewport, redrawn as a single path. Lives in the
     * non-interactive overlay pane so the map still receives the mouse events
     * that drive painting.
     */
    class HexGridOverlay extends google.maps.OverlayView {
      override onAdd() {
        const el = document.createElement("canvas");
        el.style.position = "absolute";
        el.style.pointerEvents = "none";
        canvas = el;
        this.getPanes()?.overlayLayer?.appendChild(el);
      }

      override draw() {
        if (!canvas) return;
        const projection = this.getProjection();
        const bounds = mapInstance.getBounds();
        const zoom = mapInstance.getZoom();
        if (!projection || !bounds || zoom == null) return;

        // Anchor the canvas at the viewport's north-west corner and project
        // every hex relative to that same point, so the two never disagree.
        const [northLat] = latLngToTuple(bounds.getNorthEast());
        const [, westLng] = latLngToTuple(bounds.getSouthWest());
        const anchor = projection.fromLatLngToDivPixel({
          lat: northLat,
          lng: westLng,
        });
        if (!anchor) return;

        const div = mapInstance.getDiv?.();
        const width = Math.max(1, div?.clientWidth ?? 0);
        const height = Math.max(1, div?.clientHeight ?? 0);

        canvas.style.left = `${anchor.x}px`;
        canvas.style.top = `${anchor.y}px`;
        const ctx = prepareCanvas(canvas, width, height);
        if (!ctx) return;

        drawHexGrid({
          ctx,
          width,
          height,
          cells: cellsRef.current,
          selected: selectedRef.current,
          project: createProjector(zoom, northLat, westLng),
          gridVisible: gridVisibleRef.current,
          selectedStyle: selectedStyleRef.current,
        });
      }

      override onRemove() {
        canvas?.remove();
        canvas = null;
      }
    }

    overlay = new HexGridOverlay();
    overlay.setMap(map);

    const redraw = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = 0;
        overlay?.draw();
      });
    };
    redrawRef.current = redraw;

    const syncViewport = () => {
      const bounds = map.getBounds();
      const zoom = map.getZoom();
      if (!bounds || zoom == null) return;
      const [north, east] = latLngToTuple(bounds.getNorthEast());
      const [south, west] = latLngToTuple(bounds.getSouthWest());
      const view = hexGridForView({
        west,
        south,
        east,
        north,
        zoom,
        resolution: resolutionRef.current,
        extraCells: [...selectedRef.current],
      });
      cellsRef.current = view.cells;
      gridVisibleRef.current = view.visible;
      paintableRef.current = view.paintable;
      setZoomCapped(!view.paintable);
      onZoomCappedRef.current?.(!view.paintable);
      applyGestureMode();
      redraw();
    };
    syncViewportRef.current = syncViewport;

    const onDown = ((e: unknown) => {
      if (spacePanning || rightPanning) return;
      if (!isPrimaryButton(e)) return;
      if (!eventLatLng(e)) return;
      paintingRef.current = true;
      movedRef.current = false;
    }) as () => void;

    const onMove = ((e: unknown) => {
      if (!paintingRef.current) return;
      const point = eventLatLng(e);
      if (!point) return;
      movedRef.current = true;
      if (!paintableRef.current) return;
      onHitRef.current?.(point.lat, point.lng, "drag");
    }) as () => void;

    const onUp = ((e: unknown) => {
      if (!paintingRef.current) return;
      const point = eventLatLng(e);
      const wasDrag = movedRef.current;
      paintingRef.current = false;
      movedRef.current = false;
      if (!wasDrag && point && paintableRef.current) {
        onHitRef.current?.(point.lat, point.lng, "click");
      }
    }) as () => void;

    const idleListener = map.addListener("idle", syncViewport);
    const downListener = map.addListener("mousedown", onDown);
    const moveListener = map.addListener("mousemove", onMove);
    const upListener = map.addListener("mouseup", onUp);
    syncViewport();

    const onWindowUp = () => {
      paintingRef.current = false;
      movedRef.current = false;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat) return;
      if (isTypingTarget(e.target)) return;
      // Space would otherwise scroll the form or re-press a focused button.
      e.preventDefault();
      if (spacePanning) return;
      spacePanning = true;
      // Abandon any stroke in flight rather than finishing it as a click.
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

    // A tab switch mid-pan never delivers the keyup, which would leave the map
    // stuck in pan mode with no way back short of leaving Blocks.
    const onWindowBlur = () => {
      endSpacePan();
      rightPanning = false;
    };

    const onDivMouseDown = (e: MouseEvent) => {
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
      // `panBy` moves the viewport, so invert the delta to follow the cursor.
      mapInstance.panBy?.(-dx, -dy);
    };

    const onDocMouseUp = () => {
      rightPanning = false;
    };

    // Suppress the browser menu for the whole map, or the right-drag ends in a
    // context menu the first time the user pauses.
    const onContextMenu = (e: MouseEvent) => e.preventDefault();

    window.addEventListener("mouseup", onWindowUp);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onWindowBlur);
    window.addEventListener("mousemove", onDocMouseMove);
    window.addEventListener("mouseup", onDocMouseUp);
    mapDiv?.addEventListener("mousedown", onDivMouseDown);
    mapDiv?.addEventListener("contextmenu", onContextMenu);

    return () => {
      idleListener.remove();
      downListener.remove();
      moveListener.remove();
      upListener.remove();
      window.removeEventListener("mouseup", onWindowUp);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onWindowBlur);
      window.removeEventListener("mousemove", onDocMouseMove);
      window.removeEventListener("mouseup", onDocMouseUp);
      mapDiv?.removeEventListener("mousedown", onDivMouseDown);
      mapDiv?.removeEventListener("contextmenu", onContextMenu);
      if (frame) cancelAnimationFrame(frame);
      overlay?.setMap(null);
      overlay = null;
      cellsRef.current = [];
      map.setOptions({
        draggable: true,
        disableDoubleClickZoom: false,
        draggableCursor: null,
        draggingCursor: null,
        styles: [],
      });
      paintingRef.current = false;
      movedRef.current = false;
    };
  }, [map, google, enabled, resolution]);

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

  return { zoomCapped };
}
