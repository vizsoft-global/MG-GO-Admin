import { booleanPointInPolygon, point, polygon } from "@turf/turf";
import type { Feature, Polygon } from "geojson";

/**
 * Simplified Kuwait mainland (excludes the Gulf / Kuwait Bay).
 * Coordinates are GeoJSON [lng, lat], outer ring closed.
 */
const KUWAIT_LAND_RING: [number, number][] = [
  [48.385, 28.524],
  [48.25, 28.68],
  [48.175, 28.85],
  [48.145, 29.02],
  [48.105, 29.18],
  [48.09, 29.27],
  [48.088, 29.325],
  [48.055, 29.345],
  [48.01, 29.368],
  [47.99, 29.385],
  [47.95, 29.378],
  [47.9, 29.368],
  [47.85, 29.355],
  [47.8, 29.348],
  [47.75, 29.355],
  [47.71, 29.38],
  [47.68, 29.41],
  [47.64, 29.4],
  [47.6, 29.45],
  [47.62, 29.62],
  [47.72, 29.85],
  [47.9, 30.08],
  [47.3, 30.06],
  [46.569, 29.099],
  [47.46, 29.003],
  [47.709, 28.526],
  [48.385, 28.524],
];

export const KUWAIT_LAND: Feature<Polygon> = polygon([KUWAIT_LAND_RING]);

export function isKuwaitLand(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  return booleanPointInPolygon(point([lng, lat]), KUWAIT_LAND);
}
