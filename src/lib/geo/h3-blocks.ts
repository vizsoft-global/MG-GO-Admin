import { featureCollection, union } from "@turf/turf";
import kinks from "@turf/kinks";
import {
  POLYGON_TO_CELLS_FLAGS,
  areNeighborCells,
  cellToBoundary,
  cellToChildren,
  cellToLatLng,
  cellsToMultiPolygon,
  getHexagonAreaAvg,
  gridDisk,
  latLngToCell,
  polygonToCells,
  polygonToCellsExperimental,
} from "h3-js";
import type { Feature, Polygon, Position } from "geojson";
import {
  KUWAIT_LAND_BBOX,
  KUWAIT_LAND_INDEX_RES,
  isKuwaitLand,
  isKuwaitLandCell,
  landIndexKind,
} from "./kuwait-land";
import { buildPolygonFeature, type ZoneGeoFeature } from "./zone-geometry";

export { isKuwaitLandCell };

export const H3_BLOCK_RESOLUTIONS = {
  S: 8,
  M: 9,
  L: 10,
} as const;

export type H3BlockSize = keyof typeof H3_BLOCK_RESOLUTIONS;

export const DEFAULT_H3_BLOCK_SIZE: H3BlockSize = "M";

/**
 * Upper bound on hexes handed to the renderer in one frame.
 *
 * Sized so the grid can never disappear while it is still paintable: at the
 * `MIN_PAINTABLE_HEX_PX` threshold a hex covers ~94px², so even a 2560x1440
 * map full of land needs under 40k. The canvas overlay draws them as a single
 * path, which is what makes a number this large affordable at all.
 */
export const H3_VIEWPORT_CELL_CAP = 60_000;

/**
 * Upper bound on hexes seeded into a *selection*, which is a far smaller number
 * than the render cap above and deliberately not derived from it.
 *
 * Drawing is batched and costs a few milliseconds for tens of thousands of
 * hexes, but every paint gesture re-unions the whole selection through turf,
 * which is linear and expensive: ~110ms at 1k cells, ~360ms at 3k, ~2.6s at
 * 20k. Seeding more than this would hand the user a zone they cannot edit.
 */
export const H3_SELECTION_CELL_CAP = 3_000;

/** Never ask `polygonToCells` for more than this — protects against absurd views. */
const GENERATE_CEILING = 120_000;

/** Below this on-screen width a honeycomb is visual noise, so it stays hidden. */
export const MIN_VISIBLE_HEX_PX = 5;

/** Below this a hex is too small to click or drag over reliably. */
export const MIN_PAINTABLE_HEX_PX = 12;

export type H3UnionResult =
  | { ok: true; feature: ZoneGeoFeature }
  | { ok: false; reason: "empty" | "disconnected" | "invalid" };

function uniqueCells(cells: readonly string[]): string[] {
  return [...new Set(cells)];
}

/**
 * Corner-to-corner width of a regular hexagon with the same area as an average
 * cell at this resolution. H3 cells are not regular, so this is the honest
 * "how big does one look" number rather than `getHexagonEdgeLengthAvg`.
 */
export function hexWidthMeters(resolution: number): number {
  const areaM2 = getHexagonAreaAvg(resolution, "m2");
  if (!Number.isFinite(areaM2) || areaM2 <= 0) return 0;
  return 2 * Math.sqrt(areaM2 / ((3 * Math.sqrt(3)) / 2));
}

