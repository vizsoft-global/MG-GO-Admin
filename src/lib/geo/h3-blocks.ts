import { area, featureCollection, intersect, polygon, union } from "@turf/turf";
import kinks from "@turf/kinks";
import {
  areNeighborCells,
  cellsToMultiPolygon,
  cellToBoundary,
  cellToLatLng,
  getHexagonAreaAvg,
  gridDisk,
  latLngToCell,
  polygonToCells,
} from "h3-js";
import type { Feature, MultiPolygon, Polygon, Position } from "geojson";
import { KUWAIT_LAND, isKuwaitLand } from "./kuwait-land";
import { buildPolygonFeature, type ZoneGeoFeature } from "./zone-geometry";

export const H3_BLOCK_RESOLUTIONS = {
  S: 8,
  M: 9,
  L: 10,
} as const;

export type H3BlockSize = keyof typeof H3_BLOCK_RESOLUTIONS;

export const DEFAULT_H3_BLOCK_SIZE: H3BlockSize = "M";

/** Skip `polygonToCells` when the land viewport would flood the map. */
export const H3_VIEWPORT_CELL_CAP = 3000;

export type H3UnionResult =
  | { ok: true; feature: ZoneGeoFeature }
  | { ok: false; reason: "empty" | "disconnected" | "invalid" };

function uniqueCells(cells: readonly string[]): string[] {
  return [...new Set(cells)];
}

function bboxAreaKm2(west: number, south: number, east: number, north: number): number {
  const latMid = (south + north) / 2;
  const kmPerDegLat = 110.574;
  const kmPerDegLng = 111.32 * Math.cos((latMid * Math.PI) / 180);
  const heightKm = Math.abs(north - south) * kmPerDegLat;
  const widthKm = Math.abs(east - west) * kmPerDegLng;
  return Math.max(0, widthKm * heightKm);
}

/**
 * Cheap upper bound so we never call `polygonToCells` on a huge bbox at high res.
 */
export function estimateViewportCellCount(
  west: number,
  south: number,
  east: number,
  north: number,
  resolution: number,
): number {
  const avgKm2 = getHexagonAreaAvg(resolution, "km2");
  if (!Number.isFinite(avgKm2) || avgKm2 <= 0) return Number.POSITIVE_INFINITY;
  return Math.ceil(bboxAreaKm2(west, south, east, north) / avgKm2);
}

export function canPaintViewport(
  west: number,
  south: number,
  east: number,
  north: number,
  resolution: number,
  cap: number = H3_VIEWPORT_CELL_CAP,
): boolean {
  return estimateViewportCellCount(west, south, east, north, resolution) <= cap;
}

export function viewportHexCells(
  west: number,
  south: number,
  east: number,
  north: number,
  resolution: number,
  cap: number = H3_VIEWPORT_CELL_CAP,
): string[] | null {
  if (!canPaintViewport(west, south, east, north, resolution, cap)) return null;
  const ring: Position[] = [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south],
  ];
  try {
    const cells = polygonToCells([ring], resolution, true);
    if (cells.length > cap) return null;
    return cells;
  } catch {
    return null;
  }
}

/** Honeycomb around a point, grown until the next ring would exceed `cap`. */
export function centerDiskCells(
  lat: number,
  lng: number,
  resolution: number,
  cap: number = H3_VIEWPORT_CELL_CAP,
): string[] {
  const origin = latLngToCell(lat, lng, resolution);
  let best: string[] = [origin];
  for (let k = 1; k <= 40; k++) {
    let disk: string[];
    try {
      disk = gridDisk(origin, k);
    } catch {
      break;
    }
    if (disk.length > cap) break;
    best = disk;
  }
  return best;
}

export type HexViewCells = {
  cells: string[];
  /** False when land in view has too many hexes; overlay shows selected cells only. */
  fullViewport: boolean;
};

