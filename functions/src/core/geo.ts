const EARTH_RADIUS_M = 6371008.8;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Great-circle distance in metres.
 *
 * This is the same formula as the SQL's `_haversine_meters`, and it has to be:
 * the route distance and the stored odometer are compared against each other in
 * the panel, so a different Earth radius here would show as a permanent
 * disagreement between two numbers that are supposed to measure the same thing.
 */
export function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

export type GeoPoint<T> = { point: T; lat: number; lng: number };

export type ZoneGeometryType = "polygon" | "circle";

/**
 * The subset of the stored GeoJSON Feature this package needs.
 *
 * Zones and restaurant geofences store `{ type: "Feature", geometry, properties }`
 * with `properties.radiusMeters` carrying a circle's radius — the same shape
 * `_zone_geography_from_feature` reads, including its tolerance for a bare
 * `geometry` object with no Feature wrapper.
 */
export type ZoneFeature = {
  type?: string;
  geometry?: {
    type?: string;
    /** Polygon: `[ring][vertex][lng, lat]`. Point: `[lng, lat]`. */
    coordinates?: unknown;
  } | null;
  properties?: { radiusMeters?: number | string | null } | null;
};

function ringOf(feature: ZoneFeature | null | undefined): number[][] {
  const geometry = feature?.geometry;
  if (!geometry || geometry.type !== "Polygon") return [];
  const coordinates = geometry.coordinates;
  if (!Array.isArray(coordinates) || !Array.isArray(coordinates[0])) return [];
  return coordinates[0] as number[][];
}

function circleCenterOf(feature: ZoneFeature | null | undefined): [number, number] | null {
  const geometry = feature?.geometry;
  if (!geometry || geometry.type !== "Point") return null;
  const coordinates = geometry.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  const lng = Number(coordinates[0]);
  const lat = Number(coordinates[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return [lat, lng];
}

function circleRadiusOf(feature: ZoneFeature | null | undefined): number | null {
  const raw = feature?.properties?.radiusMeters;
  const radius = typeof raw === "string" ? Number(raw.trim()) : raw;
  if (typeof radius !== "number" || !Number.isFinite(radius) || radius <= 0) return null;
  return radius;
}

/**
 * Ray casting, matching `ST_Contains` for a point that is not exactly on an edge.
 *
 * `ST_DWithin(point, polygon, 0)` is inclusive of the boundary while this test is
 * not, and that is a deliberate, documented divergence: a pickup that lands
 * *exactly* on a geofence edge is a measure-zero case in a float coordinate
 * system, and the alternative — point-on-segment arithmetic for every edge — would
 * add a failure mode the SQL does not have either (PostGIS itself is inconsistent
 * about boundary points for polygon vs. geography casts).
 */
export function pointInPolygon(lat: number, lng: number, ring: number[][]): boolean {
  if (ring.length < 4) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const xi = Number(ring[i]?.[0]);
    const yi = Number(ring[i]?.[1]);
    const xj = Number(ring[j]?.[0]);
    const yj = Number(ring[j]?.[1]);
    if (![xi, yi, xj, yj].every(Number.isFinite)) continue;
    const intersects = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * `_point_within_zone_proximity` — inside the shape, or within `bufferMeters` of it.
 *
 * A circle is measured centre-to-point with the buffer added to its radius, which
 * is what `ST_Buffer(geography, radius)` then `ST_DWithin(..., buffer)` reduces to.
 */
export function pointWithinZoneProximity(
  lat: number,
  lng: number,
  feature: ZoneFeature | null | undefined,
  zoneType: ZoneGeometryType,
  bufferMeters: number,
): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  const buffer = Number.isFinite(bufferMeters) ? Math.max(bufferMeters, 0) : 0;

  if (zoneType === "circle") {
    const center = circleCenterOf(feature);
    const radius = circleRadiusOf(feature);
    if (!center || radius === null) return false;
    return haversineMeters(lat, lng, center[0], center[1]) <= radius + buffer;
  }

  const ring = ringOf(feature);
  if (ring.length < 4) return false;
  if (buffer <= 0) return pointInPolygon(lat, lng, ring);

  // A buffered polygon is not the polygon plus a per-vertex circle test; the
  // honest cheap equivalent is "inside, or within buffer of any edge".
  if (pointInPolygon(lat, lng, ring)) return true;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const aLat = Number(ring[j]?.[1]);
    const aLng = Number(ring[j]?.[0]);
    const bLat = Number(ring[i]?.[1]);
    const bLng = Number(ring[i]?.[0]);
    if (![aLat, aLng, bLat, bLng].every(Number.isFinite)) continue;
    if (pointToSegmentMeters(lat, lng, aLat, aLng, bLat, bLng) <= buffer) return true;
  }
  return false;
}

/** Great-circle distance from a point to the nearest point of a zone's boundary. */
export function distanceToZoneBoundaryMeters(
  lat: number,
  lng: number,
  feature: ZoneFeature | null | undefined,
  zoneType: ZoneGeometryType,
): number | null {
  if (zoneType === "circle") {
    const center = circleCenterOf(feature);
    const radius = circleRadiusOf(feature);
    if (!center || radius === null) return null;
    return Math.abs(haversineMeters(lat, lng, center[0], center[1]) - radius);
  }
  const ring = ringOf(feature);
  if (ring.length < 2) return null;
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const aLat = Number(ring[j]?.[1]);
    const aLng = Number(ring[j]?.[0]);
    const bLat = Number(ring[i]?.[1]);
    const bLng = Number(ring[i]?.[0]);
    if (![aLat, aLng, bLat, bLng].every(Number.isFinite)) continue;
    best = Math.min(best, pointToSegmentMeters(lat, lng, aLat, aLng, bLat, bLng));
  }
  return Number.isFinite(best) ? best : null;
}

