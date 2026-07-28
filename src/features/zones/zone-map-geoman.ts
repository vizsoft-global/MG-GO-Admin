import L from "leaflet";
import {
  buildCircleFeature,
  buildPolygonFeature,
  circleFromFeature,
  polygonPositionsFromFeature,
  type ZoneGeoFeature,
  type ZoneGeometryType,
} from "@/lib/geo/zone-geometry";
import { normalizeZoneColor } from "./zone-colors";

export type { ZoneMapDrawModeLite } from "./zone-map-geoman-options";
export { geomanDrawOptions } from "./zone-map-geoman-options";

export type ParsedZoneLayer = {
  geometry: ZoneGeoFeature;
  zoneType: ZoneGeometryType;
};

export function isPmVectorLayer(layer: L.Layer): boolean {
  return "pm" in layer && typeof (layer as L.Layer & { pm?: unknown }).pm === "object";
}

const ZONE_DRAFT_LAYER_KEY = "__zoneDraftLayer";

export function markZoneDraftLayer(layer: L.Layer) {
  (layer as L.Layer & { [ZONE_DRAFT_LAYER_KEY]?: boolean })[ZONE_DRAFT_LAYER_KEY] = true;
}

export function isZoneDraftLayer(layer: L.Layer): boolean {
  return Boolean(
    (layer as L.Layer & { [ZONE_DRAFT_LAYER_KEY]?: boolean })[ZONE_DRAFT_LAYER_KEY],
  );
}

/** Remove only user-drawn draft shapes — not reference zone overlays from React. */
export function removeZoneDraftLayers(map: L.Map, keep?: L.Layer) {
  map.eachLayer((layer) => {
    if (layer === keep) return;
    if (
      isZoneDraftLayer(layer) &&
      (layer instanceof L.Polygon || layer instanceof L.Circle)
    ) {
      map.removeLayer(layer);
    }
  });
}

/** Coerce a Leaflet-style corner value to LatLng (handles tuples + LatLng literals). */
function coerceLatLng(p: unknown): L.LatLng | null {
  if (p == null) return null;
  if (
    typeof p === "object" &&
    p !== null &&
    "lat" in p &&
    "lng" in p &&
    typeof (p as { lat: unknown }).lat === "number" &&
    typeof (p as { lng: unknown }).lng === "number"
  ) {
    return L.latLng((p as L.LatLng).lat, (p as L.LatLng).lng);
  }
  if (Array.isArray(p) && p.length >= 2) {
    const a = Number(p[0]);
    const b = Number(p[1]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return L.latLng(a, b);
  }
  return null;
}

/** Flatten polygon outer ring — handles nesting; inner corners may be LatLng or [lat,lng]. */
export function extractPolygonRing(layer: L.Layer): L.LatLng[] {
  if (!("getLatLngs" in layer)) return [];
  let latlngs: unknown = (layer as L.Polygon).getLatLngs();

  while (Array.isArray(latlngs) && latlngs.length > 0) {
    const ring = latlngs as unknown[];
    const first = coerceLatLng(ring[0]);
    if (first) {
      const out: L.LatLng[] = [];
      for (const item of ring) {
        const ll = coerceLatLng(item);
        if (ll) out.push(ll);
      }
      return out;
    }
    latlngs = ring[0];
  }

  return [];
}

export function parseLayerToZone(
  layer: L.Layer,
  shape: string,
): ParsedZoneLayer | null {
  const normalized = shape.toLowerCase();

  if (normalized === "circle") {
    if (!("getRadius" in layer) || !("getLatLng" in layer)) return null;
    const circle = layer as L.Circle;
    const center = circle.getLatLng();
    const radiusMeters = circle.getRadius();
    if (!Number.isFinite(radiusMeters) || radiusMeters <= 0) return null;
    return {
      zoneType: "circle",
      geometry: buildCircleFeature([center.lat, center.lng], radiusMeters),
    };
  }

  if (normalized === "polygon" || normalized === "rectangle") {
    const ring = extractPolygonRing(layer);
    if (ring.length < 3) return null;
    const positions = ring.map((ll) => [ll.lat, ll.lng] as [number, number]);
    return {
      zoneType: "polygon",
      geometry: buildPolygonFeature(positions),
    };
  }

  return null;
}

export function applyZoneLayerStyle(
  layer: L.Layer,
  color: string,
  options?: { fillOpacity?: number; weight?: number },
) {
  if (!("setStyle" in layer) || typeof layer.setStyle !== "function") return;
  const stroke = normalizeZoneColor(color);
  layer.setStyle({
    color: stroke,
    fillColor: stroke,
    fillOpacity: options?.fillOpacity ?? 0.3,
    weight: options?.weight ?? 2.5,
  });
}

export function addZoneLayerToMap(
  map: L.Map,
  geometry: ZoneGeoFeature,
  zoneType: ZoneGeometryType,
  color?: string,
): L.Layer | null {
  const pathOptions = {
    color: normalizeZoneColor(color),
    fillColor: normalizeZoneColor(color),
    fillOpacity: 0.3,
    weight: 2.5,
  };

  if (zoneType === "circle") {
    const circle = circleFromFeature(geometry);
    if (!circle) return null;
    const layer = L.circle(circle.center, {
      radius: circle.radiusMeters,
      ...pathOptions,
    }).addTo(map);
    markZoneDraftLayer(layer);
    return layer;
  }

  const positions = polygonPositionsFromFeature(geometry);
  if (positions.length < 3) return null;
  const layer = L.polygon(positions, pathOptions).addTo(map);
  markZoneDraftLayer(layer);
  return layer;
}
