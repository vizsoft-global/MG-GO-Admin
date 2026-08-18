import type { ZoneGeoFeature } from "@/lib/geo/zone-geometry";

/** Meta on draft geometry callbacks — provisional means mid-draw, not finished. */
export type ZoneDraftGeometryMeta = {
  provisional?: boolean;
};

/** Save's geometry clause — independent of activeTool / drawMode. */
export function zoneDraftEnablesSave(geometry: ZoneGeoFeature | null): boolean {
  return geometry != null;
}

/**
 * Editing a zone that has no polygon yet must start in Draw.
 * `"edit"` turns drawing off, so a saved zone without geometry could never
 * receive one.
 */
export function initialZoneMapTool(hasGeometry: boolean): "draw" | "edit" {
  return hasGeometry ? "edit" : "draw";
}

/** Final (or omitted) meta may leave draw; provisional must not. */
export function shouldSwitchDrawToolToEdit(
  meta?: ZoneDraftGeometryMeta,
): boolean {
  return !meta?.provisional;
}

/**
 * While Draw is selected, keep the map in draw mode if there is no geometry yet
 * or the geometry is only a provisional in-progress sketch.
 */
export function shouldKeepPolygonDrawMode(args: {
  activeTool: string;
  hasGeometry: boolean;
  draftIsProvisional: boolean;
}): boolean {
  if (args.activeTool !== "draw") return false;
  return !args.hasGeometry || args.draftIsProvisional;
}
