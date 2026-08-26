import { booleanPointInPolygon, multiPolygon, point, polygon } from "@turf/turf";
import type { Feature, MultiPolygon, Polygon, Position } from "geojson";
import { cellToLatLng, cellToParent, getResolution } from "h3-js";
import {
  KUWAIT_LAND_COORDINATES,
  KUWAIT_LAND_EDGE_CELLS,
  KUWAIT_LAND_FULL_CELLS,
  KUWAIT_LAND_INDEX_RES,
} from "./kuwait-land-data";

/**
 * Real Kuwait land boundary (OpenStreetMap via geoBoundaries), including
 * Failaka, Bubiyan and Warbah. See `scripts/build-kuwait-land.mjs`.
 */
export const KUWAIT_LAND: Feature<MultiPolygon> = multiPolygon(
  KUWAIT_LAND_COORDINATES,
);

type Ring = { ring: Position[]; west: number; south: number; east: number; north: number };
type LandPart = { feature: Feature<Polygon>; outer: Ring };

function ringBounds(ring: Position[]): Ring {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const [lng, lat] of ring) {
    if (lng < west) west = lng;
    if (lng > east) east = lng;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }
  return { ring, west, south, east, north };
}

/**
 * Per-island bounding boxes so a point-in-polygon test only walks the one
 * landmass it could possibly fall in, instead of all 14.
 */
const LAND_PARTS: LandPart[] = KUWAIT_LAND_COORDINATES.map((rings) => ({
  feature: polygon(rings),
  outer: ringBounds(rings[0]),
}));

const FULL_CELLS = new Set(KUWAIT_LAND_FULL_CELLS);
const EDGE_CELLS = new Set(KUWAIT_LAND_EDGE_CELLS);

/** `[west, south, east, north]` — lets callers skip work for off-country views. */
export const KUWAIT_LAND_BBOX: [number, number, number, number] = (() => {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const part of LAND_PARTS) {
    if (part.outer.west < west) west = part.outer.west;
    if (part.outer.south < south) south = part.outer.south;
    if (part.outer.east > east) east = part.outer.east;
    if (part.outer.north > north) north = part.outer.north;
  }
  return [west, south, east, north];
})();

/** Exact geometry test — only reached for points near the coast or border. */
function pointInLandGeometry(lat: number, lng: number): boolean {
  const pt = point([lng, lat]);
  for (const part of LAND_PARTS) {
    const b = part.outer;
    if (lng < b.west || lng > b.east || lat < b.south || lat > b.north) continue;
    if (booleanPointInPolygon(pt, part.feature)) return true;
  }
  return false;
}

export function isKuwaitLand(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  return pointInLandGeometry(lat, lng);
}

const cellLandCache = new Map<string, boolean>();
const CELL_CACHE_LIMIT = 200_000;

/**
 * Is this H3 cell on Kuwait land?
 *
 * Resolved against a precomputed res-6 index first: cells inside a fully-land
 * parent answer in O(1), and only cells whose parent straddles the coast fall
 * through to the exact geometry test. Results are memoised because panning
 * revisits the same cells constantly.
 */
export function isKuwaitLandCell(h3Index: string): boolean {
  const cached = cellLandCache.get(h3Index);
  if (cached !== undefined) return cached;

  let result: boolean;
  let resolution: number;
  try {
    resolution = getResolution(h3Index);
  } catch {
    return false;
  }

  if (resolution < KUWAIT_LAND_INDEX_RES) {
    // Coarser than the index — no shortcut available.
    const [lat, lng] = cellToLatLng(h3Index);
    result = pointInLandGeometry(lat, lng);
  } else {
    let parent: string;
    try {
      parent =
        resolution === KUWAIT_LAND_INDEX_RES
          ? h3Index
          : cellToParent(h3Index, KUWAIT_LAND_INDEX_RES);
    } catch {
      return false;
    }
    if (FULL_CELLS.has(parent)) {
      result = true;
    } else if (!EDGE_CELLS.has(parent)) {
      result = false;
    } else {
      const [lat, lng] = cellToLatLng(h3Index);
      result = pointInLandGeometry(lat, lng);
    }
  }

  if (cellLandCache.size >= CELL_CACHE_LIMIT) cellLandCache.clear();
  cellLandCache.set(h3Index, result);
  return result;
}

export type LandIndexKind = "full" | "edge" | "sea";

/**
 * Classify a res-6 index cell so a viewport can be pruned before any per-hex
 * work: `sea` parents are skipped wholesale, `full` parents need no geometry
 * test for any descendant, and only `edge` parents fall through to one.
 */
export function landIndexKind(cell: string): LandIndexKind {
  if (FULL_CELLS.has(cell)) return "full";
  if (EDGE_CELLS.has(cell)) return "edge";
  return "sea";
}

export { KUWAIT_LAND_INDEX_RES };
