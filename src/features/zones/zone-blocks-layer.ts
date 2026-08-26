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
 * Emerald selection over a slate honeycomb. The unselected fill is deliberately
 * light but must stay non-zero — at 0.02 the grid was effectively invisible on
 * the light basemap.
 */
export const ZONE_BLOCK_HEX_STYLE = {
  selected: {
    fillColor: "#10b981",
    fillOpacity: 0.52,
    strokeColor: "#059669",
    strokeOpacity: 1,
    strokeWeight: 2,
  },
  unselected: {
    fillColor: "#94a3b8",
    fillOpacity: 0.1,
    strokeColor: "#64748b",
    strokeOpacity: 0.65,
    strokeWeight: 1,
  },
} as const;

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
