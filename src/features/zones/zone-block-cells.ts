import {
  H3_BLOCK_RESOLUTIONS,
  hexWidthPixels,
  polygonToBlockCells,
  type H3BlockSize,
} from "@/lib/geo/h3-blocks";
import type { ZoneGeoFeature } from "@/lib/geo/zone-geometry";

/**
 * Recovering the honeycomb of a saved zone.
 *
 * A block-painted zone is stored as the union polygon plus `properties.blockSize`,
 * so the cells have to be re-derived to draw them. That round-trips exactly:
 * `polygonToBlockCells` selects by cell centre, and every centre inside the union
 * of those same cells is one of them. A hand-drawn zone has no `blockSize` and
 * deliberately gets no honeycomb — inventing a tiling for it would claim the
 * operator chose blocks when they did not.
 */

export function zoneBlockSize(
  geometry: ZoneGeoFeature | null | undefined,
): H3BlockSize | null {
  const size = geometry?.properties?.blockSize;
  return size && size in H3_BLOCK_RESOLUTIONS ? size : null;
}

/**
 * Below this a hex is too small to read as a shape, and a zone's worth of them
 * is a smudge that only darkens the fill. Higher than the paint-mode threshold
 * because here the hexes are decoration, not a click target.
 */
export const MIN_ZONE_BLOCK_HEX_PX = 6;

export function zoneBlocksVisible(
  size: H3BlockSize,
  lat: number,
  zoom: number,
): boolean {
  return (
    hexWidthPixels(H3_BLOCK_RESOLUTIONS[size], lat, zoom) >=
    MIN_ZONE_BLOCK_HEX_PX
  );
}

/**
 * Deriving cells is a WASM call per zone, and the read-only maps redraw on every
 * pan. Zone geometry objects are stable between fetches, so the object identity
 * is a sound cache key and a replaced zone simply misses.
 */
const cellCache = new WeakMap<object, Map<H3BlockSize, string[]>>();

export function cellsForZone(
  geometry: ZoneGeoFeature | null | undefined,
  size: H3BlockSize | null = zoneBlockSize(geometry),
): string[] {
  if (!geometry || !size) return [];
  if (geometry.geometry.type !== "Polygon") return [];

  let bySize = cellCache.get(geometry);
  if (!bySize) {
    bySize = new Map();
    cellCache.set(geometry, bySize);
  }
  const cached = bySize.get(size);
  if (cached) return cached;

  const cells = polygonToBlockCells(
    geometry.geometry,
    H3_BLOCK_RESOLUTIONS[size],
    // A saved zone is a fixed shape rather than a selection being edited, so the
    // interactive union budget does not apply — but keep a ceiling so one huge
    // zone cannot stall a map that is only drawing decoration.
    20_000,
  );
  bySize.set(size, cells);
  return cells;
}
