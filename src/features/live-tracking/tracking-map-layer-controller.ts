import type { DriverLocationMapMarker } from "@/features/locations/types";
import type { MapLayerToggle } from "./tracking-map-overlays";

export function buildHeatmapPoints(markers: DriverLocationMapMarker[]) {
  return markers.map((pin) => ({
    location: { lat: pin.lat, lng: pin.lng },
    weight: pin.trackingStatus === "moving" ? 2 : 1,
  }));
}

export function isTrafficLayerEnabled(layer: MapLayerToggle): boolean {
  return layer === "traffic";
}

export function isHeatmapLayerEnabled(layer: MapLayerToggle): boolean {
  return layer === "heatmap";
}
