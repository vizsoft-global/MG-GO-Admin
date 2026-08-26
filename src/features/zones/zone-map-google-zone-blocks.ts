"use client";

import { useEffect, useRef, type RefObject } from "react";
import type {
  GoogleMapInstance,
  GoogleMapsApi,
  GoogleOverlayViewInstance,
} from "@/lib/google-maps/load";
import type { ZoneGeoFeature } from "@/lib/geo/zone-geometry";
import { createProjector, drawCells, prepareCanvas } from "./hex-grid-canvas";
import { cellsForZone, zoneBlockSize, zoneBlocksVisible } from "./zone-block-cells";
import { normalizeZoneColor } from "./zone-colors";
import { latLngToTuple } from "./zone-map-google-utils";

/**
 * Draws the block structure inside saved zones.
 *
 * A block-painted zone is stored as its union polygon, so on a read-only map it
 * arrives as one flat shape and the fact that it was assembled out of blocks is
 * lost. This redraws the hex edges over the zone fill — outlines only, no fill of
 * their own, so the zone keeps reading as one area while showing what it is made
 * of. Zones drawn by hand have no block size and are skipped.
 */

export type ZoneBlockOutlineSource = {
  id: string;
  color: string | null;
  geometry: ZoneGeoFeature | null;
};

/** Fainter than the zone's own border: structure, not another boundary. */
const OUTLINE_STROKE_OPACITY = 0.5;

/**
 * Takes the map and API as refs rather than values: this layer only needs them
 * inside its effect, and `enabled` already flips when the map becomes ready, so
 * the effect re-runs at exactly the right moment without reading a ref during
 * render.
 */
export function useGoogleZoneBlockOutlines({
  mapRef,
  googleRef,
  zones,
  enabled,
}: {
  mapRef: RefObject<GoogleMapInstance | null>;
  googleRef: RefObject<GoogleMapsApi | null>;
  zones: readonly ZoneBlockOutlineSource[];
  enabled: boolean;
}): void {
  const zonesRef = useRef(zones);
  const redrawRef = useRef<() => void>(() => {});
  zonesRef.current = zones;

  useEffect(() => {
    const map = mapRef.current;
    const google = googleRef.current;
    if (!map || !google || !enabled || !google.maps.OverlayView) return;

    const mapInstance = map;
    let overlay: GoogleOverlayViewInstance | null = null;
    let canvas: HTMLCanvasElement | null = null;
    let frame = 0;

    class ZoneBlockOverlay extends google.maps.OverlayView {
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

        const [northLat] = latLngToTuple(bounds.getNorthEast());
        const [southLat, westLng] = latLngToTuple(bounds.getSouthWest());
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

        ctx.clearRect(0, 0, width, height);
        const project = createProjector(zoom, northLat, westLng);
        // Hex size is latitude-dependent; the viewport centre is the fairest
        // single sample for a decision that applies to the whole canvas.
        const lat = (northLat + southLat) / 2;

        for (const zone of zonesRef.current) {
          const size = zoneBlockSize(zone.geometry);
          if (!size || !zoneBlocksVisible(size, lat, zoom)) continue;
          const cells = cellsForZone(zone.geometry, size);
          if (cells.length === 0) continue;
          const color = normalizeZoneColor(zone.color);
          drawCells(
            ctx,
            cells,
            {
              fillColor: color,
              fillOpacity: 0,
              strokeColor: color,
              strokeOpacity: OUTLINE_STROKE_OPACITY,
              strokeWeight: 1,
            },
            project,
            width,
            height,
          );
        }
      }

      override onRemove() {
        canvas?.remove();
        canvas = null;
      }
    }

    overlay = new ZoneBlockOverlay();
    overlay.setMap(map);

    const redraw = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = 0;
        overlay?.draw();
      });
    };
    redrawRef.current = redraw;

    const idleListener = map.addListener("idle", redraw);
    redraw();

    return () => {
      idleListener.remove();
      if (frame) cancelAnimationFrame(frame);
      overlay?.setMap(null);
      overlay = null;
      redrawRef.current = () => {};
    };
  }, [mapRef, googleRef, enabled]);

  useEffect(() => {
    if (!enabled) return;
    redrawRef.current();
  }, [enabled, zones]);
}
