/**
 * Block outlines for zones on the V2 canvas.
 *
 * A zone painted with the Blocks tool is stored as the union polygon of its
 * hexes, so by the time it reaches this map it is one flat shape. Re-deriving the
 * cells from `properties.blockSize` puts the structure back: the fill still says
 * "this is one zone", the hex edges say what it is built from.
 *
 * Cells come back from the polygon exactly as they went in — `polygonToBlockCells`
 * selects by cell centre, and every centre inside the union of those cells is one
 * of them. Zones drawn by hand carry no size and are skipped rather than tiled
 * with a grid nobody chose.
 */

import { cellToBoundary } from "h3-js";
import {
  H3_BLOCK_RESOLUTIONS,
  minZoomForHexPx,
  polygonToBlockCells,
  type H3BlockSize,
} from "@/lib/geo/h3-blocks";
import { MIN_ZONE_BLOCK_HEX_PX } from "@/features/zones/zone-block-cells";
import type { FleetZone } from "./fleet-types";

export type ZoneBlockOutline = {
  polygon: [number, number][];
  rgb: [number, number, number];
};

export type ZoneBlockOutlineGroup = {
  size: H3BlockSize;
  /** Below this zoom the hexes are too small to read, so the layer is dropped. */
  minZoom: number;
  data: ZoneBlockOutline[];
};

/**
 * Ceiling on hexes drawn across every zone. Outlines are decoration, and a
 * runaway count would spend the frame budget that the drivers need.
 */
const MAX_OUTLINE_CELLS = 12_000;

function ringCentroidLat(ring: [number, number][]): number {
  let lat = 0;
  for (const [, y] of ring) lat += y;
  return ring.length > 0 ? lat / ring.length : 0;
}

/**
 * Grouped by block size so each group can be gated at its own zoom.
 *
 * `toRgb` is passed in rather than imported so the outlines cannot drift from the
 * colour the zone fill is already using.
 */
export function fleetZoneBlockOutlines(
  zones: readonly FleetZone[],
  toRgb: (color: string | null) => [number, number, number],
): ZoneBlockOutlineGroup[] {
  const groups = new Map<H3BlockSize, ZoneBlockOutlineGroup>();
  let budget = MAX_OUTLINE_CELLS;

  for (const zone of zones) {
    const size = zone.blockSize;
    if (!size || !(size in H3_BLOCK_RESOLUTIONS)) continue;
    const ring = zone.ring;
    if (!ring || ring.length < 4) continue;
    if (budget <= 0) break;

    const resolution = H3_BLOCK_RESOLUTIONS[size];
    const cells = polygonToBlockCells(
      { type: "Polygon", coordinates: [ring] },
      resolution,
      budget,
    );
    if (cells.length === 0) continue;
    budget -= cells.length;

    const rgb = toRgb(zone.color);
    let group = groups.get(size);
    if (!group) {
      group = {
        size,
        minZoom: minZoomForHexPx(
          resolution,
          ringCentroidLat(ring),
          MIN_ZONE_BLOCK_HEX_PX,
        ),
        data: [],
      };
      groups.set(size, group);
    }

    for (const cell of cells) {
      // `cellToBoundary` yields [lat, lng]; deck.gl wants [lng, lat].
      const boundary = cellToBoundary(cell);
      const polygon: [number, number][] = new Array(boundary.length);
      for (let i = 0; i < boundary.length; i += 1) {
        polygon[i] = [boundary[i]![1], boundary[i]![0]];
      }
      group.data.push({ polygon, rgb });
    }
  }

  return [...groups.values()];
}
