import {
  buildCircleFeature,
  buildPolygonFeature,
  circleFromFeature,
  polygonPositionsFromFeature,
  type ZoneGeoFeature,
  type ZoneGeometryType,
} from "@/lib/geo/zone-geometry";
import type {
  GoogleCircleInstance,
  GoogleMapLatLng,
  GoogleMapsApi,
  GooglePolygonInstance,
} from "@/lib/google-maps/load";
import { normalizeZoneColor } from "./zone-colors";

/** Google returns `LatLng` with lat()/lng(); literals use .lat/.lng properties. */
export type GoogleLatLngLike =
  | { lat: number; lng: number }
  | { lat: () => number; lng: () => number };

export function latLngToTuple(p: GoogleLatLngLike): [number, number] {
  const lat = typeof p.lat === "function" ? p.lat() : p.lat;
  const lng = typeof p.lng === "function" ? p.lng() : p.lng;
  return [lat, lng];
}

export function googlePathOptions(
  color: string,
  opts?: { fillOpacity?: number; weight?: number; strokeOpacity?: number; clickable?: boolean },
) {
  const stroke = normalizeZoneColor(color);
  return {
    strokeColor: stroke,
    fillColor: stroke,
    strokeOpacity: opts?.strokeOpacity ?? 1,
    fillOpacity: opts?.fillOpacity ?? 0.25,
    strokeWeight: opts?.weight ?? 2,
    clickable: opts?.clickable ?? true,
  };
}

export function polygonFromFeature(
  google: GoogleMapsApi,
  map: import("@/lib/google-maps/load").GoogleMapInstance | null,
  geometry: ZoneGeoFeature,
  color: string,
  options?: { editable?: boolean; fillOpacity?: number; weight?: number; clickable?: boolean },
): GooglePolygonInstance | null {
  const positions = polygonPositionsFromFeature(geometry);
  if (positions.length < 3) return null;
  const paths = positions.map(([lat, lng]) => ({ lat, lng }));
  return new google.maps.Polygon({
    paths,
    map,
    ...googlePathOptions(color, {
      fillOpacity: options?.fillOpacity,
      weight: options?.weight,
      clickable: options?.clickable,
    }),
    editable: options?.editable ?? false,
    draggable: options?.editable ?? false,
  });
}

export function circleFromZoneFeature(
  google: GoogleMapsApi,
  map: import("@/lib/google-maps/load").GoogleMapInstance | null,
  geometry: ZoneGeoFeature,
  color: string,
  options?: { editable?: boolean; fillOpacity?: number; weight?: number; clickable?: boolean },
): GoogleCircleInstance | null {
  const circle = circleFromFeature(geometry);
  if (!circle) return null;
  return new google.maps.Circle({
    center: { lat: circle.center[0], lng: circle.center[1] },
    radius: circle.radiusMeters,
    map,
    ...googlePathOptions(color, {
      fillOpacity: options?.fillOpacity,
      weight: options?.weight,
      clickable: options?.clickable,
    }),
    editable: options?.editable ?? false,
    draggable: options?.editable ?? false,
  });
}

export function featureFromPolygon(polygon: GooglePolygonInstance): ZoneGeoFeature | null {
  const path = polygon.getPath();
  const len = path.getLength();
  if (len < 3) return null;
  const positions: [number, number][] = [];
  for (let i = 0; i < len; i++) {
    positions.push(latLngToTuple(path.getAt(i) as GoogleLatLngLike));
  }
  return buildPolygonFeature(positions);
}

export function featureFromCircle(circle: GoogleCircleInstance): ZoneGeoFeature | null {
  const center = circle.getCenter();
  const radius = circle.getRadius();
  if (!center || !Number.isFinite(radius) || radius <= 0) return null;
  return buildCircleFeature([center.lat(), center.lng()], radius);
}

export function bindPolygonEditListeners(
  polygon: GooglePolygonInstance,
  onChange: (geometry: ZoneGeoFeature, type: ZoneGeometryType) => void,
) {
  const sync = () => {
    const feature = featureFromPolygon(polygon);
    if (feature) onChange(feature, "polygon");
  };
  const path = polygon.getPath();
  path.addListener("insert_at", sync);
  path.addListener("remove_at", sync);
  path.addListener("set_at", sync);
  polygon.addListener("dragend", sync);
}

export function bindCircleEditListeners(
  circle: GoogleCircleInstance,
  onChange: (geometry: ZoneGeoFeature, type: ZoneGeometryType) => void,
) {
  const sync = () => {
    const feature = featureFromCircle(circle);
    if (feature) onChange(feature, "circle");
  };
  circle.addListener("radius_changed", sync);
  circle.addListener("center_changed", sync);
  circle.addListener("dragend", sync);
}

export function latLngsFromBounds(
  corners: [[number, number], [number, number]],
): GoogleMapLatLng[] {
  const [[minLat, minLng], [maxLat, maxLng]] = corners;
  return [
    { lat: minLat, lng: minLng },
    { lat: maxLat, lng: maxLng },
  ];
}
