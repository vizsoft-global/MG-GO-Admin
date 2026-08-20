"use client";

import { useEffect, useRef, useState } from "react";
import {
  cellBoundaryLatLng,
  hexCellsForMapView,
} from "@/lib/geo/h3-blocks";
import type {
  GoogleMapInstance,
  GoogleMapsApi,
  GooglePolygonInstance,
} from "@/lib/google-maps/load";
import { ZONE_BLOCK_HEX_STYLE } from "./zone-blocks-layer";
import { latLngToTuple } from "./zone-map-google-utils";

type BlockHitHandler = (
  lat: number,
  lng: number,
  gesture: "click" | "drag",
) => void;

function hexOptions(selected: boolean) {
  const style = selected
    ? ZONE_BLOCK_HEX_STYLE.selected
    : ZONE_BLOCK_HEX_STYLE.unselected;
  return {
    ...style,
    clickable: false,
    editable: false,
    draggable: false,
    zIndex: selected ? 24 : 22,
  };
}

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
  const polygonsRef = useRef<Map<string, GooglePolygonInstance>>(new Map());
  const selectedRef = useRef(new Set<string>());
  const onHitRef = useRef(onHit);
  const onZoomCappedRef = useRef(onZoomCapped);
  const resolutionRef = useRef(resolution);
  const paintingRef = useRef(false);
  const movedRef = useRef(false);
  const zoomCappedRef = useRef(false);
  const syncViewportRef = useRef<() => void>(() => {});

  onHitRef.current = onHit;
  onZoomCappedRef.current = onZoomCapped;
  resolutionRef.current = resolution;
  selectedRef.current = new Set(selectedCells);

  useEffect(() => {
    if (!map || !google || !enabled) {
      for (const polygon of polygonsRef.current.values()) {
        polygon.setMap(null);
      }
      polygonsRef.current.clear();
      setZoomCapped(false);
      onZoomCappedRef.current?.(false);
      return;
    }

    map.setOptions({ draggable: false, disableDoubleClickZoom: true });

    const restyle = () => {
      for (const [cell, polygon] of polygonsRef.current) {
        polygon.setOptions(hexOptions(selectedRef.current.has(cell)));
      }
    };

    const upsert = (cells: string[]) => {
      const next = new Set(cells);
      for (const [cell, polygon] of polygonsRef.current) {
        if (!next.has(cell)) {
          polygon.setMap(null);
          polygonsRef.current.delete(cell);
        }
      }
      for (const cell of cells) {
        if (polygonsRef.current.has(cell)) continue;
        const path = cellBoundaryLatLng(cell).map(([lat, lng]) => ({ lat, lng }));
        if (path.length < 4) continue;
        const polygon = new google.maps.Polygon({
          paths: path,
          map,
          ...hexOptions(selectedRef.current.has(cell)),
        });
        polygonsRef.current.set(cell, polygon);
      }
      restyle();
    };

    const syncViewport = () => {
      const center = map.getCenter?.();
      if (!center) return;
      const [lat, lng] = latLngToTuple(center);
      const bounds = map.getBounds?.();
      const sw = bounds ? latLngToTuple(bounds.getSouthWest()) : [lat - 0.02, lng - 0.02];
      const ne = bounds ? latLngToTuple(bounds.getNorthEast()) : [lat + 0.02, lng + 0.02];
      const view = hexCellsForMapView({
        west: sw[1],
        south: sw[0],
        east: ne[1],
        north: ne[0],
        lat,
        lng,
        resolution: resolutionRef.current,
        extraCells: [...selectedRef.current],
      });
      setZoomCapped(!view.fullViewport);
      zoomCappedRef.current = !view.fullViewport;
      onZoomCappedRef.current?.(!view.fullViewport);
      map.setOptions({
        draggable: !view.fullViewport,
        disableDoubleClickZoom: true,
      });
      upsert(view.cells);
    };

    syncViewportRef.current = syncViewport;

    const onDown = ((e: unknown) => {
      const point = eventLatLng(e);
      if (!point) return;
      paintingRef.current = true;
      movedRef.current = false;
    }) as () => void;

    const onMove = ((e: unknown) => {
      if (!paintingRef.current) return;
      const point = eventLatLng(e);
      if (!point) return;
      movedRef.current = true;
      if (zoomCappedRef.current) return;
      onHitRef.current?.(point.lat, point.lng, "drag");
    }) as () => void;

    const finish = (e: unknown) => {
      if (!paintingRef.current) return;
      const point = eventLatLng(e);
      const wasDrag = movedRef.current;
      paintingRef.current = false;
      movedRef.current = false;
      if (!wasDrag && point) {
        onHitRef.current?.(point.lat, point.lng, "click");
      }
    };

    const onUp = ((e: unknown) => {
      finish(e);
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
      for (const polygon of polygonsRef.current.values()) {
        polygon.setMap(null);
      }
      polygonsRef.current.clear();
      map.setOptions({ draggable: true, disableDoubleClickZoom: false });
      paintingRef.current = false;
      movedRef.current = false;
    };
  }, [map, google, enabled, resolution]);

  useEffect(() => {
    if (!enabled) return;
    syncViewportRef.current();
  }, [enabled, selectedCells]);

  return { zoomCapped };
}