function viewportPolygon(
  west: number,
  south: number,
  east: number,
  north: number,
): Feature<Polygon> {
  return polygon([
    [
      [west, south],
      [east, south],
      [east, north],
      [west, north],
      [west, south],
    ],
  ]);
}

function landOnlyCells(cells: readonly string[]): string[] {
  return uniqueCells(cells).filter((cell) => {
    const [lat, lng] = cellToLatLng(cell);
    return isKuwaitLand(lat, lng);
  });
}

function cellsFromLandGeometry(
  geometry: Polygon | MultiPolygon,
  resolution: number,
  cap: number,
): string[] | null {
  const parts = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  const cells: string[] = [];
  for (const coords of parts) {
    let next: string[];
    try {
      next = polygonToCells(coords, resolution, true);
    } catch {
      return null;
    }
    if (cells.length + next.length > cap) return null;
    cells.push(...next);
  }
  const land = landOnlyCells(cells);
  if (land.length > cap) return null;
  return land;
}

/**
 * Viewport hexes when they fit under the cap; otherwise a center disk so the
 * honeycomb is always visible. `extraCells` (the current selection) are always kept.
 */
export function hexCellsForMapView(args: {
  west: number;
  south: number;
  east: number;
  north: number;
  lat: number;
  lng: number;
  resolution: number;
  extraCells?: readonly string[];
  cap?: number;
}): HexViewCells {
  const cap = args.cap ?? H3_VIEWPORT_CELL_CAP;
  const viewport = viewportHexCells(
    args.west,
    args.south,
    args.east,
    args.north,
    args.resolution,
    cap,
  );
  const base =
    viewport ?? centerDiskCells(args.lat, args.lng, args.resolution, cap);
  return {
    cells: uniqueCells([...base, ...(args.extraCells ?? [])]),
    fullViewport: viewport != null,
  };
}

export function isKuwaitLandCell(h3Index: string): boolean {
  const [lat, lng] = cellToLatLng(h3Index);
  return isKuwaitLand(lat, lng);
}

/**
 * Faint honeycomb on Kuwait land inside the viewport. No sea cells and no
 * circular disk. When the land patch is too large, only selected land cells.
 */
export function landHexCellsForMapView(args: {
  west: number;
  south: number;
  east: number;
  north: number;
  resolution: number;
  extraCells?: readonly string[];
  cap?: number;
}): HexViewCells {
  const cap = args.cap ?? H3_VIEWPORT_CELL_CAP;
  const extra = landOnlyCells(args.extraCells ?? []);
  const view = viewportPolygon(args.west, args.south, args.east, args.north);
  let landPatch: Feature<Polygon | MultiPolygon> | null = null;
  try {
    landPatch = intersect(featureCollection([KUWAIT_LAND, view]));
  } catch {
    landPatch = null;
  }
  if (!landPatch) {
    return { cells: extra, fullViewport: true };
  }

  const avgKm2 = getHexagonAreaAvg(args.resolution, "km2");
  const patchKm2 = area(landPatch) / 1e6;
  if (Number.isFinite(avgKm2) && avgKm2 > 0 && patchKm2 / avgKm2 > cap) {
    return { cells: extra, fullViewport: false };
  }

  const base = cellsFromLandGeometry(landPatch.geometry, args.resolution, cap);
  if (base == null) {
    return { cells: extra, fullViewport: false };
  }
  return {
    cells: uniqueCells([...base, ...extra]),
    fullViewport: true,
  };
}

export function indexForLatLng(lat: number, lng: number, resolution: number): string {
  return latLngToCell(lat, lng, resolution);
}

/** Closed GeoJSON ring `[lng, lat]`. */
export function cellBoundaryLngLat(h3Index: string): Position[] {
  const ring = cellToBoundary(h3Index, true);
  if (ring.length === 0) return [];
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    return [...ring, first];
  }
  return ring;
}

