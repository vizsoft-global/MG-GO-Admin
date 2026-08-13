import type { DriverLocationMapMarker } from "@/features/locations/types";
import type { MapLayerToggle } from "./tracking-map-overlays";

export type HeatmapPointInput = {
  lat: number;
  lng: number;
  weight: number;
};

export function buildHeatmapPoints(markers: DriverLocationMapMarker[]): HeatmapPointInput[] {
  return markers.map((pin) => ({
    lat: pin.lat,
    lng: pin.lng,
    weight: pin.trackingStatus === "moving" ? 2 : 1,
  }));
}

export function heatmapLayerDataFromPoints<T>(
  points: HeatmapPointInput[],
  LatLng: new (lat: number, lng: number) => T,
): Array<{ location: T; weight: number }> {
  return points.map((point) => ({
    location: new LatLng(point.lat, point.lng),
    weight: point.weight,
  }));
}

export function isTrafficLayerEnabled(layer: MapLayerToggle): boolean {
  return layer === "traffic";
}

export function isHeatmapLayerEnabled(layer: MapLayerToggle): boolean {
  return layer === "heatmap";
}
