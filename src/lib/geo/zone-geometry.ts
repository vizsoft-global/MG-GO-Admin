import bbox from "@turf/bbox";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import turfCircle from "@turf/circle";
import distance from "@turf/distance";
import kinks from "@turf/kinks";
import { point } from "@turf/helpers";
import type { Feature, Point, Polygon, Position } from "geojson";

export type ZoneGeometryType = "polygon" | "circle";

export type ZoneGeoProperties = {
  radiusMeters?: number;
};

export type ZoneGeoFeature = Feature<Polygon | Point, ZoneGeoProperties>;

export type ZoneShape = {
  zone_type: ZoneGeometryType;
  geometry: ZoneGeoFeature | null;
};

export const MIN_RADIUS_METERS = 50;
export const MAX_RADIUS_METERS = 50_000;
export const MIN_POLYGON_VERTICES = 3;

export function isPointInZone(
  lat: number,
  lng: number,
  zone: ZoneShape,
): boolean {
  if (!zone.geometry?.geometry) return false;

  const pt = point([lng, lat]);

  if (zone.zone_type === "circle") {
    const geom = zone.geometry.geometry;
    if (geom.type !== "Point") return false;
    const radiusMeters = zone.geometry.properties?.radiusMeters ?? 0;
    if (radiusMeters <= 0) return false;
    const center = point(geom.coordinates);
    const distMeters = distance(pt, center, { units: "kilometers" }) * 1000;
    return distMeters <= radiusMeters;
  }

  if (zone.geometry.geometry.type !== "Polygon") return false;
  return booleanPointInPolygon(pt, zone.geometry as Feature<Polygon>);
}

export function validateZoneGeometry(
  zoneType: ZoneGeometryType,
  geometry: ZoneGeoFeature | null,
): string | null {
  if (!geometry?.geometry) return "geometry_required";

  if (zoneType === "circle") {
    if (geometry.geometry.type !== "Point") return "invalid_circle";
    const radius = geometry.properties?.radiusMeters;
    if (typeof radius !== "number" || radius < MIN_RADIUS_METERS || radius > MAX_RADIUS_METERS) {
      return "invalid_radius";
    }
    return null;
  }

  if (geometry.geometry.type !== "Polygon") return "invalid_polygon";
  const ring = geometry.geometry.coordinates[0];
  if (!ring || ring.length < MIN_POLYGON_VERTICES + 1) return "polygon_too_small";
  if (kinks(geometry as Feature<Polygon>).features.length > 0) return "polygon_self_intersect";
  return null;
}

export function polygonPositionsFromFeature(
  geometry: ZoneGeoFeature,
): [number, number][] {
  if (geometry.geometry.type !== "Polygon") return [];
  const ring = geometry.geometry.coordinates[0] ?? [];
  return ring.map((coord) => [coord[1], coord[0]] as [number, number]);
}

export function circleFromFeature(geometry: ZoneGeoFeature): {
  center: [number, number];
  radiusMeters: number;
} | null {
  if (geometry.geometry.type !== "Point") return null;
  const [lng, lat] = geometry.geometry.coordinates;
  const radiusMeters = geometry.properties?.radiusMeters ?? 0;
  return { center: [lat, lng], radiusMeters };
}

/** South-west and north-east corners for Leaflet `fitBounds` (lat, lng). */
export type ZoneMapBounds = [[number, number], [number, number]];

function isFiniteLatLng([lat, lng]: [number, number]): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng);
}

/** Map-fit bounds without attaching layers to a Leaflet map. */
export function zoneMapBoundsFromShape(
  zoneType: ZoneGeometryType,
  geometry: ZoneGeoFeature,
): ZoneMapBounds | null {
  if (zoneType === "circle") {
    const circle = circleFromFeature(geometry);
    if (!circle || circle.radiusMeters <= 0 || !isFiniteLatLng(circle.center)) {
      return null;
    }
    const [lat, lng] = circle.center;
    const ring = turfCircle(point([lng, lat]), circle.radiusMeters / 1000, {
      units: "kilometers",
      steps: 64,
    });
    const [minLng, minLat, maxLng, maxLat] = bbox(ring);
    if (
      !Number.isFinite(minLat) ||
      !Number.isFinite(minLng) ||
      !Number.isFinite(maxLat) ||
      !Number.isFinite(maxLng)
    ) {
      return null;
    }
    return [
      [minLat, minLng],
      [maxLat, maxLng],
    ];
  }

  const positions = polygonPositionsFromFeature(geometry);
  if (positions.length < 3 || !positions.every(isFiniteLatLng)) return null;

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const [lat, lng] of positions) {
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
  }
  if (!Number.isFinite(minLat)) return null;
  return [
    [minLat, minLng],
    [maxLat, maxLng],
  ];
}

export function buildPolygonFeature(positions: [number, number][]): ZoneGeoFeature {
  const coordinates: Position[] = positions.map(([lat, lng]) => [lng, lat]);
  if (coordinates.length > 0) {
    const first = coordinates[0];
    const last = coordinates[coordinates.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      coordinates.push([...first]);
    }
  }
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "Polygon", coordinates: [coordinates] },
  };
}

export function buildCircleFeature(
  center: [number, number],
  radiusMeters: number,
): ZoneGeoFeature {
  const [lat, lng] = center;
  return {
    type: "Feature",
    properties: { radiusMeters },
    geometry: { type: "Point", coordinates: [lng, lat] },
  };
}

export function suggestZoneCode(): string {
  const suffix = Math.floor(1000 + Math.random() * 9000);
  return `ZN-${suffix}`;
}
