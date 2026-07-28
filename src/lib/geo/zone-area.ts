import area from "@turf/area";
import turfCircle from "@turf/circle";
import { point } from "@turf/helpers";
import {
  circleFromFeature,
  type ZoneGeoFeature,
  type ZoneGeometryType,
} from "./zone-geometry";

/** Approximate zone area in square kilometers for display. */
export function zoneAreaSqKm(
  zoneType: ZoneGeometryType,
  geometry: ZoneGeoFeature | null,
): number | null {
  if (!geometry?.geometry) return null;

  try {
    if (zoneType === "circle") {
      const circle = circleFromFeature(geometry);
      if (!circle || circle.radiusMeters <= 0) return null;
      const [lat, lng] = circle.center;
      const ring = turfCircle(point([lng, lat]), circle.radiusMeters / 1000, {
        units: "kilometers",
        steps: 64,
      });
      const sqM = area(ring);
      return sqM > 0 ? sqM / 1_000_000 : null;
    }

    if (geometry.geometry.type !== "Polygon") return null;
    const sqM = area(geometry);
    return sqM > 0 ? sqM / 1_000_000 : null;
  } catch {
    return null;
  }
}

export function formatZoneArea(sqKm: number | null | undefined): string {
  if (sqKm == null || !Number.isFinite(sqKm)) return "—";
  if (sqKm < 0.01) return "<0.01 km²";
  if (sqKm < 1) return `${sqKm.toFixed(2)} km²`;
  return `${sqKm.toFixed(1)} km²`;
}
