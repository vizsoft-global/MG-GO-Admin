/**
 * Zone geometry for the WebGL layer.
 *
 * The Worker sends zones in `hello`, so this loader only runs on the polling and
 * mirror rails — but it must produce the identical `FleetZone` shape, or the map
 * would draw different polygons depending on which rail happens to be live.
 *
 * `zones` has no `is_active` column (V1 `fetchZones` never filtered on one). A
 * `.eq("is_active", true)` here returned an error and an empty dropdown.
 *
 * Coordinates stay [lng, lat] throughout: that is GeoJSON order, what the database
 * stores, and what deck.gl expects. The existing Leaflet helpers in
 * `@/lib/geo/zone-geometry` flip to [lat, lng] for Leaflet's benefit, which is
 * exactly why they are not reused here.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { FleetZone } from "./fleet-types";

type ZoneRow = {
  id: string;
  name: string | null;
  color: string | null;
  zone_type: string | null;
  geometry: unknown;
};

export function toFleetZone(row: ZoneRow): FleetZone | null {
  const feature = row.geometry as
    | {
        geometry?: { type?: string; coordinates?: unknown };
        properties?: { radiusMeters?: number; blockSize?: "S" | "M" | "L" };
      }
    | null;
  const geometry = feature?.geometry;
  if (!geometry?.type) return null;

  if (row.zone_type === "circle" && geometry.type === "Point") {
    const center = geometry.coordinates as [number, number] | undefined;
    const radiusMeters = feature?.properties?.radiusMeters ?? 0;
    if (!center || radiusMeters <= 0) return null;
    return {
      id: row.id,
      name: row.name ?? "",
      color: row.color,
      zoneType: "circle",
      ring: null,
      center,
      radiusMeters,
    };
  }

  if (geometry.type !== "Polygon") return null;
  const rings = geometry.coordinates as [number, number][][] | undefined;
  const ring = rings?.[0];
  if (!ring || ring.length < 4) return null;

  return {
    id: row.id,
    name: row.name ?? "",
    color: row.color,
    zoneType: "polygon",
    ring,
    center: null,
    radiusMeters: 0,
    blockSize: feature?.properties?.blockSize ?? null,
  };
}

export async function loadFleetZones(
  supabase: SupabaseClient,
): Promise<FleetZone[]> {
  const { data, error } = await supabase
    .from("zones")
    .select("id,name,color,zone_type,geometry");

  if (error || !data) return [];
  return (data as ZoneRow[])
    .map((row) => toFleetZone(row))
    .filter((zone): zone is FleetZone => zone !== null);
}

/** Circle approximated as a ring, so one PolygonLayer can draw both zone kinds. */
export function circleToRing(
  center: [number, number],
  radiusMeters: number,
  segments = 64,
): [number, number][] {
  const [lng, lat] = center;
  const latScale = radiusMeters / 111_320;
  const lngScale =
    radiusMeters / (111_320 * Math.max(Math.cos((lat * Math.PI) / 180), 0.01));

  const ring: [number, number][] = [];
  for (let i = 0; i <= segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2;
    ring.push([lng + Math.cos(angle) * lngScale, lat + Math.sin(angle) * latScale]);
  }
  return ring;
}

export function fleetZoneRing(zone: FleetZone): [number, number][] {
  if (zone.zoneType === "circle" && zone.center) {
    return circleToRing(zone.center, zone.radiusMeters);
  }
  return zone.ring ?? [];
}

/** Label anchor: centroid of the ring, which is where a zone name reads best. */
export function fleetZoneCenter(zone: FleetZone): [number, number] | null {
  if (zone.center) return zone.center;
  const ring = zone.ring;
  if (!ring || ring.length === 0) return null;
  let lng = 0;
  let lat = 0;
  // Skip the repeated closing vertex so it is not double-weighted.
  const count = ring.length - 1;
  for (let i = 0; i < count; i += 1) {
    lng += ring[i]![0];
    lat += ring[i]![1];
  }
  return count > 0 ? [lng / count, lat / count] : null;
}