/** Closed Leaflet/Google path `[lat, lng]`. */
export function cellBoundaryLatLng(h3Index: string): [number, number][] {
  return cellBoundaryLngLat(h3Index).map(([lng, lat]) => [lat, lng]);
}

function featureFromOuterRing(ringLngLat: Position[]): ZoneGeoFeature | null {
  if (ringLngLat.length < 4) return null;
  const latLng = ringLngLat.map(([lng, lat]) => [lat, lng] as [number, number]);
  const feature = buildPolygonFeature(latLng);
  if (feature.geometry.type !== "Polygon") return null;
  if (kinks(feature as Feature<Polygon>).features.length > 0) return null;
  return feature;
}

function cellToPolygonFeature(h3Index: string): ZoneGeoFeature | null {
  return featureFromOuterRing(cellBoundaryLngLat(h3Index));
}

function featureFromH3Outline(cells: readonly string[]): ZoneGeoFeature | null {
  try {
    const multi = cellsToMultiPolygon([...cells], true);
    if (multi.length !== 1) return null;
    const outer = multi[0][0];
    if (!outer) return null;
    return featureFromOuterRing(outer);
  } catch {
    return null;
  }
}

export function isAdjacentToSelection(cell: string, selected: readonly string[]): boolean {
  if (selected.length === 0) return true;
  return selected.some((other) => {
    try {
      return areNeighborCells(cell, other);
    } catch {
      return false;
    }
  });
}

function cellsAreConnected(cells: readonly string[]): boolean {
  const unique = uniqueCells(cells);
  if (unique.length <= 1) return true;
  const remaining = new Set(unique);
  const start = unique[0];
  remaining.delete(start);
  const queue = [start];
  while (queue.length > 0) {
    const current = queue.pop()!;
    let neighbors: string[] = [];
    try {
      neighbors = gridDisk(current, 1);
    } catch {
      return false;
    }
    for (const n of neighbors) {
      if (n === current) continue;
      if (remaining.has(n)) {
        remaining.delete(n);
        queue.push(n);
      }
    }
  }
  return remaining.size === 0;
}

export function wouldKeepSelectionConnected(
  selected: readonly string[],
  cell: string,
  mode: "add" | "remove",
): boolean {
  if (mode === "add") {
    return isAdjacentToSelection(cell, selected);
  }
  const next = selected.filter((c) => c !== cell);
  return cellsAreConnected(next);
}

export function unionCellsToPolygon(cells: readonly string[]): H3UnionResult {
  const unique = uniqueCells(cells);
  if (unique.length === 0) return { ok: false, reason: "empty" };
  if (!cellsAreConnected(unique)) return { ok: false, reason: "disconnected" };

  if (unique.length === 1) {
    const feature = cellToPolygonFeature(unique[0]);
    if (!feature) return { ok: false, reason: "invalid" };
    return { ok: true, feature };
  }

  const features = unique
    .map((cell) => cellToPolygonFeature(cell))
    .filter((f): f is ZoneGeoFeature => f != null && f.geometry.type === "Polygon");
  if (features.length !== unique.length) return { ok: false, reason: "invalid" };

  try {
    const merged = union(
      featureCollection(features as Feature<Polygon>[]),
    );
    if (merged?.geometry.type === "Polygon") {
      const feature = featureFromOuterRing(merged.geometry.coordinates[0] ?? []);
      if (feature) return { ok: true, feature };
    }
    const outlined = featureFromH3Outline(unique);
    if (outlined) return { ok: true, feature: outlined };
    if (merged?.geometry.type === "MultiPolygon") {
      return { ok: false, reason: "disconnected" };
    }
    return { ok: false, reason: "invalid" };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}

export function polygonToBlockCells(
  geometry: Polygon,
  resolution: number,
  cap: number = H3_VIEWPORT_CELL_CAP,
): string[] {
  try {
    const cells = polygonToCells(geometry.coordinates, resolution, true);
    if (cells.length > cap) return [];
    return cells;
  } catch {
    return [];
  }
}
