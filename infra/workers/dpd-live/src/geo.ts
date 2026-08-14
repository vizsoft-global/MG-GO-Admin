/**
 * Point-in-zone with a metre buffer, implemented locally rather than with turf.
 *
 * Two reasons: `@turf/boolean-point-in-polygon` answers inside/outside but not
 * *how far* from the boundary, and the hysteresis buffer that stops a driver parked
 * on a zone edge from flapping needs the distance. Zones can also be circles, which
 * turf's polygon predicate does not cover at all.
 */

export type WorkerZone = {
  id: string;
  name: string;
  color: string | null;
  zoneType: "polygon" | "circle";
  /** [lng, lat] ring, first vertex repeated at the end. */
  ring: [number, number][] | null;
  /** [lng, lat] */
  center: [number, number] | null;
  radiusMeters: number;
  /** [minLng, minLat, maxLng, maxLat] — cheap rejection before the ray cast. */
  bbox: [number, number, number, number];
};

const EARTH_RADIUS_M = 6_371_000;

export function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.asin(Math.sqrt(a));
}

export function parseZone(row: {
  id: string;
  name: string | null;
  color: string | null;
  zone_type: string | null;
  geometry: unknown;
}): WorkerZone | null {
  const feature = row.geometry as
    | {
        geometry?: { type?: string; coordinates?: unknown };
        properties?: { radiusMeters?: number };
      }
    | null;
  const geom = feature?.geometry;
  if (!geom?.type) return null;

  if (row.zone_type === "circle" && geom.type === "Point") {
    const coords = geom.coordinates as [number, number] | undefined;
    const radiusMeters = feature?.properties?.radiusMeters ?? 0;
    if (!coords || radiusMeters <= 0) return null;
    const [lng, lat] = coords;
    // Degrees per metre, latitude-corrected, only to build a rejection box.
    const dLat = radiusMeters / 111_320;
    const dLng = radiusMeters / (111_320 * Math.max(Math.cos((lat * Math.PI) / 180), 0.01));
    return {
      id: row.id,
      name: row.name ?? "",
      color: row.color,
      zoneType: "circle",
      ring: null,
      center: [lng, lat],
      radiusMeters,
      bbox: [lng - dLng, lat - dLat, lng + dLng, lat + dLat],
    };
  }

  if (geom.type !== "Polygon") return null;
  const rings = geom.coordinates as [number, number][][] | undefined;
  const ring = rings?.[0];
  if (!ring || ring.length < 4) return null;

  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of ring) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }

  return {
    id: row.id,
    name: row.name ?? "",
    color: row.color,
    zoneType: "polygon",
    ring,
    center: null,
    radiusMeters: 0,
    bbox: [minLng, minLat, maxLng, maxLat],
  };
}

function pointInRing(lat: number, lng: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    const intersects =
      yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Metres from a point to a segment, in a local equirectangular frame. */
function distanceToSegmentMeters(
  lat: number,
  lng: number,
  aLng: number,
  aLat: number,
  bLng: number,
  bLat: number,
): number {
  const mPerDegLat = 111_320;
  const mPerDegLng = 111_320 * Math.max(Math.cos((lat * Math.PI) / 180), 0.01);

  const px = (lng - aLng) * mPerDegLng;
  const py = (lat - aLat) * mPerDegLat;
  const bx = (bLng - aLng) * mPerDegLng;
  const by = (bLat - aLat) * mPerDegLat;

  const lenSq = bx * bx + by * by;
  if (lenSq === 0) return Math.hypot(px, py);

  const t = Math.max(0, Math.min(1, (px * bx + py * by) / lenSq));
  return Math.hypot(px - t * bx, py - t * by);
}

export type ZoneMembership = {
  inside: boolean;
  /** Always positive: metres from the boundary, whichever side the point is on. */
  distanceToEdgeM: number;
};

export function zoneMembership(
  lat: number,
  lng: number,
  zone: WorkerZone,
): ZoneMembership {
  if (zone.zoneType === "circle" && zone.center) {
    const d = haversineMeters(lat, lng, zone.center[1], zone.center[0]);
    return { inside: d <= zone.radiusMeters, distanceToEdgeM: Math.abs(zone.radiusMeters - d) };
  }

  const ring = zone.ring;
  if (!ring) return { inside: false, distanceToEdgeM: Infinity };

  const inside = pointInRing(lat, lng, ring);

  let nearest = Infinity;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const [aLng, aLat] = ring[i]!;
    const [bLng, bLat] = ring[i + 1]!;
    const d = distanceToSegmentMeters(lat, lng, aLng, aLat, bLng, bLat);
    if (d < nearest) nearest = d;
  }

  return { inside, distanceToEdgeM: nearest };
}

/**
 * Membership with hysteresis: a state change is only accepted once the point is
 * clear of the boundary by `bufferMeters`. Straddling the line keeps the previous
 * answer, which is what stops zone entry/exit from flapping.
 */
export function debouncedMembership(
  lat: number,
  lng: number,
  zone: WorkerZone,
  previous: boolean | null,
  bufferMeters: number,
): boolean {
  const { inside, distanceToEdgeM } = zoneMembership(lat, lng, zone);
  if (previous === null) return inside;
  if (inside === previous) return previous;
  return distanceToEdgeM >= bufferMeters ? inside : previous;
}

/** First zone containing the point — for display, not for compliance. */
export function resolveZoneAt(
  lat: number,
  lng: number,
  zones: WorkerZone[],
): WorkerZone | null {
  for (const zone of zones) {
    const [minLng, minLat, maxLng, maxLat] = zone.bbox;
    if (lng < minLng || lng > maxLng || lat < minLat || lat > maxLat) continue;
    if (zoneMembership(lat, lng, zone).inside) return zone;
  }
  return null;
}

export function inBbox(
  lat: number,
  lng: number,
  bbox: [number, number, number, number] | null,
): boolean {
  if (!bbox) return true;
  const [west, south, east, north] = bbox;
  if (lat < south || lat > north) return false;
  // Antimeridian-safe, which costs nothing and avoids a silent bug if the fleet
  // ever operates across it.
  if (west <= east) return lng >= west && lng <= east;
  return lng >= west || lng <= east;
}
