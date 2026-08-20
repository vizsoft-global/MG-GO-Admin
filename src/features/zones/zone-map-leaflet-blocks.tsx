"use client";

import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import {
  cellBoundaryLatLng,
  viewportHexCells,
} from "@/lib/geo/h3-blocks";
import { ZONE_BLOCK_HEX_STYLE } from "./zone-blocks-layer";

function hexPathOptions(selected: boolean): L.PathOptions {
  const style = selected
    ? ZONE_BLOCK_HEX_STYLE.selected
    : ZONE_BLOCK_HEX_STYLE.unselected;
  return {
    color: style.strokeColor,
    opacity: style.strokeOpacity,
    weight: style.strokeWeight,
    fillColor: style.fillColor,
    fillOpacity: style.fillOpacity,
    interactive: false,
    bubblingMouseEvents: false,
    pmIgnore: true,
  } as L.PathOptions;
}

export function ZoneBlocksLeafletLayer({
  enabled,
  resolution,
  selectedCells,
  onHit,
  onZoomCapped,
}: {
  enabled: boolean;
  resolution: number;
  selectedCells: readonly string[];
  onHit?: (lat: number, lng: number, gesture: "click" | "drag") => void;
  onZoomCapped?: (capped: boolean) => void;
}) {
  const map = useMap();
  const groupRef = useRef<L.LayerGroup | null>(null);
  const polygonsRef = useRef<Map<string, L.Polygon>>(new Map());
  const selectedRef = useRef(new Set<string>());
  const onHitRef = useRef(onHit);
  const onZoomCappedRef = useRef(onZoomCapped);
  const resolutionRef = useRef(resolution);
  const paintingRef = useRef(false);
  const movedRef = useRef(false);

  onHitRef.current = onHit;
  onZoomCappedRef.current = onZoomCapped;
  resolutionRef.current = resolution;
  selectedRef.current = new Set(selectedCells);

  useEffect(() => {
    if (!enabled) {
      groupRef.current?.remove();
      groupRef.current = null;
      polygonsRef.current.clear();
      onZoomCappedRef.current?.(false);
      return;
    }

    const group = L.layerGroup().addTo(map);
    groupRef.current = group;
    map.dragging.disable();
    map.doubleClickZoom.disable();

    const restyle = () => {
      for (const [cell, polygon] of polygonsRef.current) {
        polygon.setStyle(hexPathOptions(selectedRef.current.has(cell)));
      }
    };

    const syncViewport = () => {
      const bounds = map.getBounds();
      const cells = viewportHexCells(
        bounds.getWest(),
        bounds.getSouth(),
        bounds.getEast(),
        bounds.getNorth(),
        resolutionRef.current,
      );
      if (!cells) {
        group.clearLayers();
        polygonsRef.current.clear();
        onZoomCappedRef.current?.(true);
        return;
      }
      onZoomCappedRef.current?.(false);
      const next = new Set(cells);
      for (const [cell, polygon] of polygonsRef.current) {
        if (!next.has(cell)) {
          group.removeLayer(polygon);
          polygonsRef.current.delete(cell);
        }
      }
      for (const cell of cells) {
        if (polygonsRef.current.has(cell)) continue;
        const latlngs = cellBoundaryLatLng(cell);
        if (latlngs.length < 4) continue;
        const polygon = L.polygon(latlngs, hexPathOptions(selectedRef.current.has(cell)));
        polygon.addTo(group);
        polygonsRef.current.set(cell, polygon);
      }
      restyle();
    };

    const onDown = (e: L.LeafletMouseEvent) => {
      paintingRef.current = true;
      movedRef.current = false;
      L.DomEvent.preventDefault(e.originalEvent);
    };

    const onMove = (e: L.LeafletMouseEvent) => {
      if (!paintingRef.current) return;
      movedRef.current = true;
      onHitRef.current?.(e.latlng.lat, e.latlng.lng, "drag");
    };

    const onUp = (e: L.LeafletMouseEvent) => {
      if (!paintingRef.current) return;
      const wasDrag = movedRef.current;
      paintingRef.current = false;
      movedRef.current = false;
      if (!wasDrag) {
        onHitRef.current?.(e.latlng.lat, e.latlng.lng, "click");
      }
    };

    const onWindowUp = () => {
      paintingRef.current = false;
      movedRef.current = false;
    };

    map.on("moveend", syncViewport);
    map.on("zoomend", syncViewport);
    map.on("mousedown", onDown);
    map.on("mousemove", onMove);
    map.on("mouseup", onUp);
    window.addEventListener("mouseup", onWindowUp);
    syncViewport();

    return () => {
      map.off("moveend", syncViewport);
      map.off("zoomend", syncViewport);
      map.off("mousedown", onDown);
      map.off("mousemove", onMove);
      map.off("mouseup", onUp);
      window.removeEventListener("mouseup", onWindowUp);
      group.remove();
      groupRef.current = null;
      polygonsRef.current.clear();
      map.dragging.enable();
      map.doubleClickZoom.enable();
      paintingRef.current = false;
      movedRef.current = false;
    };
  }, [map, enabled, resolution]);

  useEffect(() => {
    if (!enabled) return;
    for (const [cell, polygon] of polygonsRef.current) {
      polygon.setStyle(hexPathOptions(selectedRef.current.has(cell)));
    }
  }, [enabled, selectedCells]);

  return null;
}
