import type { ZoneGeoFeature } from "@/lib/geo/zone-geometry";
import {
  DEFAULT_H3_BLOCK_SIZE,
  H3_BLOCK_RESOLUTIONS,
  type H3BlockSize,
  indexForLatLng,
  isKuwaitLandCell,
  unionCellsToPolygon,
  wouldKeepSelectionConnected,
} from "@/lib/geo/h3-blocks";

export type ZoneBlockPaintMode = "paint" | "erase";

export type ZoneBlocksState = {
  size: H3BlockSize;
  paintMode: ZoneBlockPaintMode;
  selectedCells: string[];
};

export const DEFAULT_ZONE_BLOCKS_STATE: ZoneBlocksState = {
  size: DEFAULT_H3_BLOCK_SIZE,
  paintMode: "paint",
  selectedCells: [],
};

/**
 * Selection over a slate honeycomb. The unselected mesh sits at half the
 * weight the selection does — it is scaffolding for aiming a paint stroke, not
 * content, and at full strength it reads as a texture printed over the city.
 * It must still stay non-zero: at 0.02 the grid was effectively invisible on the
 * light basemap.
 *
 * `selected` is the fallback when no draft colour is known; the paint tool
 * itself uses `zoneBlockSelectedStyle(draftColor)` so the cells being painted
 * already show the colour the zone will be saved with.
 */
export const ZONE_BLOCK_HEX_STYLE = {
  selected: {
    fillColor: "#10b981",
    fillOpacity: 0.52,
    strokeColor: "#10b981",
    strokeOpacity: 1,
    strokeWeight: 2,
  },
  unselected: {
    fillColor: "#94a3b8",
    fillOpacity: 0.05,
    strokeColor: "#64748b",
    strokeOpacity: 0.32,
    strokeWeight: 1,
  },
} as const;

export type ZoneBlockHexStyle = {
  fillColor: string;
  fillOpacity: number;
  strokeColor: string;
  strokeOpacity: number;
  strokeWeight: number;
};

/** Selected-cell style in the zone's own colour; same weights as the default. */
export function zoneBlockSelectedStyle(color: string): ZoneBlockHexStyle {
  return {
    ...ZONE_BLOCK_HEX_STYLE.selected,
    fillColor: color,
    strokeColor: color,
  };
}

export function resolutionForSize(size: H3BlockSize): number {
  return H3_BLOCK_RESOLUTIONS[size];
}

export type ApplyBlockHitResult =
  | { kind: "noop" }
  | { kind: "disconnected" }
  | { kind: "cleared" }
  | { kind: "updated"; cells: string[]; feature: ZoneGeoFeature };

export function applyBlockHit(
  selectedCells: readonly string[],
  lat: number,
  lng: number,
  resolution: number,
  paintMode: ZoneBlockPaintMode,
  gesture: "click" | "drag",
): ApplyBlockHitResult {
  const cell = indexForLatLng(lat, lng, resolution);
  const already = selectedCells.includes(cell);
  if (!already && !isKuwaitLandCell(cell)) return { kind: "noop" };

  if (gesture === "click") {
    if (already) {
      if (!wouldKeepSelectionConnected(selectedCells, cell, "remove")) {
        return { kind: "disconnected" };
      }
      const next = selectedCells.filter((c) => c !== cell);
      if (next.length === 0) return { kind: "cleared" };
      const unioned = unionCellsToPolygon(next);
      if (!unioned.ok) return { kind: "disconnected" };
      return { kind: "updated", cells: next, feature: unioned.feature };
    }
    if (!wouldKeepSelectionConnected(selectedCells, cell, "add")) {
      return { kind: "disconnected" };
    }
    const next = [...selectedCells, cell];
    const unioned = unionCellsToPolygon(next);
    if (!unioned.ok) return { kind: "disconnected" };
    return { kind: "updated", cells: next, feature: unioned.feature };
  }

  if (paintMode === "erase") {
    if (!already) return { kind: "noop" };
    if (!wouldKeepSelectionConnected(selectedCells, cell, "remove")) {
      return { kind: "disconnected" };
    }
    const next = selectedCells.filter((c) => c !== cell);
    if (next.length === 0) return { kind: "cleared" };
    const unioned = unionCellsToPolygon(next);
    if (!unioned.ok) return { kind: "disconnected" };
    return { kind: "updated", cells: next, feature: unioned.feature };
  }

  if (already) return { kind: "noop" };
  if (!wouldKeepSelectionConnected(selectedCells, cell, "add")) {
    return { kind: "disconnected" };
  }
  const next = [...selectedCells, cell];
  const unioned = unionCellsToPolygon(next);
  if (!unioned.ok) return { kind: "disconnected" };
  return { kind: "updated", cells: next, feature: unioned.feature };
}
