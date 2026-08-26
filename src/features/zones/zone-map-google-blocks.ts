"use client";

import { useEffect, useRef, useState } from "react";
import { hexGridForView } from "@/lib/geo/h3-blocks";
import type {
  GoogleMapInstance,
  GoogleMapsApi,
  GoogleOverlayViewInstance,
} from "@/lib/google-maps/load";
import { createProjector, drawHexGrid, prepareCanvas } from "./hex-grid-canvas";
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

export function useGoogleZoneBlocks({
  map,
  google,
  enabled,
  resolution,
  selectedCells,
  onHit,
  onZoomCapped,
}: {
  map: GoogleMapInstance | null;
  google: GoogleMapsApi | null;
  enabled: boolean;
  resolution: number;
  selectedCells: readonly string[];
  onHit?: BlockHitHandler;
  onZoomCapped?: (capped: boolean) => void;
}): { zoomCapped: boolean } {
  const [zoomCapped, setZoomCapped] = useState(false);
  const cellsRef = useRef<string[]>([]);
  const gridVisibleRef = useRef(true);
  const selectedRef = useRef(new Set<string>());
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
    mapInstance.setOptions({ draggable: false, disableDoubleClickZoom: true });

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
      // Give panning back when the user cannot paint anyway.
      map.setOptions({
        draggable: !view.paintable,
        disableDoubleClickZoom: true,
      });
      redraw();
    };
    syncViewportRef.current = syncViewport;

    const onDown = ((e: unknown) => {
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
    window.addEventListener("mouseup", onWindowUp);

    return () => {
      idleListener.remove();
      downListener.remove();
      moveListener.remove();
      upListener.remove();
      window.removeEventListener("mouseup", onWindowUp);
      if (frame) cancelAnimationFrame(frame);
      overlay?.setMap(null);
      overlay = null;
      cellsRef.current = [];
      map.setOptions({ draggable: true, disableDoubleClickZoom: false });
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

  return { zoomCapped };
}