/** Web Mercator ground resolution at a given latitude and zoom. */
export function metersPerPixel(lat: number, zoom: number): number {
  return (156_543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}

/** How wide one hex appears on screen, in CSS pixels. */
export function hexWidthPixels(
  resolution: number,
  lat: number,
  zoom: number,
): number {
  const mpp = metersPerPixel(lat, zoom);
  if (!Number.isFinite(mpp) || mpp <= 0) return 0;
  return hexWidthMeters(resolution) / mpp;
}

/** Lowest zoom at which hexes of this resolution reach `px` across. */
export function minZoomForHexPx(
  resolution: number,
  lat: number,
  px: number,
): number {
  const widthM = hexWidthMeters(resolution);
  if (widthM <= 0 || px <= 0) return Number.POSITIVE_INFINITY;
  const mpp = widthM / px;
  return Math.log2((156_543.03392 * Math.cos((lat * Math.PI) / 180)) / mpp);
}

export type HexGridView = {
  /** Land cells to draw, always including any selected cells passed in. */
  cells: string[];
  /** Is the background honeycomb drawn at this zoom? */
  visible: boolean;
  /** Are hexes big enough to click/drag accurately? */
  paintable: boolean;
  /** On-screen hex width, for hints and tuning. */
  hexPx: number;
};

function selectedLandCells(cells: readonly string[]): string[] {
  return uniqueCells(cells).filter((cell) => isKuwaitLandCell(cell));
}

function bboxAreaKm2(west: number, south: number, east: number, north: number): number {
  const latMid = (south + north) / 2;
  const heightKm = Math.abs(north - south) * 110.574;
  const widthKm = Math.abs(east - west) * 111.32 * Math.cos((latMid * Math.PI) / 180);
  return Math.max(0, widthKm * heightKm);
}

/** Rough hex count for a bbox — used only to refuse absurd `polygonToCells` calls. */
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

/**
 * The honeycomb for the current map view: every Kuwait land hex inside the
 * viewport, at a fixed resolution that simply scales as the map zooms.
 *
 * There is no area-based bail-out — the grid stays anchored to the map and is
 * only hidden once hexes shrink past `MIN_VISIBLE_HEX_PX`, where they would be
 * an unreadable smear anyway. Selected cells are always returned so a zone
 * stays visible even when the background grid is not.
 */
export function hexGridForView(args: {
  west: number;
  south: number;
  east: number;
  north: number;
  zoom: number;
  resolution: number;
  extraCells?: readonly string[];
  cap?: number;
}): HexGridView {
  const cap = args.cap ?? H3_VIEWPORT_CELL_CAP;
  const selected = selectedLandCells(args.extraCells ?? []);
  const lat = (args.south + args.north) / 2;
  const hexPx = hexWidthPixels(args.resolution, lat, args.zoom);
  const paintable = hexPx >= MIN_PAINTABLE_HEX_PX;
  const hidden: HexGridView = {
    cells: selected,
    visible: false,
    paintable: false,
    hexPx,
  };

  if (hexPx < MIN_VISIBLE_HEX_PX) return hidden;

  // Clamp to Kuwait so a view that is mostly Gulf or Iraq costs nothing.
  const [landWest, landSouth, landEast, landNorth] = KUWAIT_LAND_BBOX;
  const west = Math.max(args.west, landWest);
  const south = Math.max(args.south, landSouth);
  const east = Math.min(args.east, landEast);
  const north = Math.min(args.north, landNorth);
  if (west >= east || south >= north) {
    return { cells: selected, visible: true, paintable, hexPx };
  }

  if (
    estimateViewportCellCount(west, south, east, north, args.resolution) >
    GENERATE_CEILING
  ) {
    return hidden;
  }

  const cells = landCellsInBounds(west, south, east, north, args.resolution);
  if (cells == null || cells.length > cap) return hidden;

  return {
    cells: uniqueCells([...cells, ...selected]),
    visible: true,
    paintable,
    hexPx,
  };
}

/**
 * Land hexes whose centre falls in the given bounds.
 *
 * Walks the coarse res-6 land index rather than enumerating the whole
 * viewport: sea parents are skipped without generating a single hex, and
 * descendants of a fully-land parent need no geometry test at all. Only hexes
 * under a coastal parent pay for a point-in-polygon check.
 */
function landCellsInBounds(
  west: number,
  south: number,
  east: number,
  north: number,
  resolution: number,
): string[] | null {
  if (resolution <= KUWAIT_LAND_INDEX_RES) {
    try {
      const ring: Position[] = [
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south],
      ];
      return polygonToCells([ring], resolution, true).filter(isKuwaitLandCell);
    } catch {
      return null;
    }
  }

  // Pad so parents that only clip a corner of the viewport are still included;
  // children are filtered back to the true bounds below.
  const pad = 0.02;
  const paddedRing: Position[] = [
    [west - pad, south - pad],
    [east + pad, south - pad],
    [east + pad, north + pad],
    [west - pad, north + pad],
    [west - pad, south - pad],
  ];

  let parents: string[];
  try {
    parents = polygonToCellsExperimental(
      [paddedRing],
      KUWAIT_LAND_INDEX_RES,
      POLYGON_TO_CELLS_FLAGS.containmentOverlapping,
      true,
    );
  } catch {
    return null;
  }

  const cells: string[] = [];
  for (const parent of parents) {
    const kind = landIndexKind(parent);
    if (kind === "sea") continue;
    let children: string[];
    try {
      children = cellToChildren(parent, resolution);
    } catch {
      return null;
    }
    const needsGeometryTest = kind === "edge";
    for (const child of children) {
      const [lat, lng] = cellToLatLng(child);
      if (lng < west || lng > east || lat < south || lat > north) continue;
      if (needsGeometryTest && !isKuwaitLand(lat, lng)) continue;
      cells.push(child);
    }
  }
  return cells;
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
  cap: number = H3_SELECTION_CELL_CAP,
): string[] {
  try {
    const cells = polygonToCells(geometry.coordinates, resolution, true);
    if (cells.length > cap) return [];
    return cells;
  } catch {
    return [];
  }
}