/** Perpendicular distance from a point to the segment a–b, in metres. */
function pointToSegmentMeters(
  pLat: number,
  pLng: number,
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  // Local equirectangular projection: at the scale of one city segment the
  // curvature error is far below the 8 m default tolerance, and it keeps the
  // perpendicular foot a closed-form calculation rather than an iterative one.
  const refLat = toRadians((aLat + bLat) / 2);
  const mPerDegLat = 111132.92;
  const mPerDegLng = 111132.92 * Math.cos(refLat);

  const ax = aLng * mPerDegLng;
  const ay = aLat * mPerDegLat;
  const bx = bLng * mPerDegLng;
  const by = bLat * mPerDegLat;
  const px = pLng * mPerDegLng;
  const py = pLat * mPerDegLat;

  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(px - ax, py - ay);

  let t = ((px - ax) * dx + (py - ay) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * Douglas–Peucker, the same algorithm `ST_Simplify` runs.
 *
 * The SQL simplified a projected UTM 39N geometry, so the tolerance was metres;
 * doing the same test in metres here keeps the default 8 m and any caller's
 * override meaning the same number it meant before.
 */
export function simplifyPath<T>(points: GeoPoint<T>[], toleranceMeters: number): GeoPoint<T>[] {
  if (points.length < 3 || toleranceMeters <= 0) return points;

  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;

  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop() as [number, number];
    if (last - first < 2) continue;

    let maxDistance = 0;
    let maxIndex = -1;
    for (let index = first + 1; index < last; index += 1) {
      const distance = pointToSegmentMeters(
        points[index].lat,
        points[index].lng,
        points[first].lat,
        points[first].lng,
        points[last].lat,
        points[last].lng,
      );
      if (distance > maxDistance) {
        maxDistance = distance;
        maxIndex = index;
      }
    }

    if (maxIndex > -1 && maxDistance > toleranceMeters) {
      keep[maxIndex] = true;
      stack.push([first, maxIndex], [maxIndex, last]);
    }
  }

  return points.filter((_, index) => keep[index]);
}
